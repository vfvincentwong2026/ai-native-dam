/**
 * Durable Object SQLite-backed knowledge store — the Workers deployment backend.
 *
 * Implements the `Map<string, KnowledgeEntry>` shape that GatewayState expects,
 * so tools.ts / rpc.ts need no changes: the DO's embedded SQLite
 * (`ctx.storage.sql`) is synchronous, letting us hydrate in the constructor and
 * write through on every mutation. Previously `state.knowledge` was a plain
 * in-memory Map and all entries were lost whenever the DO was evicted.
 *
 * Race-safety: a Durable Object processes requests single-threaded, so the
 * in-memory mirror and the SQLite rows cannot diverge.
 */
import type { KnowledgeEntry } from '@ai-native-dam/shared-schema';

/** Minimal structural type for ctx.storage.sql — keeps this file free of workerd types. */
interface SqlCursorLike {
  toArray(): Record<string, unknown>[];
}
interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

const DDL = `
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  layer            TEXT NOT NULL CHECK (layer IN ('raw','topic','manual','rule','qa')),
  content          TEXT NOT NULL,
  source_asset_ids TEXT NOT NULL DEFAULT '[]',
  status           TEXT NOT NULL CHECK (status IN ('draft','pending_approval','approved','revoked')),
  created_at       TEXT NOT NULL,
  approved_at      TEXT
)`;

function rowToEntry(row: Record<string, unknown>): KnowledgeEntry {
  return {
    id: row.id,
    title: row.title,
    layer: row.layer,
    content: row.content,
    sourceAssetIds: JSON.parse((row.source_asset_ids as string) ?? '[]'),
    status: row.status,
    createdAt: row.created_at,
    approvedAt: (row.approved_at as string | null) ?? null,
  } as KnowledgeEntry;
}

export class DoKnowledgeMap extends Map<string, KnowledgeEntry> {
  constructor(private readonly sql: SqlStorageLike) {
    super();
    this.sql.exec(DDL);
    for (const row of this.sql.exec('SELECT * FROM knowledge_entries').toArray()) {
      const entry = rowToEntry(row);
      super.set(entry.id, entry);
    }
  }

  override set(id: string, entry: KnowledgeEntry): this {
    super.set(id, entry);
    this.sql.exec(
      `INSERT OR REPLACE INTO knowledge_entries
         (id, title, layer, content, source_asset_ids, status, created_at, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id, entry.title, entry.layer, entry.content,
      JSON.stringify(entry.sourceAssetIds ?? []),
      entry.status, entry.createdAt, entry.approvedAt,
    );
    return this;
  }

  override delete(id: string): boolean {
    const existed = super.delete(id);
    this.sql.exec('DELETE FROM knowledge_entries WHERE id = ?', id);
    return existed;
  }

  override clear(): void {
    super.clear();
    this.sql.exec('DELETE FROM knowledge_entries');
  }
}
