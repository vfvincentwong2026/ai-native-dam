-- ADR 0010: close the System → Run → Blueprint → Spec traceability chain.
-- blueprint_hash is the content hash of the Blueprint the system was compiled
-- from; verify_report_ref points at the run-local verify-before-register
-- report. Both nullable: pre-runtime registrations simply have no runtime
-- provenance. Applied idempotently by PgGovernanceStore on startup; reference
-- for DBA-managed provisioning.
ALTER TABLE generated_systems ADD COLUMN IF NOT EXISTS blueprint_hash text;
ALTER TABLE generated_systems ADD COLUMN IF NOT EXISTS verify_report_ref text;
