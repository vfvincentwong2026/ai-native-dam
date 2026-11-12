-- ADR 0006: durable two-call confirmation tokens.
-- Applied idempotently by PgApprovalStore on startup; this file is the
-- reference for DBA-managed provisioning.
CREATE TABLE IF NOT EXISTS approval_tokens (
  key        text PRIMARY KEY,        -- principal:tool:sha256(args)
  token      text NOT NULL,           -- random UUID quoted back in _confirmation
  created_at bigint NOT NULL,         -- epoch millis
  expires_at bigint NOT NULL,         -- epoch millis; gate rejects past this
  consumed   boolean NOT NULL DEFAULT FALSE
);
