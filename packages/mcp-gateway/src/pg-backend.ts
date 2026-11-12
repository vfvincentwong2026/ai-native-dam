/**
 * Shared Postgres connection for the gateway's persistent stores.
 *
 * Exactly one backend per gateway process: a `pg` Pool when DAM_DATABASE_URL
 * is set (deployment), or an embedded PGlite instance under DAM_PG_DATA_DIR
 * (local / classroom, no server install). Stores built `over()` this backend
 * do not own its lifecycle; the CLI owns `close()`.
 */

/**
 * Minimal query interface shared by node-postgres (`pg` Pool/Client) and
 * PGlite, so the same store SQL serves both.
 */
export interface PgQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface PgBackend {
  db: PgQueryable;
  close(): Promise<void>;
}

export async function openPgBackend(options: {
  databaseUrl?: string;
  dataDir?: string;
}): Promise<PgBackend> {
  if (options.databaseUrl) {
    // pg is CJS; named exports are not statically linkable from ESM, so go
    // through the default export with a fallback for interop builds.
    const mod = (await import('pg')) as unknown as {
      Pool?: new (config: { connectionString: string }) => PgQueryable & { end(): Promise<void> };
      default?: { Pool: new (config: { connectionString: string }) => PgQueryable & { end(): Promise<void> } };
    };
    const PoolCtor = mod.default?.Pool ?? mod.Pool;
    if (!PoolCtor) throw new Error('pg Pool export not found');
    const pool = new PoolCtor({ connectionString: options.databaseUrl });
    return { db: pool, close: () => pool.end() };
  }
  if (options.dataDir) {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(options.dataDir);
    return { db: db as unknown as PgQueryable, close: () => db.close() };
  }
  throw new Error('openPgBackend: provide databaseUrl or dataDir');
}
