/**
 * Durable Object SQLite-backed SkillStore — the Workers deployment backend.
 *
 * Same contract as MemorySkillStore / PgSkillStore, backed by the DO's
 * embedded SQLite (`ctx.storage.sql`). Schema mirrors
 * migrations/0001_skill_registry.sql (timestamptz → TEXT, PG params → ?).
 *
 * Race-safety: a Durable Object processes requests single-threaded, so the
 * read-check-write pattern below cannot interleave.
 */
import type { Skill, SkillDomain } from '@ai-native-dam/shared-schema';
import type { SkillSearchFilter, SkillStore } from './skill-store.js';

/** Minimal structural type for ctx.storage.sql — keeps this file free of workerd types. */
interface SqlCursorLike {
  toArray(): Record<string, unknown>[];
}
interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

const DDL = `
CREATE TABLE IF NOT EXISTS skill_registry (
  id                TEXT NOT NULL,
  version           TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  domain            TEXT NOT NULL CHECK (domain IN ('ecommerce','short_drama','retail','content','operations','generic')),
  source_sop_id     TEXT,
  status            TEXT NOT NULL CHECK (status IN ('draft','pending_approval','approved','revoked')),
  approved_at       TEXT,
  approved_by       TEXT,
  lora_artifact_ref TEXT,
  created_at        TEXT NOT NULL,
  source_repo       TEXT,
  source_path       TEXT,
  source_commit     TEXT,
  PRIMARY KEY (id, version)
)`;

function rowToSkill(row: Record<string, unknown>): Skill {
  return {
    id: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    domain: row.domain as SkillDomain,
    sourceSopId: (row.source_sop_id as string | null) ?? null,
    status: row.status as Skill['status'],
    approvedAt: (row.approved_at as string | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    loraArtifactRef: (row.lora_artifact_ref as string | null) ?? null,
    createdAt: row.created_at,
    sourceRepo: (row.source_repo as string | null) ?? null,
    sourcePath: (row.source_path as string | null) ?? null,
    sourceCommit: (row.source_commit as string | null) ?? null,
  } as Skill;
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

export class DoSkillStore implements SkillStore {
  constructor(private readonly sql: SqlStorageLike) {
    this.sql.exec(DDL);
  }

  async get(id: string, version: string): Promise<Skill | undefined> {
    const rows = this.sql
      .exec('SELECT * FROM skill_registry WHERE id = ? AND version = ?', id, version)
      .toArray();
    return rows.length ? rowToSkill(rows[0]) : undefined;
  }

  async put(skill: Skill): Promise<void> {
    this.sql.exec(
      `INSERT INTO skill_registry
         (id, version, name, description, domain, source_sop_id, status,
          approved_at, approved_by, lora_artifact_ref, created_at,
          source_repo, source_path, source_commit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      skill.id, skill.version, skill.name, skill.description, skill.domain,
      skill.sourceSopId, skill.status, skill.approvedAt, skill.approvedBy,
      skill.loraArtifactRef, skill.createdAt,
      skill.sourceRepo, skill.sourcePath, skill.sourceCommit,
    );
  }

  async search(filter: SkillSearchFilter): Promise<Skill[]> {
    const rows = this.sql.exec('SELECT * FROM skill_registry').toArray();
    return rows.map(rowToSkill).filter(s => matches(s, filter));
  }

  async approve(
    id: string,
    version: string,
    approvedBy: string,
    approvedAt: string,
  ): Promise<Skill | undefined> {
    const current = await this.get(id, version);
    if (!current || (current.status !== 'draft' && current.status !== 'pending_approval')) {
      return undefined;
    }
    this.sql.exec(
      `UPDATE skill_registry SET status = 'approved', approved_by = ?, approved_at = ?
       WHERE id = ? AND version = ?`,
      approvedBy, approvedAt, id, version,
    );
    return this.get(id, version);
  }

  async revoke(id: string, version: string): Promise<Skill | undefined> {
    const current = await this.get(id, version);
    if (!current || current.status === 'revoked') return undefined;
    this.sql.exec(
      `UPDATE skill_registry SET status = 'revoked' WHERE id = ? AND version = ?`,
      id, version,
    );
    return this.get(id, version);
  }
}
