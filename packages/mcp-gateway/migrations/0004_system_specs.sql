-- Phase 2 (spec-first generation): system spec drafts and approved specs.
-- Applied idempotently by PgGovernanceStore on startup; this file is the
-- reference for DBA-managed provisioning. Column layout mirrors
-- infra/migrations/0001_init.sql with gateway-local types (text ids, jsonb entities).
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
);
