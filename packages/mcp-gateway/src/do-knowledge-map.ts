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

/**
 * FTS5 trigram index over title+content. Trigram gives substring semantics,
 * which is what this bilingual (zh/en) knowledge base needs: unicode61 treats
 * a whole CJK run as one token, so 报价 would never match 报价单. Trigram
 * requires >= 3 characters; shorter queries fall back to a SQL LIKE scan
 * (search()), which still beats hydrating every row into JS.
 */
const FTS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
USING fts5(id UNINDEXED, text, tokenize='trigram')`;

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
    this.sql.exec(FTS_DDL);
    for (const row of this.sql.exec('SELECT * FROM knowledge_entries').toArray()) {
      const entry = rowToEntry(row);
      super.set(entry.id, entry);
    }
    // Defensive rebuild: rows written before the FTS table existed (or any
    // drift) are invisible to searchFts until re-indexed.
    const rows = this.sql.exec('SELECT COUNT(*) AS c FROM knowledge_entries').toArray();
    const fts = this.sql.exec('SELECT COUNT(*) AS c FROM knowledge_fts').toArray();
    if (Number(rows[0]?.c ?? 0) !== Number(fts[0]?.c ?? 0)) {
      this.sql.exec('DELETE FROM knowledge_fts');
      this.sql.exec(
        "INSERT INTO knowledge_fts (id, text) SELECT id, title || char(10) || content FROM knowledge_entries",
      );
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
    this.sql.exec('DELETE FROM knowledge_fts WHERE id = ?', id);
    this.sql.exec('INSERT INTO knowledge_fts (id, text) VALUES (?, ?)',
      id, `${entry.title}\n${entry.content}`);
    return this;
  }

  override delete(id: string): boolean {
    const existed = super.delete(id);
    this.sql.exec('DELETE FROM knowledge_entries WHERE id = ?', id);
    this.sql.exec('DELETE FROM knowledge_fts WHERE id = ?', id);
    return existed;
  }

  override clear(): void {
    super.clear();
    this.sql.exec('DELETE FROM knowledge_entries');
    this.sql.exec('DELETE FROM knowledge_fts');
  }

  /**
   * Ranked substring search without hydrating rows into JS.
   * - blank query: list-all (the 治理中枢 Widget 依赖 query:" " 拉全量)
   * - >= 3 chars: FTS5 trigram MATCH, bm25 排序
   * - < 3 chars: SQL LIKE（C 层扫描，语义与原 JS 子串一致）
   * layer / status 过滤由调用方在结果上做（匹配集通常很小）。
   */
  searchFts(query: string, limit: number): KnowledgeEntry[] {
    const q = query.trim();
    if (!q) return [...this.values()].slice(0, limit);
    if ([...q].length >= 3) {
      const phrase = '"' + q.replace(/"/g, '""') + '"';
      const rows = this.sql.exec(
        'SELECT id FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY bm25(knowledge_fts) LIMIT ?',
        phrase, limit,
      ).toArray();
      return rows.map(r => this.get(r.id as string)).filter((e): e is KnowledgeEntry => !!e);
    }
    const like = '%' + q.replace(/[%_\\]/g, c => '\\' + c) + '%';
    const rows = this.sql.exec(
      "SELECT id FROM knowledge_entries WHERE title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' LIMIT ?",
      like, like, limit,
    ).toArray();
    return rows.map(r => this.get(r.id as string)).filter((e): e is KnowledgeEntry => !!e);
  }
}
