-- 0001_init.sql — Core schema for AI-Native DAM governance plane.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Channels & territories ─────────────────────────────────
CREATE TABLE channels (
  id                     TEXT PRIMARY KEY,
  platform               TEXT NOT NULL,
  account_ref            TEXT,
  default_rights_profile JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE territories (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- ─── Media assets ──────────────────────────────────────────
CREATE TABLE assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  s3_key      TEXT NOT NULL,
  tags        TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT NOT NULL
);

CREATE INDEX idx_assets_tags ON assets USING GIN (tags);

-- ─── Rights ────────────────────────────────────────────────
CREATE TYPE rights_status AS ENUM ('Cleared', 'Restricted', 'Expired', 'Pending');

CREATE TABLE rights_records (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id       UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  license        TEXT NOT NULL,
  channels       TEXT[] NOT NULL,
  territories    TEXT[] NOT NULL,
  embargo_until  TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  status         rights_status NOT NULL DEFAULT 'Pending',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rights_asset ON rights_records(asset_id);

-- ─── Usage audit ───────────────────────────────────────────
CREATE TABLE usage_records (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     UUID NOT NULL REFERENCES assets(id),
  channel      TEXT NOT NULL,
  territory    TEXT,
  context      TEXT,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by  TEXT NOT NULL
);

-- ─── Skills ────────────────────────────────────────────────
CREATE TYPE skill_status AS ENUM ('draft', 'pending_approval', 'approved', 'revoked');
CREATE TYPE skill_domain AS ENUM ('ecommerce', 'short_drama', 'retail', 'content', 'generic');

CREATE TABLE skills (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version           TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  domain            skill_domain NOT NULL,
  source_sop_id     UUID,
  status            skill_status NOT NULL DEFAULT 'draft',
  lora_artifact_ref UUID,
  approved_by       TEXT,
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, version)
);

-- ─── System specs ──────────────────────────────────────────
CREATE TYPE system_spec_status AS ENUM ('draft', 'pending_approval', 'approved', 'rejected', 'generated');

CREATE TABLE system_specs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                TEXT NOT NULL,
  business_domain      TEXT NOT NULL,
  spec_json            JSONB NOT NULL,
  source_skill_ids     UUID[] DEFAULT ARRAY[]::UUID[],
  source_knowledge_ids UUID[] DEFAULT ARRAY[]::UUID[],
  status               system_spec_status NOT NULL DEFAULT 'draft',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at          TIMESTAMPTZ,
  approved_by          TEXT
);

-- ─── Knowledge ─────────────────────────────────────────────
CREATE TYPE knowledge_layer AS ENUM ('raw', 'topic', 'manual', 'rule', 'qa');
CREATE TYPE knowledge_status AS ENUM ('draft', 'pending_approval', 'approved', 'revoked');

CREATE TABLE knowledge_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  layer            knowledge_layer NOT NULL,
  content          TEXT NOT NULL,
  source_asset_ids UUID[] DEFAULT ARRAY[]::UUID[],
  status           knowledge_status NOT NULL DEFAULT 'draft',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at      TIMESTAMPTZ
);

CREATE INDEX idx_knowledge_layer_status ON knowledge_entries(layer, status);

-- ─── Distillation ──────────────────────────────────────────
CREATE TYPE distillation_status AS ENUM ('queued', 'awaiting_approval', 'training', 'completed', 'failed', 'rejected');

CREATE TABLE distillation_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_skill_id  UUID NOT NULL,
  usage_count      INTEGER NOT NULL DEFAULT 0,
  threshold        INTEGER NOT NULL DEFAULT 20,
  status           distillation_status NOT NULL DEFAULT 'queued',
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at      TIMESTAMPTZ,
  reason           TEXT
);

CREATE TABLE lora_artifacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_skill_id   UUID NOT NULL,
  version           TEXT NOT NULL,
  adapter_uri       TEXT NOT NULL,
  training_data_uri TEXT NOT NULL,
  base_model        TEXT NOT NULL,
  metrics           JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Approval audit ────────────────────────────────────────
CREATE TYPE approval_decision AS ENUM ('approved', 'declined', 'pending', 'expired');
CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high');

CREATE TABLE approval_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name     TEXT NOT NULL,
  risk_level    risk_level NOT NULL,
  arguments     JSONB NOT NULL,
  resource_key  TEXT NOT NULL,
  decision      approval_decision NOT NULL DEFAULT 'pending',
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ,
  decided_by    TEXT,
  reason        TEXT
);

CREATE INDEX idx_approval_pending ON approval_requests(decision, requested_at)
  WHERE decision = 'pending';
