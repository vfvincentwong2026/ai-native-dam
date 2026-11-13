-- Phase 2 closure: generated systems become governed assets (ADR 0007/0009).
-- A system is registered from an approved System Spec; provenance columns are
-- denormalized from the spec at registration time. Applied idempotently by
-- PgGovernanceStore on startup; reference for DBA-managed provisioning.
CREATE TABLE IF NOT EXISTS generated_systems (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  version              text NOT NULL,
  source_spec_id       text NOT NULL,
  endpoint_uri         text,
  status               text NOT NULL CHECK (status IN ('registered','active','deprecated')),
  source_skill_ids     text[] NOT NULL DEFAULT '{}',
  source_knowledge_ids text[] NOT NULL DEFAULT '{}',
  registered_by        text NOT NULL,
  created_at           timestamptz NOT NULL
);
