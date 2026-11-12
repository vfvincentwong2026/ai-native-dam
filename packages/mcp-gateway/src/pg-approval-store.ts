import type { PgQueryable } from './pg-backend.js';
import type { ApprovalEntry, ApprovalStore } from './approval.js';

/**
 * Reference DDL — mirrored in migrations/0003_approval_tokens.sql and applied
 * idempotently on store startup. Single statement, so PGlite's query() is fine.
 */
export const APPROVAL_DDL = `
CREATE TABLE IF NOT EXISTS approval_tokens (
  key        text PRIMARY KEY,
  token      text NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  consumed   boolean NOT NULL DEFAULT FALSE
)`;

/**
 * Postgres-backed ApprovalStore: confirmation tokens survive a gateway
 * restart, so an approval chain started before a deploy can complete after
 * it. Expiry is still enforced by the gate via expires_at, and tokens stay
 * single-use. Build over a shared backend (`over`); the caller owns close().
 */
export class PgApprovalStore implements ApprovalStore {
  private constructor(private readonly db: PgQueryable) {}

  static async over(db: PgQueryable): Promise<PgApprovalStore> {
    await db.query(APPROVAL_DDL);
    return new PgApprovalStore(db);
  }

  async get(key: string): Promise<ApprovalEntry | undefined> {
    const { rows } = await this.db.query(
      'SELECT key, token, created_at, expires_at, consumed FROM approval_tokens WHERE key = $1',
      [key],
    );
    const r = rows[0] as
      | { key: string; token: string; created_at: number | string; expires_at: number | string; consumed: boolean }
      | undefined;
    if (!r) return undefined;
    return {
      key: r.key,
      token: r.token,
      // pg returns bigint as string; PGlite may return number — normalize.
      createdAt: Number(r.created_at),
      expiresAt: Number(r.expires_at),
      consumed: r.consumed,
    };
  }

  async put(entry: ApprovalEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO approval_tokens (key, token, created_at, expires_at, consumed)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (key) DO UPDATE SET
         token = EXCLUDED.token, created_at = EXCLUDED.created_at,
         expires_at = EXCLUDED.expires_at, consumed = EXCLUDED.consumed`,
      [entry.key, entry.token, entry.createdAt, entry.expiresAt, entry.consumed],
    );
  }
}
