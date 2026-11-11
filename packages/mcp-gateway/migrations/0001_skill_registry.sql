-- 0001_skill_registry.sql — Skill Registry persistence baseline.
--
-- This file is the reference DDL for deployments that manage migrations
-- externally. The gateway's PgSkillStore applies the same statement
-- idempotently on startup (CREATE TABLE IF NOT EXISTS), so a fresh database
-- self-bootstraps; this file exists for audit and for DBA-managed rollouts.

CREATE TABLE IF NOT EXISTS skill_registry (
  id                text        NOT NULL,
  version           text        NOT NULL,
  name              text        NOT NULL,
  description       text        NOT NULL,
  domain            text        NOT NULL CHECK (domain IN ('ecommerce','short_drama','retail','content','operations','generic')),
  source_sop_id     text,
  status            text        NOT NULL CHECK (status IN ('draft','pending_approval','approved','revoked')),
  approved_at       timestamptz,
  approved_by       text,
  lora_artifact_ref text,
  created_at        timestamptz NOT NULL,
  source_repo       text,
  source_path       text,
  source_commit     text,
  PRIMARY KEY (id, version)
);
