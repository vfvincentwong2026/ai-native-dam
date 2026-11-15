/**
 * Durable Object SQLite-backed persistence for the remaining in-memory
 * gateway state: approval challenges, assets, rights records, and the two
 * append-only usage logs.
 *
 * Same write-through pattern as DoKnowledgeMap / DoSkillStore: the DO's
 * embedded SQLite (`ctx.storage.sql`) is synchronous, so Maps/arrays hydrate
 * in the constructor and persist on every mutation. A Durable Object
 * processes requests single-threaded, so the mirror and the rows cannot
 * diverge. After this, a DO eviction loses nothing.
 */
import type {
  Asset,
  RightsRecord,
  SkillUsageRecord,
  UsageRecord,
} from '@ai-native-dam/shared-schema';
import type { ApprovalEntry, ApprovalStore } from './approval.js';

/** Minimal structural type for ctx.storage.sql — keeps this file free of workerd types. */
interface SqlCursorLike {
  toArray(): Record<string, unknown>[];
}
interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

const DDL = `
CREATE TABLE IF NOT EXISTS approval_entries (
  key        TEXT PRIMARY KEY,
  token      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assets (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  tags          TEXT NOT NULL DEFAULT '[]',
  rendition_url TEXT NOT NULL,
  rights_status TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rights_records (
  asset_id      TEXT PRIMARY KEY,
  license       TEXT NOT NULL,
  territories   TEXT NOT NULL,
  channels      TEXT NOT NULL,
  embargo_until TEXT,
  expires_at    TEXT,
  status        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_records (
  id          TEXT PRIMARY KEY,
  asset_id    TEXT NOT NULL,
  channel     TEXT NOT NULL,
  territory   TEXT,
  context     TEXT,
  recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skill_usage_records (
  id               TEXT PRIMARY KEY,
  skill_id         TEXT NOT NULL,
  version          TEXT NOT NULL,
  target_system_id TEXT NOT NULL,
  context          TEXT NOT NULL,
  applied_by       TEXT NOT NULL,
  applied_at       TEXT NOT NULL
)`;

/** Approval challenges — tokens survive DO eviction, so the two-call
 *  confirmation flow no longer flakes when the DO is recycled mid-handshake. */
export class DoApprovalStore implements ApprovalStore {
  constructor(private readonly sql: SqlStorageLike) {
    this.sql.exec(DDL);
  }

  async get(key: string): Promise<ApprovalEntry | undefined> {
    const rows = this.sql
      .exec('SELECT * FROM approval_entries WHERE key = ?', key)
      .toArray();
    if (!rows.length) return undefined;
    const row = rows[0];
    return {
      key: row.key,
      token: row.token,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      consumed: row.consumed === 1,
    } as ApprovalEntry;
  }

  async put(entry: ApprovalEntry): Promise<void> {
    this.sql.exec(
      `INSERT OR REPLACE INTO approval_entries (key, token, created_at, expires_at, consumed)
       VALUES (?, ?, ?, ?, ?)`,
      entry.key, entry.token, entry.createdAt, entry.expiresAt, entry.consumed ? 1 : 0,
    );
  }
}

function rowToAsset(row: Record<string, unknown>): Asset {
  return {
    id: row.id,
    title: row.title,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    tags: JSON.parse((row.tags as string) ?? '[]'),
    renditionUrl: row.rendition_url,
    rightsStatus: row.rights_status,
    createdAt: row.created_at,
  } as Asset;
}

export class DoAssetsMap extends Map<string, Asset> {
  constructor(private readonly sql: SqlStorageLike) {
    super();
    this.sql.exec(DDL);
    for (const row of this.sql.exec('SELECT * FROM assets').toArray()) {
      const asset = rowToAsset(row);
      super.set(asset.id, asset);
    }
  }

  override set(id: string, asset: Asset): this {
    super.set(id, asset);
    this.sql.exec(
      `INSERT OR REPLACE INTO assets
         (id, title, mime_type, size_bytes, tags, rendition_url, rights_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      asset.id, asset.title, asset.mimeType, asset.sizeBytes,
      JSON.stringify(asset.tags ?? []), asset.renditionUrl, asset.rightsStatus, asset.createdAt,
    );
    return this;
  }

  override delete(id: string): boolean {
    const existed = super.delete(id);
    this.sql.exec('DELETE FROM assets WHERE id = ?', id);
    return existed;
  }

  override clear(): void {
    super.clear();
    this.sql.exec('DELETE FROM assets');
  }
}

function rowToRights(row: Record<string, unknown>): RightsRecord {
  return {
    assetId: row.asset_id,
    license: row.license,
    territories: JSON.parse(row.territories as string),
    channels: JSON.parse(row.channels as string),
    embargoUntil: (row.embargo_until as string | null) ?? null,
    expiresAt: (row.expires_at as string | null) ?? null,
    status: row.status,
  } as RightsRecord;
}

export class DoRightsMap extends Map<string, RightsRecord> {
  constructor(private readonly sql: SqlStorageLike) {
    super();
    this.sql.exec(DDL);
    for (const row of this.sql.exec('SELECT * FROM rights_records').toArray()) {
      const rights = rowToRights(row);
      super.set(rights.assetId, rights);
    }
  }

  override set(assetId: string, rights: RightsRecord): this {
    super.set(assetId, rights);
    this.sql.exec(
      `INSERT OR REPLACE INTO rights_records
         (asset_id, license, territories, channels, embargo_until, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      rights.assetId, rights.license, JSON.stringify(rights.territories),
      JSON.stringify(rights.channels), rights.embargoUntil, rights.expiresAt, rights.status,
    );
    return this;
  }

  override delete(assetId: string): boolean {
    const existed = super.delete(assetId);
    this.sql.exec('DELETE FROM rights_records WHERE asset_id = ?', assetId);
    return existed;
  }

  override clear(): void {
    super.clear();
    this.sql.exec('DELETE FROM rights_records');
  }
}

/** Append-only log backed by a SQLite table. Only `push` is overridden —
 *  that is the single mutation the gateway performs on these arrays. */
abstract class DoAppendLog<T> extends Array<T> {
  protected constructor(protected readonly sqlStorage: SqlStorageLike) {
    super();
    this.sqlStorage.exec(DDL);
  }

  protected abstract insert(row: T): void;

  override push(...items: T[]): number {
    for (const item of items) this.insert(item);
    return super.push(...items);
  }

  /** Hydrate from the table without re-inserting. */
  protected load(rows: T[]): void {
    super.push(...rows);
  }
}

function rowToUsage(row: Record<string, unknown>): UsageRecord {
  return {
    id: row.id,
    assetId: row.asset_id,
    channel: row.channel,
    territory: (row.territory as string | null) ?? undefined,
    context: (row.context as string | null) ?? undefined,
    recordedAt: row.recorded_at,
    recordedBy: row.recorded_by,
  } as UsageRecord;
}

export class DoUsageLog extends DoAppendLog<UsageRecord> {
  constructor(sql: SqlStorageLike) {
    super(sql);
    this.load(this.sqlStorage.exec('SELECT * FROM usage_records').toArray().map(rowToUsage));
  }

  protected insert(row: UsageRecord): void {
    this.sqlStorage.exec(
      `INSERT OR REPLACE INTO usage_records
         (id, asset_id, channel, territory, context, recorded_at, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.assetId, row.channel, row.territory ?? null,
      row.context ?? null, row.recordedAt, row.recordedBy,
    );
  }
}

function rowToSkillUsage(row: Record<string, unknown>): SkillUsageRecord {
  return {
    id: row.id,
    skillId: row.skill_id,
    version: row.version,
    targetSystemId: row.target_system_id,
    context: row.context,
    appliedBy: row.applied_by,
    appliedAt: row.applied_at,
  } as SkillUsageRecord;
}

export class DoSkillUsageLog extends DoAppendLog<SkillUsageRecord> {
  constructor(sql: SqlStorageLike) {
    super(sql);
    this.load(
      this.sqlStorage.exec('SELECT * FROM skill_usage_records').toArray().map(rowToSkillUsage),
    );
  }

  protected insert(row: SkillUsageRecord): void {
    this.sqlStorage.exec(
      `INSERT OR REPLACE INTO skill_usage_records
         (id, skill_id, version, target_system_id, context, applied_by, applied_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.skillId, row.version, row.targetSystemId,
      row.context, row.appliedBy, row.appliedAt,
    );
  }
}
