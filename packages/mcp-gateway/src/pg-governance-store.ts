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
import type { PgQueryable } from './pg-backend.js';
import type { GovernanceStore, KnowledgeSearchFilter } from './governance-store.js';

/**
 * Reference DDL — mirrored in migrations/0002_governance_state.sql and applied
 * idempotently on store startup, so a fresh database self-bootstraps.
 */
export const GOVERNANCE_DDL = `
CREATE TABLE IF NOT EXISTS assets (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    integer NOT NULL DEFAULT 0,
  tags          text[] NOT NULL DEFAULT '{}',
  rendition_url text NOT NULL,
  rights_status text NOT NULL CHECK (rights_status IN ('Cleared','Restricted','Expired','Pending')),
  created_at    timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_rights (
  asset_id      text PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  license       text NOT NULL,
  territories   text[] NOT NULL,
  channels      text[] NOT NULL,
  embargo_until timestamptz,
  expires_at    timestamptz,
  status        text NOT NULL CHECK (status IN ('Cleared','Restricted','Expired','Pending'))
);
CREATE TABLE IF NOT EXISTS usage_records (
  id          text PRIMARY KEY,
  asset_id    text NOT NULL,
  channel     text NOT NULL,
  territory   text,
  context     text,
  recorded_at timestamptz NOT NULL,
  recorded_by text NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id               text PRIMARY KEY,
  title            text NOT NULL,
  layer            text NOT NULL CHECK (layer IN ('raw','topic','manual','rule','qa')),
  content          text NOT NULL,
  source_asset_ids text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL CHECK (status IN ('draft','pending_approval','approved','revoked')),
  created_at       timestamptz NOT NULL,
  approved_at      timestamptz
);
CREATE TABLE IF NOT EXISTS skill_usage_records (
  id               text PRIMARY KEY,
  skill_id         text NOT NULL,
  version          text NOT NULL,
  target_system_id text NOT NULL,
  context          text NOT NULL,
  applied_by       text NOT NULL,
  applied_at       timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS system_specs (
  id                   text PRIMARY KEY,
  title                text NOT NULL,
  business_domain      text NOT NULL,
  requirements         text NOT NULL,
  entities             jsonb NOT NULL,
  workflows            text[] NOT NULL DEFAULT '{}',
  source_skill_ids     text[] NOT NULL DEFAULT '{}',
  source_knowledge_ids text[] NOT NULL DEFAULT '{}',
  status               text NOT NULL CHECK (status IN ('draft','pending_approval','approved','rejected','generated')),
  created_at           timestamptz NOT NULL,
  approved_at          timestamptz,
  approved_by          text
)`;

/** pg and PGlite both return Date for timestamptz; normalize to ISO strings. */
function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToAsset(r: any): Asset {
  return {
    id: r.id,
    title: r.title,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    tags: r.tags ?? [],
    renditionUrl: r.rendition_url,
    rightsStatus: r.rights_status,
    createdAt: iso(r.created_at) as string,
  };
}

function rowToRights(r: any): RightsRecord {
  return {
    assetId: r.asset_id,
    license: r.license,
    territories: r.territories ?? [],
    channels: r.channels ?? [],
    embargoUntil: iso(r.embargo_until),
    expiresAt: iso(r.expires_at),
    status: r.status,
  };
}

function rowToUsage(r: any): UsageRecord {
  return {
    id: r.id,
    assetId: r.asset_id,
    channel: r.channel,
    territory: r.territory ?? undefined,
    context: r.context ?? undefined,
    recordedAt: iso(r.recorded_at) as string,
    recordedBy: r.recorded_by,
  };
}

function rowToKnowledge(r: any): KnowledgeEntry {
  return {
    id: r.id,
    title: r.title,
    layer: r.layer,
    content: r.content,
    sourceAssetIds: r.source_asset_ids ?? [],
    status: r.status,
    createdAt: iso(r.created_at) as string,
    approvedAt: iso(r.approved_at),
  };
}

function rowToSkillUsage(r: any): SkillUsageRecord {
  return {
    id: r.id,
    skillId: r.skill_id,
    version: r.version,
    targetSystemId: r.target_system_id,
    context: r.context,
    appliedBy: r.applied_by,
    appliedAt: iso(r.applied_at) as string,
  };
}

function rowToSpec(r: any): SystemSpec {
  return {
    id: r.id,
    title: r.title,
    businessDomain: r.business_domain,
    requirements: r.requirements,
    entities: r.entities,
    workflows: r.workflows ?? [],
    sourceSkillIds: r.source_skill_ids ?? [],
    sourceKnowledgeIds: r.source_knowledge_ids ?? [],
    status: r.status,
    createdAt: iso(r.created_at) as string,
    approvedAt: iso(r.approved_at),
    approvedBy: r.approved_by ?? null,
  };
}

/** Postgres-backed GovernanceStore. Build over a shared backend (`over`). */
export class PgGovernanceStore implements GovernanceStore {
  private constructor(private readonly db: PgQueryable) {}

  /** Share an existing backend (one connection, several stores); the caller owns close(). */
  static async over(db: PgQueryable): Promise<PgGovernanceStore> {
    const store = new PgGovernanceStore(db);
    await store.init();
    return store;
  }

  private async init(): Promise<void> {
    // PGlite's query() only accepts a single statement, so apply each
    // CREATE TABLE separately (no semicolons appear inside the statements).
    const statements = GOVERNANCE_DDL.split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await this.db.query(statement);
    }
  }

  async getAsset(id: string): Promise<Asset | undefined> {
    const { rows } = await this.db.query('SELECT * FROM assets WHERE id = $1', [id]);
    return rows[0] ? rowToAsset(rows[0]) : undefined;
  }

  async putAsset(asset: Asset): Promise<void> {
    await this.db.query(
      `INSERT INTO assets (id, title, mime_type, size_bytes, tags, rendition_url, rights_status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes,
         tags = EXCLUDED.tags, rendition_url = EXCLUDED.rendition_url,
         rights_status = EXCLUDED.rights_status, created_at = EXCLUDED.created_at`,
      [asset.id, asset.title, asset.mimeType, asset.sizeBytes, asset.tags, asset.renditionUrl, asset.rightsStatus, asset.createdAt],
    );
  }

  async listAssetsWithRights(): Promise<AssetWithRights[]> {
    const { rows } = await this.db.query(
      `SELECT a.*, r.asset_id AS r_asset_id, r.license AS r_license, r.territories AS r_territories,
              r.channels AS r_channels, r.embargo_until AS r_embargo_until, r.expires_at AS r_expires_at,
              r.status AS r_status
       FROM assets a LEFT JOIN asset_rights r ON r.asset_id = a.id
       ORDER BY a.created_at, a.id`,
    );
    return rows.map((row: any) => ({
      asset: rowToAsset(row),
      rights: row.r_asset_id
        ? rowToRights({
            asset_id: row.r_asset_id,
            license: row.r_license,
            territories: row.r_territories,
            channels: row.r_channels,
            embargo_until: row.r_embargo_until,
            expires_at: row.r_expires_at,
            status: row.r_status,
          })
        : null,
    }));
  }

  async getRights(assetId: string): Promise<RightsRecord | undefined> {
    const { rows } = await this.db.query('SELECT * FROM asset_rights WHERE asset_id = $1', [assetId]);
    return rows[0] ? rowToRights(rows[0]) : undefined;
  }

  async putRights(rights: RightsRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO asset_rights (asset_id, license, territories, channels, embargo_until, expires_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (asset_id) DO UPDATE SET
         license = EXCLUDED.license, territories = EXCLUDED.territories, channels = EXCLUDED.channels,
         embargo_until = EXCLUDED.embargo_until, expires_at = EXCLUDED.expires_at, status = EXCLUDED.status`,
      [rights.assetId, rights.license, rights.territories, rights.channels, rights.embargoUntil, rights.expiresAt, rights.status],
    );
  }

  async appendUsage(record: UsageRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO usage_records (id, asset_id, channel, territory, context, recorded_at, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [record.id, record.assetId, record.channel, record.territory ?? null, record.context ?? null, record.recordedAt, record.recordedBy],
    );
  }

  async listUsage(assetId?: string): Promise<UsageRecord[]> {
    const { rows } = assetId
      ? await this.db.query('SELECT * FROM usage_records WHERE asset_id = $1 ORDER BY recorded_at, id', [assetId])
      : await this.db.query('SELECT * FROM usage_records ORDER BY recorded_at, id');
    return rows.map(rowToUsage);
  }

  async getKnowledge(id: string): Promise<KnowledgeEntry | undefined> {
    const { rows } = await this.db.query('SELECT * FROM knowledge_entries WHERE id = $1', [id]);
    return rows[0] ? rowToKnowledge(rows[0]) : undefined;
  }

  async putKnowledge(entry: KnowledgeEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO knowledge_entries (id, title, layer, content, source_asset_ids, status, created_at, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, layer = EXCLUDED.layer, content = EXCLUDED.content,
         source_asset_ids = EXCLUDED.source_asset_ids, status = EXCLUDED.status,
         created_at = EXCLUDED.created_at, approved_at = EXCLUDED.approved_at`,
      [entry.id, entry.title, entry.layer, entry.content, entry.sourceAssetIds, entry.status, entry.createdAt, entry.approvedAt],
    );
  }

  async searchKnowledge(filter: KnowledgeSearchFilter): Promise<KnowledgeEntry[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM knowledge_entries
       WHERE lower(title || ' ' || content) LIKE '%' || lower($1) || '%'
         AND ($2::text IS NULL OR layer = $2)
         AND (NOT $3::boolean OR status = 'approved')
       ORDER BY created_at, id
       LIMIT $4`,
      [filter.query, filter.layer ?? null, filter.onlyApproved ?? true, filter.limit ?? 10],
    );
    return rows.map(rowToKnowledge);
  }

  async appendSkillUsage(record: SkillUsageRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO skill_usage_records (id, skill_id, version, target_system_id, context, applied_by, applied_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [record.id, record.skillId, record.version, record.targetSystemId, record.context, record.appliedBy, record.appliedAt],
    );
  }

  async listSkillUsage(skillId?: string): Promise<SkillUsageRecord[]> {
    const { rows } = skillId
      ? await this.db.query('SELECT * FROM skill_usage_records WHERE skill_id = $1 ORDER BY applied_at, id', [skillId])
      : await this.db.query('SELECT * FROM skill_usage_records ORDER BY applied_at, id');
    return rows.map(rowToSkillUsage);
  }

  async getSpec(id: string): Promise<SystemSpec | undefined> {
    const { rows } = await this.db.query('SELECT * FROM system_specs WHERE id = $1', [id]);
    return rows[0] ? rowToSpec(rows[0]) : undefined;
  }

  async putSpec(spec: SystemSpec): Promise<void> {
    await this.db.query(
      `INSERT INTO system_specs (id, title, business_domain, requirements, entities, workflows,
                                 source_skill_ids, source_knowledge_ids, status, created_at, approved_at, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, business_domain = EXCLUDED.business_domain,
         requirements = EXCLUDED.requirements, entities = EXCLUDED.entities,
         workflows = EXCLUDED.workflows, source_skill_ids = EXCLUDED.source_skill_ids,
         source_knowledge_ids = EXCLUDED.source_knowledge_ids, status = EXCLUDED.status,
         created_at = EXCLUDED.created_at, approved_at = EXCLUDED.approved_at,
         approved_by = EXCLUDED.approved_by`,
      [
        spec.id, spec.title, spec.businessDomain, spec.requirements,
        JSON.stringify(spec.entities), spec.workflows,
        spec.sourceSkillIds, spec.sourceKnowledgeIds, spec.status,
        spec.createdAt, spec.approvedAt, spec.approvedBy,
      ],
    );
  }

  async listSpecs(status?: SystemSpecStatus): Promise<SystemSpec[]> {
    const { rows } = status
      ? await this.db.query('SELECT * FROM system_specs WHERE status = $1 ORDER BY created_at, id', [status])
      : await this.db.query('SELECT * FROM system_specs ORDER BY created_at, id');
    return rows.map(rowToSpec);
  }
}
