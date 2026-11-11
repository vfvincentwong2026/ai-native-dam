# ADR 0003: Distillation never starts without a human decision

- Status: **Accepted** (2026-11-12)
- Deciders: governance plane maintainers

## Context

The distillation pipeline turns repeated skill usage into trained artifacts
(LoRA adapters, digital twins). Training consumes real compute budget and
bakes observed behavior into a model — a bad or poisoned usage pattern, once
distilled, is far harder to revoke than a skill version. An automated
"usage count crossed threshold → start training" loop would let agents
self-amplify without oversight.

## Decision

`request_distillation` only **queues and pauses** (`pause-before-train`).
Crossing the usage threshold sets status `awaiting_approval`; training starts
only after a human approves through `mcp-approval`. High-risk registration
(`register_lora_adapter`) is **never auto-approved**, even for admins.

## Consequences

- Compute cost and model-behavior changes are always human-authorized.
- Every distillation decision leaves an `approval_requests` audit record.
- Latency: distillation is never real-time; acceptable for a governance plane.
- The execution plane (Builder Runtime) must call this gate via MCP and must
  not implement its own threshold-bypass logic.

## Status

Accepted. Enforced by the approval gate in `packages/mcp-gateway` and the
`distillation_requests` state machine (`queued → awaiting_approval → training`).
