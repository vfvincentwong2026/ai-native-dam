import type { Skill, SkillDomain, SkillStatus } from '@ai-native-dam/shared-schema';
import type { SkillSearchFilter, SkillStore } from './skill-store.js';

/**
 * Minimal query interface shared by node-postgres (`pg` Pool/Client) and
 * PGlite, so the same store serves deployment Postgres and embedded local
 * Postgres with one code path.
 */
export interface PgQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Reference DDL — mirrored in migrations/0001_skill_registry.sql and applied
 * idempotently on store startup, so a fresh database self-bootstraps.
 */
export const SKILL_REGISTRY_DDL = `
CREATE TABLE IF NOT EXISTS skill_registry (
  id                text        NOT NULL,
  version           text        NOT NULL,
  name              text        NOT NULL,
  description       text        NOT NULL,
  domain            text        NOT NULL CHECK (domain IN ('ecommerce','short_drama','retail','content','operations','generic')),
  source_sop_id     text,
  status            text        NOT NULL CHECK (status IN ('draft','pending_approval','approved','revoked')),
  approved_at       timestamptz,
  approved_by       text,
  lora_artifact_ref text,
  created_at        timestamptz NOT NULL,
  source_repo       text,
  source_path       text,
  source_commit     text,
  PRIMARY KEY (id, version)
)`;

interface SkillRow {
  id: string;
  version: string;
  name: string;
  description: string;
  domain: SkillDomain;
  source_sop_id: string | null;
  status: SkillStatus;
  approved_at: Date | string | null;
  approved_by: string | null;
  lora_artifact_ref: string | null;
  created_at: Date | string;
  source_repo: string | null;
  source_path: string | null;
  source_commit: string | null;
}

/** pg and PGlite both return Date for timestamptz; normalize to ISO strings. */
function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function rowToSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    domain: row.domain,
    sourceSopId: row.source_sop_id,
    status: row.status,
    approvedAt: iso(row.approved_at),
    approvedBy: row.approved_by,
    loraArtifactRef: row.lora_artifact_ref,
    createdAt: iso(row.created_at) as string,
    sourceRepo: row.source_repo,
    sourcePath: row.source_path,
    sourceCommit: row.source_commit,
  };
}

/**
 * Postgres-backed SkillStore. Use `PgSkillStore.connect(url)` against a real
 * server (docker compose `postgres` service) or `PgSkillStore.embedded(dir)`
 * for a serverless local Postgres via PGlite. Both persist across restarts.
 */
export class PgSkillStore implements SkillStore {
  private constructor(
    private readonly db: PgQueryable,
    private readonly closeFn?: () => Promise<void>,
  ) {}

  /** Real Postgres via DATABASE_URL, e.g. postgres://dam:dam@localhost:5432/dam */
  static async connect(databaseUrl: string): Promise<PgSkillStore> {
    // pg is CJS; named exports are not statically linkable from ESM, so go
    // through the default export with a fallback for interop builds.
    const mod = (await import('pg')) as unknown as {
      Pool?: new (config: { connectionString: string }) => PgQueryable & { end(): Promise<void> };
      default?: { Pool: new (config: { connectionString: string }) => PgQueryable & { end(): Promise<void> } };
    };
    const PoolCtor = mod.default?.Pool ?? mod.Pool;
    if (!PoolCtor) throw new Error('pg Pool export not found');
    const pool = new PoolCtor({ connectionString: databaseUrl });
    const store = new PgSkillStore(pool, () => pool.end());
    await store.init();
    return store;
  }

  /** Embedded Postgres (PGlite) persisted under dataDir — no server install. */
  static async embedded(dataDir: string): Promise<PgSkillStore> {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(dataDir);
    const store = new PgSkillStore(db as unknown as PgQueryable, () => db.close());
    await store.init();
    return store;
  }

  private async init(): Promise<void> {
    await this.db.query(SKILL_REGISTRY_DDL);
  }

  async close(): Promise<void> {
    await this.closeFn?.();
  }

  async get(id: string, version: string): Promise<Skill | undefined> {
    const { rows } = await this.db.query(
      'SELECT * FROM skill_registry WHERE id = $1 AND version = $2',
      [id, version],
    );
    const row = rows[0] as SkillRow | undefined;
    return row ? rowToSkill(row) : undefined;
  }

  async put(skill: Skill): Promise<void> {
    await this.db.query(
      `INSERT INTO skill_registry
         (id, version, name, description, domain, source_sop_id, status,
          approved_at, approved_by, lora_artifact_ref, created_at,
          source_repo, source_path, source_commit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        skill.id,
        skill.version,
        skill.name,
        skill.description,
        skill.domain,
        skill.sourceSopId,
        skill.status,
        skill.approvedAt,
        skill.approvedBy,
        skill.loraArtifactRef,
        skill.createdAt,
        skill.sourceRepo,
        skill.sourcePath,
        skill.sourceCommit,
      ],
    );
  }

  async search(filter: SkillSearchFilter): Promise<Skill[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM skill_registry
       WHERE ($1::text IS NULL OR domain = $1)
         AND ($2::text IS NULL OR lower(name || ' ' || description) LIKE '%' || lower($2) || '%')
         AND (NOT $3::boolean OR status = 'approved')
       ORDER BY id, version`,
      [filter.domain ?? null, filter.query ?? null, filter.onlyApproved ?? false],
    );
    return (rows as SkillRow[]).map(rowToSkill);
  }
}
