# ADR 0009: Installable Unit contract — deployed systems are governed MCP peers

- Status: **Accepted** (2026-11-13, documentation layer; implementation follows Phase 2 closure)
- Deciders: governance plane maintainers

## Context

The hosting chain `Spec → Blueprint → System` currently ends at System.
"Deploying an AI-native project into cloud / edge / on-prem hardware" has no
entity in the governance store — no target registry, no instance record, no
install approval, no rollback point. Without that, hosting is an ops
notebook, not an industrial capability. At the same time, the plane must not
degenerate into yet another orchestrator: its value is governance semantics
(Rights · Provenance · Approval · Audit), not container plumbing.

## Decision

**1. Two new governed asset classes** (README "What It Governs", now seven):
`Deployment Targets` (cloud accounts, edge boxes, on-prem machines — who may
install what, where, how many) and `Deployed Instances` (running unit:
version, health, audit trail, rollback point).

**2. InstallableUnit contract, tiered.** Any project installed into the DAM
satisfies the tier matching its form factor — not a monolithic checklist:

- **L1 · Registerable** (static sites, serverless, batch tools):
  declarative packaging (image *or* repo + commit tag), `dam.manifest.yaml`
  declaring resources/dependencies/MCP endpoints/health check/data boundary,
  no hardcoded secrets, standard `/health` endpoint.
- **L2 · Hostable** (long-running services):
  L1 + MCP server exposure (the unit is probeable and accepts lifecycle
  commands), model calls routed through the Model Router, declared offline
  degradation behavior, rollback story.
- **L3 · Edge-grade** (hardware units):
  L2 + hardware profile declaration (CPU/RAM/accelerator matrix), local
  health/metrics agent, offline-first operation with sync-on-reconnect.

**3. Peer, not client.** An installed unit talks MCP in **both** directions:
unit → DAM (`check_usage_rights`, `record_usage`, `register_skill`);
DAM → unit (probe health, pull metrics, push version, revoke, rollback).
A black-box container is not installable at L2+.

**4. Skill entry and trigger clauses.**
- *Entry:* `dam.manifest.yaml` lists every Skill the unit carries
  (name, version, purpose, risk level); installing the instance batch-registers
  them into the Skill Registry — the vincent-core sync path becomes the
  standard入境 procedure, not a one-off.
- *Trigger:* a unit invokes its Skills **only** through the gateway's
  `apply_skill`. Every invocation hits rights checks, usage recording, and
  the distillation threshold gate (ADR 0003/0008). Direct out-of-band skill
  execution voids the unit's install approval. Skill source repos stay
  distributed (each project keeps its own SKILL library); the Registry is the
  single point of adjudication — distributed holding, centralized ruling.

**5. Governance, not orchestration.** The DAM models deployment decisions
(target/instance registration, install approval, health records, revoke).
Actuation — starting containers, canary rollouts, edge daemons — is delegated
to existing tooling (compose, cloud APIs, execution plane). No self-built
Provisioner/OTA controller/edge agent until Phase 3 (A2A) lands.

## Consequences

- "Hosting" gains governed entities; every install/upgrade/revoke leaves an
  approval + audit record.
- Customers and sibling systems can code against the contract today, before
  any provisioner exists — the documentation layer is the integration surface.
- Sequencing constraint: instance registration attaches to System entities,
  so tooling lands only after `register_generated_system` closes Phase 2.
- Deferred deliberately: provisioner implementation, OTA mechanics,
  certificate infrastructure.

## Status

Accepted as the documentation layer (README architecture + this ADR).
Data-layer tooling (target/instance registry tools) scheduled after
`register_generated_system`; actuation after Phase 3.
