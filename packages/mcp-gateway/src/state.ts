import type {
  Asset,
  KnowledgeEntry,
  RightsRecord,
  Skill,
  SkillUsageRecord,
  UsageRecord,
} from '@ai-native-dam/shared-schema';

/**
 * In-memory governance state. Phase 1 keeps state here so the gateway is
 * runnable and testable without Postgres; the store interface is deliberately
 * small so a Postgres-backed implementation can replace it without touching
 * the tool handlers.
 */
export interface GatewayState {
  /** asset id → asset */
  assets: Map<string, Asset>;
  /** asset id → current rights record */
  rights: Map<string, RightsRecord>;
  usage: UsageRecord[];
  /** knowledge entry id → entry */
  knowledge: Map<string, KnowledgeEntry>;
  /** `${skillId}@${version}` → skill */
  skills: Map<string, Skill>;
  /** Skill application records — feeds the future distillation gate (N uses). */
  skillUsage: SkillUsageRecord[];
}

export interface StateSeed {
  assets?: Asset[];
  rights?: RightsRecord[];
  usage?: UsageRecord[];
  knowledge?: KnowledgeEntry[];
  skills?: Skill[];
  skillUsage?: SkillUsageRecord[];
}

export function createState(seed: StateSeed = {}): GatewayState {
  const state: GatewayState = {
    assets: new Map(),
    rights: new Map(),
    usage: [],
    knowledge: new Map(),
    skills: new Map(),
    skillUsage: [],
  };
  for (const asset of seed.assets ?? []) state.assets.set(asset.id, asset);
  for (const rights of seed.rights ?? []) state.rights.set(rights.assetId, rights);
  state.usage.push(...(seed.usage ?? []));
  for (const entry of seed.knowledge ?? []) state.knowledge.set(entry.id, entry);
  for (const skill of seed.skills ?? []) state.skills.set(`${skill.id}@${skill.version}`, skill);
  state.skillUsage.push(...(seed.skillUsage ?? []));
  return state;
}
