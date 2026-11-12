import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  CheckUsageRightsInput,
  CreateAssetInput,
  RecordUsageInput,
  RegisterSkillInput,
  ApproveSkillInput,
  RevokeSkillInput,
  SearchAssetsInput,
  SearchKnowledgeInput,
  SearchSkillsInput,
  SetRightsInput,
  WriteKnowledgeInput,
  ApproveKnowledgeInput,
  type Asset,
  type KnowledgeEntry,
  type McpScope,
  type RightsRecord,
  type RiskLevel,
  type Skill,
  type UsageRecord,
} from '@ai-native-dam/shared-schema';
import { checkUse, searchAssets, type AssetWithRights } from '@ai-native-dam/governance';
import type { Principal } from './auth.js';
import type { SkillStore } from './skill-store.js';
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
  /** Skill Registry persistence — memory, embedded PGlite, or Postgres pool. */
  skillStore: SkillStore;
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
  handler: (args: never, ctx: ToolContext) => unknown | Promise<unknown>;
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
    name: 'check_usage_rights',
    description:
      'Rights check only: can this asset be used on channel X in territory Y now? ' +
      'Read-only; does not log usage (use record_usage) and never modifies rights (use set_rights).',
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
    schema: CheckUsageRightsInput,
    handler: (args: z.infer<typeof CheckUsageRightsInput>, ctx: ToolContext) => {
      if (!ctx.state.assets.has(args.assetId)) {
        return { allowed: false, reason: 'asset_not_found', replacementId: null };
      }
      const now = args.at ? new Date(args.at) : new Date();
      return checkUse(ctx.state.rights.get(args.assetId) ?? null, args, now);
    },
  },
  {
    name: 'create_asset',
    description:
      'Ingest an asset with provenance; requires a license declaration. Gated by approval. ' +
      'The asset lands with rights_status Pending; does not set rights (use set_rights) ' +
      'and does not make the asset usable on any channel.',
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
    description:
      'Attach license, territory, embargo, and channel scope to an asset. Gated by approval. ' +
      'Does not validate or undo past usage records; record_usage re-checks rights at call time.',
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
    description:
      'Log a use. Gated by approval. Rejected when check_usage_rights would return allowed=false. ' +
      'Does not publish or distribute anything; it only writes an audit record.',
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
    description:
      'Write a knowledge entry. Gated by approval; lands as pending_approval. ' +
      'Does not make the entry discoverable until approved; never overwrites existing entries.',
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
    name: 'approve_knowledge',
    description:
      'Approve a pending_approval (or draft) knowledge entry, making it discoverable via search_knowledge. ' +
      'High risk, always gated. Does not modify content or source links, and cannot revoke — revocation ' +
      'is a separate governance action.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', minLength: 1, description: 'Knowledge entry id, e.g. kn-<uuid>' },
      },
      required: ['id'],
    },
    schema: ApproveKnowledgeInput,
    handler: (args: z.infer<typeof ApproveKnowledgeInput>, ctx: ToolContext) => {
      const entry = ctx.state.knowledge.get(args.id);
      if (!entry) {
        throw new ToolRejection('knowledge_not_found', `Knowledge entry ${args.id} does not exist`);
      }
      if (entry.status !== 'draft' && entry.status !== 'pending_approval') {
        throw new ToolRejection(
          'invalid_status_transition',
          `Knowledge entry ${args.id} has status ${entry.status}; only draft or pending_approval can be approved`,
        );
      }
      const updated: KnowledgeEntry = { ...entry, status: 'approved', approvedAt: new Date().toISOString() };
      ctx.state.knowledge.set(entry.id, updated);
      return { entry: updated };
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
        domain: { type: 'string', enum: ['ecommerce', 'short_drama', 'retail', 'content', 'operations', 'generic'] },
        query: { type: 'string' },
        only_approved: { type: 'boolean', default: true },
      },
    },
    schema: SearchSkillsInput,
    handler: async (args: z.infer<typeof SearchSkillsInput>, ctx: ToolContext) => {
      const skills = await ctx.skillStore.search({
        domain: args.domain,
        query: args.query,
        onlyApproved: args.onlyApproved,
      });
      return { skills };
    },
  },
  {
    name: 'register_skill',
    description:
      'Register a skill version with commit-pinned provenance (source repo, path, commit). Gated by approval. ' +
      'Lands as pending_approval; does not make the skill discoverable or invocable until approved.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9:_-]*$', description: 'Namespaced slug, e.g. drama:script-split' },
        version: { type: 'string', pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$' },
        name: { type: 'string' },
        description: { type: 'string', minLength: 10 },
        domain: { type: 'string', enum: ['ecommerce', 'short_drama', 'retail', 'content', 'operations', 'generic'], default: 'generic' },
        source_repo: { type: ['string', 'null'], format: 'uri' },
        source_path: { type: ['string', 'null'] },
        source_commit: { type: ['string', 'null'], description: 'Commit hash the version is pinned to' },
      },
      required: ['id', 'version', 'name', 'description'],
    },
    schema: RegisterSkillInput,
    handler: async (args: z.infer<typeof RegisterSkillInput>, ctx: ToolContext) => {
      const key = `${args.id}@${args.version}`;
      if (await ctx.skillStore.get(args.id, args.version)) {
        throw new ToolRejection('skill_version_exists', `Skill ${key} is already registered`);
      }
      const skill: Skill = {
        id: args.id,
        version: args.version,
        name: args.name,
        description: args.description,
        domain: args.domain,
        sourceSopId: null,
        status: 'pending_approval',
        approvedAt: null,
        approvedBy: null,
        loraArtifactRef: null,
        createdAt: new Date().toISOString(),
        sourceRepo: args.sourceRepo,
        sourcePath: args.sourcePath,
        sourceCommit: args.sourceCommit,
      };
      await ctx.skillStore.put(skill);
      return { skill };
    },
  },
  {
    name: 'approve_skill',
    description:
      'Approve a pending_approval (or draft) skill version, making it discoverable via search_skills and ' +
      'invocable. High risk, always gated. The approver identity is taken from the authenticated principal, ' +
      'never from arguments. Does not modify skill content or provenance, and cannot revoke — revocation is a ' +
      'separate governance action.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9:_-]*$', description: 'Namespaced slug, e.g. drama:script-split' },
        version: { type: 'string', pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$' },
      },
      required: ['id', 'version'],
    },
    schema: ApproveSkillInput,
    handler: async (args: z.infer<typeof ApproveSkillInput>, ctx: ToolContext) => {
      const approvedAt = new Date().toISOString();
      // Approver identity comes from the authenticated principal, not arguments.
      const approved = await ctx.skillStore.approve(args.id, args.version, ctx.principal.id, approvedAt);
      if (!approved) {
        const existing = await ctx.skillStore.get(args.id, args.version);
        if (!existing) {
          throw new ToolRejection('skill_not_found', `Skill ${args.id}@${args.version} is not registered`);
        }
        throw new ToolRejection(
          'invalid_status_transition',
          `Skill ${args.id}@${args.version} has status ${existing.status}; only draft or pending_approval can be approved`,
        );
      }
      return { skill: approved };
    },
  },
  {
    name: 'revoke_skill',
    description:
      'Revoke a skill version, removing it from default search results and blocking new invocations. ' +
      'High risk, always gated. Does not delete the record or rewrite provenance; a revoked version ' +
      'cannot be re-approved — register a new version instead.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9:_-]*$', description: 'Namespaced slug, e.g. drama:script-split' },
        version: { type: 'string', pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$' },
      },
      required: ['id', 'version'],
    },
    schema: RevokeSkillInput,
    handler: async (args: z.infer<typeof RevokeSkillInput>, ctx: ToolContext) => {
      const revoked = await ctx.skillStore.revoke(args.id, args.version);
      if (!revoked) {
        const existing = await ctx.skillStore.get(args.id, args.version);
        if (!existing) {
          throw new ToolRejection('skill_not_found', `Skill ${args.id}@${args.version} is not registered`);
        }
        throw new ToolRejection(
          'invalid_status_transition',
          `Skill ${args.id}@${args.version} is already revoked; register a new version instead`,
        );
      }
      return { skill: revoked };
    },
  },
];

export function findGatewayTool(name: string): GatewayTool | undefined {
  return GATEWAY_TOOLS.find(t => t.name === name);
}
