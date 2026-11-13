-- Phase 4 (distillation decision gate, ADR 0003/0008): queued → awaiting_approval
-- → training state machine plus the LoRA artifact registry (metadata only).
-- Applied idempotently by PgGovernanceStore on startup; reference for
-- DBA-managed provisioning. Column layout mirrors infra/migrations/0001_init.sql
-- with gateway-local text ids.
CREATE TABLE IF NOT EXISTS distillation_requests (
  id              text PRIMARY KEY,
  source_skill_id text NOT NULL,
  usage_count     integer NOT NULL DEFAULT 0,
  threshold       integer NOT NULL DEFAULT 20,
  status          text NOT NULL CHECK (status IN ('queued','awaiting_approval','training','completed','failed','rejected')),
  reason          text,
  requested_by    text NOT NULL,
  requested_at    timestamptz NOT NULL,
  approved_at     timestamptz,
  approved_by     text
);

CREATE TABLE IF NOT EXISTS lora_artifacts (
  id                text PRIMARY KEY,
  source_skill_id   text NOT NULL,
  version           text NOT NULL,
  adapter_uri       text NOT NULL,
  training_data_uri text NOT NULL,
  base_model        text NOT NULL,
  metrics           jsonb NOT NULL DEFAULT '{}',
  registered_by     text NOT NULL,
  created_at        timestamptz NOT NULL
);
