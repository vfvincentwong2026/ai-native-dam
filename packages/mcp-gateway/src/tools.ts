import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  CheckUseInput,
  CreateAssetInput,
  RecordUsageInput,
  SearchAssetsInput,
  SearchKnowledgeInput,
  SearchSkillsInput,
  SetRightsInput,
  WriteKnowledgeInput,
  type Asset,
  type KnowledgeEntry,
  type McpScope,
  type RightsRecord,
  type RiskLevel,
  type UsageRecord,
} from '@ai-native-dam/shared-schema';
import { checkUse, searchAssets, type AssetWithRights } from '@ai-native-dam/governance';
import type { Principal } from './auth.js';
import type { GatewayState } from './state.js';

/** Domain-level rejection (e.g. rights not cleared). Mapped to MCP isError content. */
export class ToolRejection extends Error {
  constructor(
    public readonly reason: string,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'ToolRejection';
  }
}

export interface ToolContext {
  state: GatewayState;
  principal: Principal;
}

export interface GatewayTool {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  gated: boolean;
  scopes: McpScope[];
  /** JSON Schema advertised on tools/list. */
  inputSchema: Record<string, unknown>;
  /** Zod schema used to validate and default the arguments. */
  schema: z.ZodTypeAny;
  handler: (args: never, ctx: ToolContext) => unknown;
}

const CHANNELS = ['x', 'youtube', 'instagram', 'xiaohongshu', 'wechat_channels'];
const TERRITORIES = ['CN', 'US', 'EU', 'GLOBAL'];

export const GATEWAY_TOOLS: GatewayTool[] = [
  {
    name: 'search_assets',
    description: 'Query media assets by tag, metadata, channel, or semantic similarity.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text or semantic query' },
        channel: { type: 'string', enum: CHANNELS },
        tags: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', default: 20, maximum: 100 },
      },
      required: ['query'],
    },
    schema: SearchAssetsInput,
    handler: (args: z.infer<typeof SearchAssetsInput>, ctx: ToolContext) => {
      const pool: AssetWithRights[] = [...ctx.state.assets.values()].map(asset => ({
        asset,
        rights: ctx.state.rights.get(asset.id) ?? null,
      }));
      return searchAssets(pool, args);
    },
  },
  {
    name: 'check_use',
    description: 'Can this asset be used on channel X in territory Y now?',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        channel: { type: 'string', enum: CHANNELS },
        territory: { type: 'string', enum: TERRITORIES, default: 'CN' },
        at: { type: 'string', format: 'date-time' },
      },
      required: ['asset_id', 'channel'],
    },
    schema: CheckUseInput,
    handler: (args: z.infer<typeof CheckUseInput>, ctx: ToolContext) => {
      if (!ctx.state.assets.has(args.assetId)) {
        return { allowed: false, reason: 'asset_not_found', replacementId: null };
      }
      const now = args.at ? new Date(args.at) : new Date();
      return checkUse(ctx.state.rights.get(args.assetId) ?? null, args, now);
    },
  },
  {
    name: 'create_asset',
    description: 'Ingest an asset with provenance; requires a license declaration. Gated.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        mime_type: { type: 'string' },
        size_bytes: { type: 'integer', default: 0 },
        rendition_url: { type: 'string', format: 'uri' },
        tags: { type: 'array', items: { type: 'string' } },
        license: { type: 'string', description: 'Required rights declaration' },
      },
      required: ['title', 'mime_type', 'rendition_url', 'license'],
    },
    schema: CreateAssetInput,
    handler: (args: z.infer<typeof CreateAssetInput>, ctx: ToolContext) => {
      const asset: Asset = {
        id: `asset-${randomUUID()}`,
        title: args.title,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
        tags: args.tags,
        renditionUrl: args.renditionUrl,
        rightsStatus: 'Pending',
        createdAt: new Date().toISOString(),
      };
      ctx.state.assets.set(asset.id, asset);
      return { asset };
    },
  },
  {
    name: 'set_rights',
    description: 'Attach license, territory, embargo, and channel scope to an asset. Gated.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        license: { type: 'string' },
        territories: { type: 'array', items: { type: 'string', enum: TERRITORIES } },
        channels: { type: 'array', items: { type: 'string', enum: CHANNELS } },
        embargo_until: { type: ['string', 'null'], format: 'date-time' },
        expires_at: { type: ['string', 'null'], format: 'date-time' },
        status: { type: 'string', enum: ['Cleared', 'Restricted', 'Expired', 'Pending'], default: 'Pending' },
      },
      required: ['asset_id', 'license', 'territories', 'channels'],
    },
    schema: SetRightsInput,
    handler: (args: z.infer<typeof SetRightsInput>, ctx: ToolContext) => {
      const asset = ctx.state.assets.get(args.assetId);
      if (!asset) throw new ToolRejection('asset_not_found');
      const rights: RightsRecord = {
        assetId: args.assetId,
        license: args.license,
        territories: args.territories,
        channels: args.channels,
        embargoUntil: args.embargoUntil,
        expiresAt: args.expiresAt,
        status: args.status,
      };
      ctx.state.rights.set(args.assetId, rights);
      ctx.state.assets.set(args.assetId, { ...asset, rightsStatus: args.status });
      return { rights };
    },
  },
  {
    name: 'record_usage',
    description: 'Log a use. Rejected if rights are not Cleared for the target. Gated.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        channel: { type: 'string', enum: CHANNELS },
        territory: { type: 'string', enum: TERRITORIES },
        context: { type: 'string', description: 'What it was used for' },
      },
      required: ['asset_id', 'channel'],
    },
    schema: RecordUsageInput,
    handler: (args: z.infer<typeof RecordUsageInput>, ctx: ToolContext) => {
      if (!ctx.state.assets.has(args.assetId)) throw new ToolRejection('asset_not_found');
      const check = checkUse(
        ctx.state.rights.get(args.assetId) ?? null,
        { assetId: args.assetId, channel: args.channel, territory: args.territory ?? 'CN' },
      );
      if (!check.allowed) throw new ToolRejection(check.reason);
      const usage: UsageRecord = {
        id: `usage-${randomUUID()}`,
        assetId: args.assetId,
        channel: args.channel,
        territory: args.territory,
        context: args.context,
        recordedAt: new Date().toISOString(),
        recordedBy: ctx.principal.id,
      };
      ctx.state.usage.push(usage);
      return { usageId: usage.id, recorded: true as const };
    },
  },
  {
    name: 'search_knowledge',
    description: 'Query the knowledge base by layer.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        layer: { type: 'string', enum: ['raw', 'topic', 'manual', 'rule', 'qa'] },
        only_approved: { type: 'boolean', default: true },
        limit: { type: 'integer', default: 10, maximum: 50 },
      },
      required: ['query'],
    },
    schema: SearchKnowledgeInput,
    handler: (args: z.infer<typeof SearchKnowledgeInput>, ctx: ToolContext) => {
      const q = args.query.toLowerCase();
      const entries = [...ctx.state.knowledge.values()]
        .filter(e => `${e.title} ${e.content}`.toLowerCase().includes(q))
        .filter(e => !args.layer || e.layer === args.layer)
        .filter(e => !args.onlyApproved || e.status === 'approved')
        .slice(0, args.limit);
      return { entries };
    },
  },
  {
    name: 'write_knowledge',
    description: 'Write a knowledge entry. Gated; the entry lands as pending_approval. Gated.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        layer: { type: 'string', enum: ['raw', 'topic', 'manual', 'rule', 'qa'] },
        content: { type: 'string' },
        source_asset_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'layer', 'content'],
    },
    schema: WriteKnowledgeInput,
    handler: (args: z.infer<typeof WriteKnowledgeInput>, ctx: ToolContext) => {
      const entry: KnowledgeEntry = {
        id: `kn-${randomUUID()}`,
        title: args.title,
        layer: args.layer,
        content: args.content,
        sourceAssetIds: args.sourceAssetIds,
        status: 'pending_approval',
        createdAt: new Date().toISOString(),
        approvedAt: null,
      };
      ctx.state.knowledge.set(entry.id, entry);
      return { entry };
    },
  },
  {
    name: 'search_skills',
    description: 'Query the Skill Registry by domain and rights scope.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['ecommerce', 'short_drama', 'retail', 'content', 'generic'] },
        query: { type: 'string' },
        only_approved: { type: 'boolean', default: true },
      },
    },
    schema: SearchSkillsInput,
    handler: (args: z.infer<typeof SearchSkillsInput>, ctx: ToolContext) => {
      const q = args.query?.toLowerCase();
      const skills = [...ctx.state.skills.values()]
        .filter(s => !args.domain || s.domain === args.domain)
        .filter(s => !q || `${s.name} ${s.description}`.toLowerCase().includes(q))
        .filter(s => !args.onlyApproved || s.status === 'approved');
      return { skills };
    },
  },
];

export function findGatewayTool(name: string): GatewayTool | undefined {
  return GATEWAY_TOOLS.find(t => t.name === name);
}
