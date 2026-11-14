-- Phase 6 data layer (ADR 0009): deployment targets and deployed instances
-- as governed assets. The gateway registers and audits; actuation stays
-- delegated to existing tooling. Applied idempotently by PgGovernanceStore
-- on startup; reference for DBA-managed provisioning.
CREATE TABLE IF NOT EXISTS deployment_targets (
  id             text PRIMARY KEY,
  name           text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('cloud','edge','onprem')),
  endpoint_uri   text,
  region         text,
  capacity_notes text,
  status         text NOT NULL CHECK (status IN ('active','retired')),
  registered_by  text NOT NULL,
  created_at     timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS deployed_instances (
  id             text PRIMARY KEY,
  system_id      text NOT NULL,
  target_id      text NOT NULL,
  version        text NOT NULL,
  status         text NOT NULL CHECK (status IN ('deployed','degraded','offline','revoked')),
  last_health_at timestamptz,
  health_metrics jsonb NOT NULL DEFAULT '{}',
  deployed_by    text NOT NULL,
  created_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  revoked_by     text,
  revoke_reason  text
);
