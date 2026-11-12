import type {
  Asset,
  KnowledgeEntry,
  RightsRecord,
  SkillUsageRecord,
  SystemSpec,
  SystemSpecStatus,
  UsageRecord,
} from '@ai-native-dam/shared-schema';
import type { AssetWithRights } from '@ai-native-dam/governance';
import type { GatewayState } from './state.js';

/**
 * Persistence interface for the governance collections (assets, rights,
 * usage, knowledge, skill usage, system specs). Tool handlers only know this
 * interface; like SkillStore (ADR 0004) it can be backed by in-memory state,
 * embedded PGlite, or a real Postgres pool without touching tool code.
 */
export interface KnowledgeSearchFilter {
  query: string;
  layer?: KnowledgeEntry['layer'];
  /** Defaults to true: unapproved entries are hidden unless explicitly requested. */
  onlyApproved?: boolean;
  limit?: number;
}

export interface GovernanceStore {
  getAsset(id: string): Promise<Asset | undefined>;
  putAsset(asset: Asset): Promise<void>;
  /** Every asset joined with its current rights record (null when unset). */
  listAssetsWithRights(): Promise<AssetWithRights[]>;

  getRights(assetId: string): Promise<RightsRecord | undefined>;
  putRights(rights: RightsRecord): Promise<void>;

  appendUsage(record: UsageRecord): Promise<void>;
  listUsage(assetId?: string): Promise<UsageRecord[]>;

  getKnowledge(id: string): Promise<KnowledgeEntry | undefined>;
  putKnowledge(entry: KnowledgeEntry): Promise<void>;
  searchKnowledge(filter: KnowledgeSearchFilter): Promise<KnowledgeEntry[]>;

  appendSkillUsage(record: SkillUsageRecord): Promise<void>;
  listSkillUsage(skillId?: string): Promise<SkillUsageRecord[]>;

  getSpec(id: string): Promise<SystemSpec | undefined>;
  putSpec(spec: SystemSpec): Promise<void>;
  listSpecs(status?: SystemSpecStatus): Promise<SystemSpec[]>;

  close?(): Promise<void>;
}

/**
 * State-backed store: wraps the existing in-memory GatewayState so seeding
 * and tests keep working unchanged. This is the dev/test default.
 */
export class MemoryGovernanceStore implements GovernanceStore {
  constructor(private readonly state: GatewayState) {}

  async getAsset(id: string): Promise<Asset | undefined> {
    return this.state.assets.get(id);
  }

  async putAsset(asset: Asset): Promise<void> {
    this.state.assets.set(asset.id, asset);
  }

  async listAssetsWithRights(): Promise<AssetWithRights[]> {
    return [...this.state.assets.values()].map(asset => ({
      asset,
      rights: this.state.rights.get(asset.id) ?? null,
    }));
  }

  async getRights(assetId: string): Promise<RightsRecord | undefined> {
    return this.state.rights.get(assetId);
  }

  async putRights(rights: RightsRecord): Promise<void> {
    this.state.rights.set(rights.assetId, rights);
  }

  async appendUsage(record: UsageRecord): Promise<void> {
    this.state.usage.push(record);
  }

  async listUsage(assetId?: string): Promise<UsageRecord[]> {
    return assetId ? this.state.usage.filter(u => u.assetId === assetId) : [...this.state.usage];
  }

  async getKnowledge(id: string): Promise<KnowledgeEntry | undefined> {
    return this.state.knowledge.get(id);
  }

  async putKnowledge(entry: KnowledgeEntry): Promise<void> {
    this.state.knowledge.set(entry.id, entry);
  }

  async searchKnowledge(filter: KnowledgeSearchFilter): Promise<KnowledgeEntry[]> {
    const q = filter.query.toLowerCase();
    return [...this.state.knowledge.values()]
      .filter(e => `${e.title} ${e.content}`.toLowerCase().includes(q))
      .filter(e => !filter.layer || e.layer === filter.layer)
      .filter(e => !(filter.onlyApproved ?? true) || e.status === 'approved')
      .slice(0, filter.limit ?? 10);
  }

  async appendSkillUsage(record: SkillUsageRecord): Promise<void> {
    this.state.skillUsage.push(record);
  }

  async listSkillUsage(skillId?: string): Promise<SkillUsageRecord[]> {
    return skillId ? this.state.skillUsage.filter(u => u.skillId === skillId) : [...this.state.skillUsage];
  }

  async getSpec(id: string): Promise<SystemSpec | undefined> {
    return this.state.specs.get(id);
  }

  async putSpec(spec: SystemSpec): Promise<void> {
    this.state.specs.set(spec.id, spec);
  }

  async listSpecs(status?: SystemSpecStatus): Promise<SystemSpec[]> {
    const all = [...this.state.specs.values()];
    return status ? all.filter(s => s.status === status) : all;
  }
}
