import type { Skill, SkillDomain } from '@ai-native-dam/shared-schema';

/**
 * Skill Registry persistence interface. Tool handlers only know this
 * interface; the backing implementation can be in-memory (dev/tests),
 * embedded Postgres (PGlite, no server install), or a real Postgres pool
 * (deployment) without touching tool code.
 */
export interface SkillSearchFilter {
  domain?: SkillDomain;
  query?: string;
  onlyApproved?: boolean;
}

export interface SkillStore {
  /** Fetch one pinned version, or undefined when absent. */
  get(id: string, version: string): Promise<Skill | undefined>;
  /** Insert a new skill version. Callers must check `get` first. */
  put(skill: Skill): Promise<void>;
  /** Registry search: exact domain, substring query, approval flag. */
  search(filter: SkillSearchFilter): Promise<Skill[]>;
  /**
   * Transition draft/pending_approval → approved, stamping approver and time.
   * Returns the updated skill, or undefined when the version is missing or
   * already in a non-approvable state (approved / revoked) — callers use
   * `get` to distinguish.
   */
  approve(id: string, version: string, approvedBy: string, approvedAt: string): Promise<Skill | undefined>;
  /** Release connections / flush files. Optional; memory store has none. */
  close?(): Promise<void>;
}

function matches(skill: Skill, filter: SkillSearchFilter): boolean {
  if (filter.domain && skill.domain !== filter.domain) return false;
  if (filter.onlyApproved && skill.status !== 'approved') return false;
  if (filter.query) {
    const q = filter.query.toLowerCase();
    if (!`${skill.name} ${skill.description}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

/**
 * Map-backed store. Shares the given map with `GatewayState.skills` so
 * existing seeding and tests keep working unchanged.
 */
export class MemorySkillStore implements SkillStore {
  constructor(private readonly skills: Map<string, Skill> = new Map()) {}

  async get(id: string, version: string): Promise<Skill | undefined> {
    return this.skills.get(`${id}@${version}`);
  }

  async put(skill: Skill): Promise<void> {
    this.skills.set(`${skill.id}@${skill.version}`, skill);
  }

  async search(filter: SkillSearchFilter): Promise<Skill[]> {
    return [...this.skills.values()].filter(s => matches(s, filter));
  }

  async approve(
    id: string,
    version: string,
    approvedBy: string,
    approvedAt: string,
  ): Promise<Skill | undefined> {
    const key = `${id}@${version}`;
    const skill = this.skills.get(key);
    if (!skill || (skill.status !== 'draft' && skill.status !== 'pending_approval')) {
      return undefined;
    }
    const updated: Skill = { ...skill, status: 'approved', approvedBy, approvedAt };
    this.skills.set(key, updated);
    return updated;
  }
}
