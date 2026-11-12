import type { Skill, SkillDomain, SkillStatus } from '@ai-native-dam/shared-schema';
import { openPgBackend, type PgQueryable } from './pg-backend.js';
import type { SkillSearchFilter, SkillStore } from './skill-store.js';

export type { PgQueryable } from './pg-backend.js';

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
    const backend = await openPgBackend({ databaseUrl });
    const store = new PgSkillStore(backend.db, backend.close);
    await store.init();
    return store;
  }

  /** Embedded Postgres (PGlite) persisted under dataDir — no server install. */
  static async embedded(dataDir: string): Promise<PgSkillStore> {
    const backend = await openPgBackend({ dataDir });
    const store = new PgSkillStore(backend.db, backend.close);
    await store.init();
    return store;
  }

  /** Share an existing backend (one connection, several stores); the caller owns close(). */
  static async over(db: PgQueryable): Promise<PgSkillStore> {
    const store = new PgSkillStore(db);
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

  async approve(
    id: string,
    version: string,
    approvedBy: string,
    approvedAt: string,
  ): Promise<Skill | undefined> {
    // Atomic transition guard: only draft/pending_approval can be approved.
    const { rows } = await this.db.query(
      `UPDATE skill_registry
       SET status = 'approved', approved_by = $3, approved_at = $4
       WHERE id = $1 AND version = $2 AND status IN ('draft', 'pending_approval')
       RETURNING *`,
      [id, version, approvedBy, approvedAt],
    );
    const row = rows[0] as SkillRow | undefined;
    return row ? rowToSkill(row) : undefined;
  }

  async revoke(id: string, version: string): Promise<Skill | undefined> {
    // Atomic transition guard: revoking twice or a missing version is a no-row no-op.
    const { rows } = await this.db.query(
      `UPDATE skill_registry
       SET status = 'revoked'
       WHERE id = $1 AND version = $2 AND status <> 'revoked'
       RETURNING *`,
      [id, version],
    );
    const row = rows[0] as SkillRow | undefined;
    return row ? rowToSkill(row) : undefined;
  }
}
