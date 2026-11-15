import type { GovernanceStore } from './governance-store.js';
import type { SkillStore } from './skill-store.js';

/**
 * Read-only aggregate view of the governance plane (GET /overview).
 * Built purely on the store interfaces so it works identically over
 * in-memory state, embedded PGlite, or a real Postgres pool.
 *
 * Powers the public governance dashboard snapshot sync — keep it
 * aggregates + short operational lists only; never include secrets,
 * tokens, or free-text payloads beyond titles/names.
 */
export interface OverviewDeps {
  store: GovernanceStore;
  skillStore: SkillStore;
  serverName: string;
  serverVersion: string;
  now?: () => Date;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const LIST_CAP = 20;
const RECENT_CAP = 8;

function byCreatedAtDesc<T extends { createdAt: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function buildOverview(deps: OverviewDeps) {
  const { store, skillStore } = deps;
  const [skills, specs, distillations, systems, targets, instances, assetsWithRights, usage] =
    await Promise.all([
      skillStore.search({ onlyApproved: false }),
      store.listSpecs(),
      store.listDistillations(),
      store.listSystems(),
      store.listTargets(),
      store.listInstances(),
      store.listAssetsWithRights(),
      store.listUsage(),
    ]);

  return {
    server: deps.serverName,
    version: deps.serverVersion,
    generated_at: (deps.now?.() ?? new Date()).toISOString(),
    skills: {
      total: skills.length,
      by_status: countBy(skills, s => s.status),
      by_domain: countBy(skills, s => s.domain),
      pending_approval: skills
        .filter(s => s.status === 'pending_approval')
        .slice(0, LIST_CAP)
        .map(s => ({ id: s.id, version: s.version, name: s.name, domain: s.domain, created_at: s.createdAt })),
      recent: byCreatedAtDesc(skills)
        .slice(0, RECENT_CAP)
        .map(s => ({ id: s.id, version: s.version, name: s.name, domain: s.domain, status: s.status, created_at: s.createdAt })),
    },
    specs: {
      total: specs.length,
      by_status: countBy(specs, s => s.status),
      pending_approval: specs
        .filter(s => s.status === 'pending_approval')
        .slice(0, LIST_CAP)
        .map(s => ({ id: s.id, title: s.title, business_domain: s.businessDomain, created_at: s.createdAt })),
      recent: byCreatedAtDesc(specs)
        .slice(0, RECENT_CAP)
        .map(s => ({ id: s.id, title: s.title, business_domain: s.businessDomain, status: s.status, created_at: s.createdAt })),
    },
    distillations: {
      total: distillations.length,
      by_status: countBy(distillations, d => d.status),
      awaiting_approval: distillations
        .filter(d => d.status === 'awaiting_approval')
        .slice(0, LIST_CAP)
        .map(d => ({
          id: d.id,
          source_skill_id: d.sourceSkillId,
          usage_count: d.usageCount,
          threshold: d.threshold,
          requested_by: d.requestedBy,
        })),
    },
    systems: {
      total: systems.length,
      by_status: countBy(systems, s => s.status),
      recent: byCreatedAtDesc(systems)
        .slice(0, RECENT_CAP)
        .map(s => ({ id: s.id, name: s.name, version: s.version, status: s.status, created_at: s.createdAt })),
    },
    deployments: {
      targets: {
        total: targets.length,
        by_kind: countBy(targets, t => t.kind),
        by_status: countBy(targets, t => t.status),
      },
      instances: {
        total: instances.length,
        by_status: countBy(instances, i => i.status),
        attention: instances
          .filter(i => i.status === 'degraded' || i.status === 'offline')
          .slice(0, LIST_CAP)
          .map(i => ({
            id: i.id,
            system_id: i.systemId,
            target_id: i.targetId,
            status: i.status,
            last_health_at: i.lastHealthAt,
          })),
        recent: byCreatedAtDesc(instances)
          .slice(0, RECENT_CAP)
          .map(i => ({
            id: i.id,
            system_id: i.systemId,
            target_id: i.targetId,
            version: i.version,
            status: i.status,
            last_health_at: i.lastHealthAt,
          })),
      },
    },
    assets: {
      total: assetsWithRights.length,
      with_rights: assetsWithRights.filter(a => a.rights !== null).length,
      by_rights_status: countBy(
        assetsWithRights.filter(a => a.rights !== null),
        a => a.rights!.status,
      ),
    },
    usage: { total_records: usage.length },
  };
}

export type GovernanceOverview = Awaited<ReturnType<typeof buildOverview>>;
