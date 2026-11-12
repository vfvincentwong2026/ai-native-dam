-- 0002_governance_state.sql — governance collections persistence baseline.
--
-- Reference DDL for DBA-managed rollouts. The gateway's PgGovernanceStore
-- applies the same statements idempotently on startup (CREATE TABLE IF NOT
-- EXISTS), so a fresh database self-bootstraps.

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
