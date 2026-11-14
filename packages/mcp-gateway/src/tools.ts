import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  CheckUsageRightsInput,
  CreateAssetInput,
  RecordUsageInput,
  RegisterSkillInput,
  ApproveSkillInput,
  RevokeSkillInput,
  ApplySkillInput,
  SearchAssetsInput,
  SearchKnowledgeInput,
  SearchSkillsInput,
  SetRightsInput,
  WriteKnowledgeInput,
  ApproveKnowledgeInput,
  GenerateSystemSpecInput,
  SubmitSystemSpecInput,
  SearchSpecsInput,
  RequestDistillationInput,
  ApproveDistillationInput,
  SearchDistillationsInput,
  RegisterLoraAdapterInput,
  SearchLorasInput,
  RegisterGeneratedSystemInput,
  SearchSystemsInput,
  RegisterDeploymentTargetInput,
  RegisterDeployedInstanceInput,
  RecordInstanceHealthInput,
  RevokeInstanceInput,
  SearchDeploymentsInput,
  type Asset,
  type DeployedInstance,
  type DeploymentTarget,
  type DistillationRequest,
  type GeneratedSystem,
  type KnowledgeEntry,
  type LoraArtifact,
  type McpScope,
  type RightsRecord,
  type RiskLevel,
  type Skill,
  type SkillUsageRecord,
  type SystemEntity,
  type SystemSpec,
  type UsageRecord,
} from '@ai-native-dam/shared-schema';
import { checkUse, searchAssets, type AssetWithRights } from '@ai-native-dam/governance';
import type { Principal } from './auth.js';
import type { GovernanceStore } from './governance-store.js';
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
  /** Governance collections persistence — memory, embedded PGlite, or Postgres pool. */
  store: GovernanceStore;
  /** Skill Registry persistence — memory, embedded PGlite, or Postgres pool. */
  skillStore: SkillStore;
  principal: Principal;
  /** Usage count at which a distillation request flips to awaiting_approval (ADR 0003). */
  distillationThreshold: number;
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
    handler: async (args: z.infer<typeof SearchAssetsInput>, ctx: ToolContext) => {
      const pool = await ctx.store.listAssetsWithRights();
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
    handler: async (args: z.infer<typeof CheckUsageRightsInput>, ctx: ToolContext) => {
      if (!(await ctx.store.getAsset(args.assetId))) {
        return { allowed: false, reason: 'asset_not_found', replacementId: null };
      }
      const now = args.at ? new Date(args.at) : new Date();
      return checkUse((await ctx.store.getRights(args.assetId)) ?? null, args, now);
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
    handler: async (args: z.infer<typeof CreateAssetInput>, ctx: ToolContext) => {
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
      await ctx.store.putAsset(asset);
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
    handler: async (args: z.infer<typeof SetRightsInput>, ctx: ToolContext) => {
      const asset = await ctx.store.getAsset(args.assetId);
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
      await ctx.store.putRights(rights);
      await ctx.store.putAsset({ ...asset, rightsStatus: args.status });
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
    handler: async (args: z.infer<typeof RecordUsageInput>, ctx: ToolContext) => {
      if (!(await ctx.store.getAsset(args.assetId))) throw new ToolRejection('asset_not_found');
      const check = checkUse(
        (await ctx.store.getRights(args.assetId)) ?? null,
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
      await ctx.store.appendUsage(usage);
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
    handler: async (args: z.infer<typeof SearchKnowledgeInput>, ctx: ToolContext) => {
      const entries = await ctx.store.searchKnowledge({
        query: args.query,
        layer: args.layer,
        onlyApproved: args.onlyApproved,
        limit: args.limit,
      });
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
    handler: async (args: z.infer<typeof WriteKnowledgeInput>, ctx: ToolContext) => {
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
      await ctx.store.putKnowledge(entry);
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
    handler: async (args: z.infer<typeof ApproveKnowledgeInput>, ctx: ToolContext) => {
      const entry = await ctx.store.getKnowledge(args.id);
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
      await ctx.store.putKnowledge(updated);
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
  {
    name: 'apply_skill',
    description:
      'Invoke an approved skill version against a target system; records usage against provenance. ' +
      'Gated by approval. Only approved versions can be applied — pending/revoked versions are rejected ' +
      'with applied=false. Does not modify the skill itself and does not approve new versions.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Namespaced slug, e.g. drama:script-split' },
        version: { type: 'string' },
        target_system_id: { type: 'string', description: 'System the skill is applied to' },
        context: { type: 'string', description: 'Why/how it is applied' },
      },
      required: ['skill_id', 'version', 'target_system_id', 'context'],
    },
    schema: ApplySkillInput,
    handler: async (args: z.infer<typeof ApplySkillInput>, ctx: ToolContext) => {
      const skill = await ctx.skillStore.get(args.skillId, args.version);
      if (!skill) {
        return { usageId: null, applied: false, reason: 'skill_not_found' };
      }
      if (skill.status !== 'approved') {
        return { usageId: null, applied: false, reason: `skill_not_approved:${skill.status}` };
      }
      const record: SkillUsageRecord = {
        id: `su-${randomUUID()}`,
        skillId: skill.id,
        version: skill.version,
        targetSystemId: args.targetSystemId,
        context: args.context,
        appliedBy: ctx.principal.id,
        appliedAt: new Date().toISOString(),
      };
      await ctx.store.appendSkillUsage(record);
      return { usageId: record.id, applied: true };
    },
  },
  {
    name: 'generate_system_spec',
    description:
      'Draft a System Spec from requirements plus approved skills/knowledge. Gated by approval. ' +
      'Draft only — does not trigger code generation; submit the draft with submit_system_spec. ' +
      'Every source_skill_id/source_knowledge_id must resolve to an approved entry; the draft ' +
      'records that provenance. When entities are omitted a deterministic scaffold entity is drafted.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1 },
        business_domain: { type: 'string', minLength: 1 },
        requirements: { type: 'string', minLength: 1, description: 'Free-text requirements the draft is built from' },
        entities: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              fields: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string', enum: ['string', 'number', 'boolean', 'datetime', 'json'] },
                    required: { type: 'boolean' },
                    description: { type: 'string' },
                  },
                  required: ['name', 'type', 'required'],
                },
              },
              permissions: { type: 'array', items: { type: 'string' }, default: ['read'] },
            },
            required: ['name', 'fields'],
          },
        },
        workflows: { type: 'array', items: { type: 'string' }, default: [] },
        source_skill_ids: { type: 'array', items: { type: 'string' }, default: [], description: 'Approved skill ids this spec builds on' },
        source_knowledge_ids: { type: 'array', items: { type: 'string' }, default: [], description: 'Approved knowledge entry ids this spec builds on' },
      },
      required: ['title', 'business_domain', 'requirements'],
    },
    schema: GenerateSystemSpecInput,
    handler: async (args: z.infer<typeof GenerateSystemSpecInput>, ctx: ToolContext) => {
      // Provenance gate: a spec can only build on approved capabilities/knowledge.
      if (args.sourceSkillIds.length > 0) {
        const approved = await ctx.skillStore.search({ onlyApproved: true });
        for (const sid of args.sourceSkillIds) {
          if (!approved.some(s => s.id === sid)) {
            throw new ToolRejection(
              'skill_not_approved',
              `Source skill ${sid} has no approved version; a spec can only build on approved skills`,
            );
          }
        }
      }
      for (const kid of args.sourceKnowledgeIds) {
        const entry = await ctx.store.getKnowledge(kid);
        if (!entry) {
          throw new ToolRejection('knowledge_not_found', `Source knowledge entry ${kid} does not exist`);
        }
        if (entry.status !== 'approved') {
          throw new ToolRejection(
            'knowledge_not_approved',
            `Source knowledge entry ${kid} has status ${entry.status}; only approved entries can source a spec`,
          );
        }
      }
      const slug = args.businessDomain.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'core';
      const entities: SystemEntity[] = args.entities ?? [{
        name: `${slug}_record`,
        fields: [
          { name: 'id', type: 'string', required: true, description: 'Primary key' },
          { name: 'title', type: 'string', required: true },
          { name: 'status', type: 'string', required: true, description: 'Lifecycle state' },
          { name: 'created_at', type: 'datetime', required: true },
        ],
        permissions: ['read'],
      }];
      const spec: SystemSpec = {
        id: `spec-${randomUUID()}`,
        title: args.title,
        businessDomain: args.businessDomain,
        requirements: args.requirements,
        entities,
        workflows: args.workflows,
        sourceSkillIds: args.sourceSkillIds,
        sourceKnowledgeIds: args.sourceKnowledgeIds,
        status: 'draft',
        createdAt: new Date().toISOString(),
        approvedAt: null,
        approvedBy: null,
      };
      await ctx.store.putSpec(spec);
      return { specId: spec.id, status: spec.status, spec };
    },
  },
  {
    name: 'submit_system_spec',
    description:
      'Submit a draft System Spec for approval; the confirmation token IS the approval, so the ' +
      'spec transitions draft → approved with approver and timestamp stamped from the authenticated ' +
      'principal. High risk, always gated. Does not modify spec content and cannot reopen an ' +
      'approved spec — draft a new spec instead.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        spec_id: { type: 'string', minLength: 1, description: 'Spec id returned by generate_system_spec' },
      },
      required: ['spec_id'],
    },
    schema: SubmitSystemSpecInput,
    handler: async (args: z.infer<typeof SubmitSystemSpecInput>, ctx: ToolContext) => {
      const spec = await ctx.store.getSpec(args.specId);
      if (!spec) {
        throw new ToolRejection('spec_not_found', `System spec ${args.specId} does not exist`);
      }
      if (spec.status !== 'draft') {
        throw new ToolRejection(
          'invalid_status_transition',
          `System spec ${args.specId} has status ${spec.status}; only drafts can be submitted`,
        );
      }
      const approved: SystemSpec = {
        ...spec,
        status: 'approved',
        approvedAt: new Date().toISOString(),
        approvedBy: ctx.principal.id,
      };
      await ctx.store.putSpec(approved);
      return { spec: approved };
    },
  },
  {
    name: 'search_specs',
    description:
      'Query System Specs by status and title/domain substring. Read-only; ' +
      'drafts are visible so reviewers can find work awaiting submit_system_spec.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'pending_approval', 'approved', 'rejected', 'generated'] },
        query: { type: 'string', description: 'Substring match on title and business domain' },
        limit: { type: 'integer', default: 20, maximum: 50 },
      },
    },
    schema: SearchSpecsInput,
    handler: async (args: z.infer<typeof SearchSpecsInput>, ctx: ToolContext) => {
      let specs = await ctx.store.listSpecs(args.status);
      if (args.query) {
        const q = args.query.toLowerCase();
        specs = specs.filter(s => `${s.title} ${s.businessDomain}`.toLowerCase().includes(q));
      }
      return { specs: specs.slice(0, args.limit) };
    },
  },
  {
    name: 'register_generated_system',
    description:
      'Register a built system as a governed asset, linked to an approved System Spec. ' +
      'High risk, always gated. Provenance (source skills/knowledge) is copied from the spec, and ' +
      'the spec transitions approved → generated. Registration only — does not deploy, start, or ' +
      'expose the system; deployment goes through the Deployment Plane (ADR 0009).',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        source_spec_id: { type: 'string', minLength: 1, description: 'Approved spec this system was built from' },
        name: { type: 'string', minLength: 1 },
        version: { type: 'string', minLength: 1, description: 'System version, e.g. 0.1.0' },
        endpoint_uri: { type: 'string', format: 'uri', description: 'Optional URL where the system is reachable' },
        blueprint_hash: { type: 'string', description: 'Content hash of the Blueprint the system was compiled from (ADR 0010)' },
        verify_report_ref: { type: 'string', description: 'Run-local reference of the verify-before-register report, e.g. verify://<runId>' },
      },
      required: ['source_spec_id', 'name', 'version'],
    },
    schema: RegisterGeneratedSystemInput,
    handler: async (args: z.infer<typeof RegisterGeneratedSystemInput>, ctx: ToolContext) => {
      const spec = await ctx.store.getSpec(args.sourceSpecId);
      if (!spec) {
        throw new ToolRejection('spec_not_found', `System spec ${args.sourceSpecId} does not exist`);
      }
      if (spec.status !== 'approved') {
        throw new ToolRejection(
          'invalid_status_transition',
          `System spec ${args.sourceSpecId} has status ${spec.status}; only an approved spec can be registered as a system`,
        );
      }
      const system: GeneratedSystem = {
        id: `sys-${randomUUID()}`,
        name: args.name,
        version: args.version,
        sourceSpecId: spec.id,
        endpointUri: args.endpointUri ?? null,
        status: 'registered',
        sourceSkillIds: spec.sourceSkillIds,
        sourceKnowledgeIds: spec.sourceKnowledgeIds,
        blueprintHash: args.blueprintHash ?? null,
        verifyReportRef: args.verifyReportRef ?? null,
        registeredBy: ctx.principal.id,
        createdAt: new Date().toISOString(),
      };
      await ctx.store.putSystem(system);
      const generated: SystemSpec = { ...spec, status: 'generated' };
      await ctx.store.putSpec(generated);
      return { system, spec: generated };
    },
  },
  {
    name: 'search_systems',
    description:
      'Query registered generated systems by status and name substring. Read-only; ' +
      'returns registry metadata and provenance pointers, never runtime internals.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['registered', 'active', 'deprecated'] },
        query: { type: 'string', description: 'Substring match on system name' },
        limit: { type: 'integer', default: 20, maximum: 50 },
      },
    },
    schema: SearchSystemsInput,
    handler: async (args: z.infer<typeof SearchSystemsInput>, ctx: ToolContext) => {
      let systems = await ctx.store.listSystems(args.status);
      if (args.query) {
        const q = args.query.toLowerCase();
        systems = systems.filter(s => s.name.toLowerCase().includes(q));
      }
      return { systems: systems.slice(0, args.limit) };
    },
  },
  {
    name: 'register_deployment_target',
    description:
      'Register a deployment target (cloud, edge box, on-prem machine) into the governed ' +
      'registry. High risk, always gated. Registration only — declares where systems may be ' +
      'installed; does not provision or configure the target.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        kind: { type: 'string', enum: ['cloud', 'edge', 'onprem'] },
        endpoint_uri: { type: 'string', format: 'uri' },
        region: { type: 'string' },
        capacity_notes: { type: 'string', description: 'Free-text capacity, e.g. "4 vCPU / 16GB / no GPU"' },
      },
      required: ['name', 'kind'],
    },
    schema: RegisterDeploymentTargetInput,
    handler: async (args: z.infer<typeof RegisterDeploymentTargetInput>, ctx: ToolContext) => {
      const target: DeploymentTarget = {
        id: `tgt-${randomUUID()}`,
        name: args.name,
        kind: args.kind,
        endpointUri: args.endpointUri ?? null,
        region: args.region ?? null,
        capacityNotes: args.capacityNotes ?? null,
        status: 'active',
        registeredBy: ctx.principal.id,
        createdAt: new Date().toISOString(),
      };
      await ctx.store.putTarget(target);
      return { target };
    },
  },
  {
    name: 'register_deployed_instance',
    description:
      'Record that a registered generated system was installed onto an active target. ' +
      'High risk, always gated. Creates the governed instance with version and deployer ' +
      'provenance; does not itself start or configure anything — actuation is delegated. ' +
      'One live instance per system×target; revoke before reinstalling.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        system_id: { type: 'string', minLength: 1 },
        target_id: { type: 'string', minLength: 1 },
      },
      required: ['system_id', 'target_id'],
    },
    schema: RegisterDeployedInstanceInput,
    handler: async (args: z.infer<typeof RegisterDeployedInstanceInput>, ctx: ToolContext) => {
      const system = await ctx.store.getSystem(args.systemId);
      if (!system) {
        throw new ToolRejection('system_not_found', `Generated system ${args.systemId} is not registered`);
      }
      if (system.status === 'deprecated') {
        throw new ToolRejection('system_deprecated', `Generated system ${args.systemId} is deprecated`);
      }
      const target = await ctx.store.getTarget(args.targetId);
      if (!target) {
        throw new ToolRejection('target_not_found', `Deployment target ${args.targetId} is not registered`);
      }
      if (target.status !== 'active') {
        throw new ToolRejection('target_not_active', `Deployment target ${args.targetId} has status ${target.status}`);
      }
      const live = (await ctx.store.listInstances())
        .filter(i => i.systemId === args.systemId && i.targetId === args.targetId && i.status !== 'revoked');
      if (live.length > 0) {
        throw new ToolRejection(
          'instance_already_live',
          `System ${args.systemId} already has a live instance on target ${args.targetId} (${live[0].id}, ${live[0].status}); revoke it first`,
        );
      }
      const instance: DeployedInstance = {
        id: `inst-${randomUUID()}`,
        systemId: system.id,
        targetId: target.id,
        version: system.version,
        status: 'deployed',
        lastHealthAt: null,
        healthMetrics: {},
        deployedBy: ctx.principal.id,
        createdAt: new Date().toISOString(),
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
      };
      await ctx.store.putInstance(instance);
      return { instance };
    },
  },
  {
    name: 'record_instance_health',
    description:
      'Record a health heartbeat for a deployed instance (healthy/degraded/offline plus ' +
      'optional numeric metrics), as reported by the unit over its peer MCP channel. ' +
      'Gated write; updates status and lastHealthAt. Does not trigger remediation or rollback.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', minLength: 1 },
        status: { type: 'string', enum: ['healthy', 'degraded', 'offline'] },
        metrics: { type: 'object', additionalProperties: { type: 'number' }, default: {} },
      },
      required: ['instance_id', 'status'],
    },
    schema: RecordInstanceHealthInput,
    handler: async (args: z.infer<typeof RecordInstanceHealthInput>, ctx: ToolContext) => {
      const instance = await ctx.store.getInstance(args.instanceId);
      if (!instance) {
        throw new ToolRejection('instance_not_found', `Deployed instance ${args.instanceId} does not exist`);
      }
      if (instance.status === 'revoked') {
        throw new ToolRejection('instance_revoked', `Deployed instance ${args.instanceId} is revoked`);
      }
      const updated: DeployedInstance = {
        ...instance,
        status: args.status === 'healthy' ? 'deployed' : args.status,
        lastHealthAt: new Date().toISOString(),
        healthMetrics: args.metrics,
      };
      await ctx.store.putInstance(updated);
      return { instance: updated };
    },
  },
  {
    name: 'revoke_instance',
    description:
      'Revoke a deployed instance (compromise, policy breach, decommission). High risk, ' +
      'always gated, never auto-approved. Marks the instance revoked with reason and revoker ' +
      'provenance; the revoke order itself reaches the unit over its peer MCP channel.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', minLength: 1 },
        reason: { type: 'string', minLength: 1 },
      },
      required: ['instance_id', 'reason'],
    },
    schema: RevokeInstanceInput,
    handler: async (args: z.infer<typeof RevokeInstanceInput>, ctx: ToolContext) => {
      const instance = await ctx.store.getInstance(args.instanceId);
      if (!instance) {
        throw new ToolRejection('instance_not_found', `Deployed instance ${args.instanceId} does not exist`);
      }
      if (instance.status === 'revoked') {
        throw new ToolRejection('invalid_status_transition', `Deployed instance ${args.instanceId} is already revoked`);
      }
      const revoked: DeployedInstance = {
        ...instance,
        status: 'revoked',
        revokedAt: new Date().toISOString(),
        revokedBy: ctx.principal.id,
        revokeReason: args.reason,
      };
      await ctx.store.putInstance(revoked);
      return { instance: revoked };
    },
  },
  {
    name: 'search_deployments',
    description:
      'List deployment targets and deployed instances, filterable by target kind, instance ' +
      'status, system, or target. Read-only; returns registry metadata, never target internals.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['cloud', 'edge', 'onprem'] },
        status: { type: 'string', enum: ['deployed', 'degraded', 'offline', 'revoked'] },
        system_id: { type: 'string' },
        target_id: { type: 'string' },
        limit: { type: 'integer', default: 20, maximum: 50 },
      },
    },
    schema: SearchDeploymentsInput,
    handler: async (args: z.infer<typeof SearchDeploymentsInput>, ctx: ToolContext) => {
      let targets = await ctx.store.listTargets(args.kind);
      if (args.targetId) targets = targets.filter(t => t.id === args.targetId);
      let instances = await ctx.store.listInstances(args.status);
      if (args.systemId) instances = instances.filter(i => i.systemId === args.systemId);
      if (args.targetId) instances = instances.filter(i => i.targetId === args.targetId);
      return { targets: targets.slice(0, args.limit), instances: instances.slice(0, args.limit) };
    },
  },
  {
    name: 'request_distillation',
    description:
      'Flag an approved skill for distillation. Gated by approval. Records current usage count; ' +
      'at or above the threshold the request lands as awaiting_approval, below it stays queued. ' +
      'Pauses before training — never starts training; a human releases it via approve_distillation.',
    riskLevel: 'medium',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        source_skill_id: { type: 'string', description: 'Approved skill id, e.g. drama:script-split' },
        reason: { type: 'string', description: 'Why this skill should be distilled' },
      },
      required: ['source_skill_id'],
    },
    schema: RequestDistillationInput,
    handler: async (args: z.infer<typeof RequestDistillationInput>, ctx: ToolContext) => {
      const all = await ctx.skillStore.search({ onlyApproved: false });
      const versions = all.filter(s => s.id === args.sourceSkillId);
      if (versions.length === 0) {
        throw new ToolRejection('skill_not_found', `Skill ${args.sourceSkillId} is not registered`);
      }
      if (!versions.some(s => s.status === 'approved')) {
        throw new ToolRejection(
          'skill_not_approved',
          `Skill ${args.sourceSkillId} has no approved version; only approved skills can be distilled`,
        );
      }
      const active = (await ctx.store.listDistillations())
        .filter(d => d.sourceSkillId === args.sourceSkillId
          && (d.status === 'queued' || d.status === 'awaiting_approval' || d.status === 'training'));
      if (active.length > 0) {
        throw new ToolRejection(
          'distillation_already_active',
          `Skill ${args.sourceSkillId} already has an active distillation request (${active[0].id}, ${active[0].status})`,
        );
      }
      const usageCount = (await ctx.store.listSkillUsage(args.sourceSkillId)).length;
      const threshold = ctx.distillationThreshold;
      const request: DistillationRequest = {
        id: `dist-${randomUUID()}`,
        sourceSkillId: args.sourceSkillId,
        usageCount,
        threshold,
        status: usageCount >= threshold ? 'awaiting_approval' : 'queued',
        reason: args.reason ?? null,
        requestedBy: ctx.principal.id,
        requestedAt: new Date().toISOString(),
        approvedAt: null,
        approvedBy: null,
      };
      await ctx.store.putDistillation(request);
      return { request };
    },
  },
  {
    name: 'approve_distillation',
    description:
      'Human decision on an awaiting_approval distillation request: approve releases it to the ' +
      'execution plane (status training), reject closes it (status rejected). High risk, always ' +
      'gated; decider identity from the authenticated principal. Does not run training itself.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', minLength: 1 },
        decision: { type: 'string', enum: ['approve', 'reject'] },
      },
      required: ['request_id', 'decision'],
    },
    schema: ApproveDistillationInput,
    handler: async (args: z.infer<typeof ApproveDistillationInput>, ctx: ToolContext) => {
      const request = await ctx.store.getDistillation(args.requestId);
      if (!request) {
        throw new ToolRejection('distillation_not_found', `Distillation request ${args.requestId} does not exist`);
      }
      if (request.status !== 'awaiting_approval') {
        throw new ToolRejection(
          'invalid_status_transition',
          `Distillation request ${args.requestId} has status ${request.status}; only awaiting_approval can be decided`,
        );
      }
      const decided: DistillationRequest = {
        ...request,
        status: args.decision === 'approve' ? 'training' : 'rejected',
        approvedAt: new Date().toISOString(),
        approvedBy: ctx.principal.id,
      };
      await ctx.store.putDistillation(decided);
      return { request: decided };
    },
  },
  {
    name: 'search_distillations',
    description:
      'Query distillation requests by status or source skill. Read-only; queued and ' +
      'awaiting_approval requests are visible so reviewers can find pending decisions.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['queued', 'awaiting_approval', 'training', 'completed', 'failed', 'rejected'] },
        source_skill_id: { type: 'string' },
        limit: { type: 'integer', default: 20, maximum: 50 },
      },
    },
    schema: SearchDistillationsInput,
    handler: async (args: z.infer<typeof SearchDistillationsInput>, ctx: ToolContext) => {
      let requests = await ctx.store.listDistillations(args.status);
      if (args.sourceSkillId) requests = requests.filter(r => r.sourceSkillId === args.sourceSkillId);
      return { requests: requests.slice(0, args.limit) };
    },
  },
  {
    name: 'register_lora_adapter',
    description:
      'Register a distilled LoRA adapter as a versioned artifact, linked to an approved source skill. ' +
      'High risk, always gated, never auto-approved. Metadata only — does not deploy, load, or serve ' +
      'the adapter, and does not close the distillation request.',
    riskLevel: 'high',
    gated: true,
    scopes: ['Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        source_skill_id: { type: 'string' },
        version: { type: 'string', description: 'Adapter version, e.g. 1.0.0' },
        adapter_uri: { type: 'string', format: 'uri', description: 'Where the adapter weights live' },
        training_data_uri: { type: 'string', format: 'uri', description: 'Where the training set is archived' },
        base_model: { type: 'string' },
        metrics: { type: 'object', additionalProperties: { type: 'number' }, default: {} },
      },
      required: ['source_skill_id', 'version', 'adapter_uri', 'training_data_uri', 'base_model'],
    },
    schema: RegisterLoraAdapterInput,
    handler: async (args: z.infer<typeof RegisterLoraAdapterInput>, ctx: ToolContext) => {
      const approved = await ctx.skillStore.search({ onlyApproved: true });
      if (!approved.some(s => s.id === args.sourceSkillId)) {
        throw new ToolRejection(
          'skill_not_approved',
          `Skill ${args.sourceSkillId} has no approved version; a LoRA artifact must link to an approved skill`,
        );
      }
      const artifact: LoraArtifact = {
        id: `lora-${randomUUID()}`,
        sourceSkillId: args.sourceSkillId,
        version: args.version,
        adapterUri: args.adapterUri,
        trainingDataUri: args.trainingDataUri,
        baseModel: args.baseModel,
        metrics: args.metrics,
        registeredBy: ctx.principal.id,
        createdAt: new Date().toISOString(),
      };
      await ctx.store.putLora(artifact);
      return { artifact };
    },
  },
  {
    name: 'search_loras',
    description:
      'List registered LoRA adapter artifacts, optionally filtered by source skill. ' +
      'Read-only; returns metadata pointers (adapter/training-data URIs, base model, metrics), ' +
      'never the adapter bytes.',
    riskLevel: 'low',
    gated: false,
    scopes: ['Suggest', 'Read', 'Edit'],
    inputSchema: {
      type: 'object',
      properties: {
        source_skill_id: { type: 'string' },
        limit: { type: 'integer', default: 20, maximum: 50 },
      },
    },
    schema: SearchLorasInput,
    handler: async (args: z.infer<typeof SearchLorasInput>, ctx: ToolContext) => {
      const artifacts = await ctx.store.listLoras(args.sourceSkillId);
      return { artifacts: artifacts.slice(0, args.limit) };
    },
  },
];

export function findGatewayTool(name: string): GatewayTool | undefined {
  return GATEWAY_TOOLS.find(t => t.name === name);
}
