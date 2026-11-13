# ADR 0008: Distillation tooling is a decision gate, not a training pipeline

- Status: **Accepted** (2026-11-13)
- Deciders: governance plane maintainers

## Context

ADR 0003 decided that distillation never starts without a human decision, but
left the tooling surface unspecified: how a request is raised, who can approve
it, what "approved" means for the execution plane, and how trained artifacts
(LoRA adapters) come back into the registry. Without concrete tools, every
execution-plane implementation would invent its own threshold and bypass logic.

## Decision

Four MCP tools in `packages/mcp-gateway`:

- `request_distillation` (medium, gated): raises a `DistillationRequest` for a
  skill. Below the usage threshold the request lands as `queued`; at or above
  it, the request becomes `awaiting_approval`. One active request
  (`queued`/`awaiting_approval`/`training`) per skill — duplicates are rejected.
- `approve_distillation` (high, gated): human decision on an
  `awaiting_approval` request. `approve` → status `training`, which in gateway
  semantics means **released to the execution plane**; the gateway itself never
  trains anything. `reject` → `rejected`. Requests still `queued` cannot be
  decided.
- `search_distillations` (low, ungated): lists requests, filterable by status
  and source skill, for dashboards and audits.
- `register_lora_adapter` (high, gated): registers **metadata only** (adapter
  URI, training-data URI, base model, metrics). The source skill must have an
  `approved` version — artifacts of unapproved skills are refused.

The usage threshold defaults to 20 (matching `infra/migrations/0001_init.sql`)
and is overridable via `GatewayOptions.distillationThreshold` for tests and
deployments with different compute budgets.

## Consequences

- The gateway owns the state machine `queued → awaiting_approval → training /
  rejected`; the execution plane consumes released requests and later reports
  `completed`/`failed` (fields reserved, no gateway tooling yet).
- LoRA registration is provenance, not distribution: the adapter bytes live in
  artifact storage (MinIO), the gateway stores only the pointer and audit trail.
- All four tools are durable through `PgGovernanceStore`
  (`migrations/0005_distillation.sql`) and the in-memory store alike.

## Status

Accepted. Implemented in `packages/mcp-gateway` (Phase 4), tested in
`server.test.ts` (threshold crossing, duplicate rejection, human
approve/reject, LoRA provenance guard) and `pg-governance-store.test.ts`
(persistence round-trip across restart).
