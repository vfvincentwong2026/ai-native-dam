# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Skill usage recording in the compile path (ADR 0010 §5): `compile()` now
  leaves one `apply_skill` usage record per provenance skill of the spec
  BEFORE generating — latest approved version resolved via `search_skills`,
  gated two-call flow auto-confirmed (the human decision happened at spec
  approval), records inspectable via `getSkillUsages`. A provenance skill
  with no approved version breaks the chain and fails the run before any
  LLM call. These records feed the distillation threshold (ADR 0003/0008).

- Blueprint executor closes the compile loop (ADR 0010 §7):
  `runtime/compilation` gains `executeBlueprint` — runs the prompt plan in
  order through an injected `BlueprintCompleter` seam (structurally
  satisfied by the model-router; compilation itself never touches the
  network). `dam.manifest.yaml` is never LLM-generated (deterministic
  `generateManifest` by construction); the C3 `(review)` item returns
  consistency notes instead of a file. The orchestrator welds it in:
  `compile(runId, completer)` stores the build run-locally and enters
  `verifying` (completer failures, including budget breakers, fail the run
  with zero governance-plane writes), and `requestRegistration` verifies
  the stored build when no explicit `request.build` is passed. 6
  compilation + 13 orchestrator vitest cases, including the end-to-end
  plan → compile → verify → gated-register loop.

- `runtime/model-router` OpenSquilla adapter (ADR 0010 §1/§6): the sole LLM
  egress of the Builder Runtime. Tier routing maps OpenSquilla C0–C3 to
  concrete models behind an injectable `ModelTransport` seam
  (`SquillaHttpTransport` over HTTP); every call lands a run-local record
  (tier / model / prompt summary / tokens / outcome — the full prompt is
  never stored) feeding per-run cost rollups; run budgets (`maxCalls` /
  `maxTotalTokens`) trip a `BudgetExceededError` breaker BEFORE the
  transport is touched. 10 vitest cases, fully offline.

- InstallableUnit L1 manifest generator + verify-before-register gate
  (ADR 0009 §2, ADR 0010 §4): `runtime/compilation` gains
  `generateManifest` (deterministic `dam.manifest.yaml` — declarative
  packaging, standard `/health`, data boundary, carried skills, empty
  secrets by construction) and `verifyBuild` (9 structural checks over the
  build against its Blueprint, deterministic report). The orchestrator
  welds the gate into `requestRegistration`: a failing build fails the run
  with `VerificationFailedError` and never reaches the gateway; a passing
  report is stored run-locally (`verify://<runId>`, `getVerifyReport`).
  11 compilation + 11 orchestrator vitest cases.

- Orchestrator ↔ compilation wiring (ADR 0010): `startRun` now fetches the
  spec from the governance plane, enforces approved-only entry, and plans the
  deterministic Blueprint immediately (`BuildRun.blueprintRef` +
  `getBlueprint`); `completeCompilation` records the generated-code pointer
  (`buildRef`). Wire-format (snake_case) specs are mapped back to the domain
  type at the client boundary.

- `runtime/compilation` deterministic Spec → Blueprint planner (ADR 0010 §1):
  pure function of the spec (no LLM / clock / randomness) producing stack
  choice (domain-keyword overrides), module breakdown (core/entity/workflow),
  file manifest with InstallableUnit L1 core files, and a C0–C3 prompt plan.
  Blueprint identity is a sha256 over canonical content; slug collisions
  (e.g. CJK workflow names) are disambiguated deterministically.

- `runtime/orchestrator` Builder Runtime skeleton (ADR 0010): whitelisted MCP
  client (`HttpMcpClient`, ADR 0010 §5 tool surface, two-call gated flow with
  explicit `beginGated`/`confirmGated` seam), run state machine
  (`queued → compiling → verifying → awaiting_registration → registered |
  failed`, transition validation before any gateway call), and the
  `Orchestrator` driving approved-spec discovery through to gated
  registration. 9 vitest cases over a fake gateway.

- `register_generated_system` + `search_systems` close the Phase 2 loop: an
  approved System Spec can be registered as a governed generated-system asset
  (provenance denormalized from the spec, spec transitions `approved` →
  `generated`), with the `generated_systems` collection durable in both
  governance store backends (`migrations/0006_generated_systems.sql`).

### Changed

- `check_use` renamed to `check_usage_rights` across schema, gateway, showcase,
  and docs. The old wire name keeps working as a deprecated alias (gateway maps
  it and marks results with `deprecated_alias` / `use_instead`).
- Every gated tool description now states what the tool does **not** do, and
  tool-specific approval/rejection semantics live in the tool descriptions.
- Controlled fields (`channel`, `territory`, `layer`, `domain`, `risk_level`)
  are documented as enums everywhere, including `docs/mcp-tools.md` and the
  showcase endpoint.
- README: canonical-source pointer above the MCP tool tables, ADR pointer after
  the architecture boundary rule, Roadmap phases 3/4/5 explicitly `planned`.

### Added

- `docs/adr/0001-retrieval-filter-before-similarity.md` and
  `docs/adr/0003-distillation-decision-gate.md`.

### Fixed

- `packages/shared-schema/tsconfig.json` contained `package.json` content, breaking
  `tsc` for the whole workspace; replaced with a proper project config.
- Root `typecheck` now builds project references first, so CI typecheck passes on
  a clean checkout.
- `functions/mcp.js` `check_use` now follows the canonical contract in
  `docs/mcp-tools.md` (`asset_id` in, `replacement_id` out).
- `searchAssets` now reports `total` as the pre-pagination match count and passes
  the real `assetId` into `checkUse`.
- Added `pnpm-lock.yaml` so `pnpm install --frozen-lockfile` works in CI.

### Added

- `packages/skill-sync`: skill-repository syncer — scans SKILL.md files,
  validates frontmatter against the industrial spec, derives git provenance
  (repo / path / commit), and registers skills through the gateway's approval
  gate. Ships a `skill-sync` CLI (`--dry-run` / `--gateway` / `--token`).
- `templates/vincent-core`: ready-to-push skeleton for the certified core
  skill hub (layout, example skill, zero-dependency validator, CI workflow
  with DAM sync job).
- `docs/skill-format.md`: industrial skill manifest + intake/trigger spec.
- `register_skill` MCP tool (gated) with commit-pinned provenance; `Skill`
  schema gains `sourceRepo` / `sourcePath` / `sourceCommit`.

- `packages/mcp-gateway`: MCP Gateway over Streamable HTTP — bearer auth,
  scope-based RBAC (`Suggest` / `Read` / `Edit`), two-call confirmation-token
  approval gate, snake_case wire contract translation, `/health`, and 8 live
  tools (`search_assets`, `check_use`, `create_asset`, `set_rights`,
  `record_usage`, `search_knowledge`, `write_knowledge`, `search_skills`).
- `shared-schema`: `CreateAssetInput`, `SetRightsInput`, `RecordUsageInput`,
  `UsageRecord`, `WriteKnowledgeOutput`, `RequestDistillationOutput`,
  `LoraArtifact`, `RegisterLoraAdapterOutput`; registry now includes
  `create_asset` / `set_rights` / `record_usage`.
- Contract-integrity tests for the tool registry, `searchAssets` tests, and 24
  gateway tests (approval unit + HTTP integration).

- `README.md` governance-plane positioning (media, skills, systems, knowledge, distilled artifacts).
- `docs/architecture.md`, `docs/mcp-tools.md`, `docs/a2a-contract.md`.
- `packages/shared-schema` with Zod types for all MCP tool contracts.
- `infra/migrations/0001_init.sql` covering assets, rights, skills, specs, knowledge, distillation, approval.
- `infra/seed/0001_channels.sql` with initial channels and territories.
- `packages/governance` with `checkUse` and `searchAssets` pure functions and tests.
- `packages/connectors` with the `SocialDataSource` Protocol.
- `policies/` with risk levels, approval gates, and permission scopes.
- `functions/mcp.js` read-only showcase MCP endpoint for Cloudflare Pages.
- CI workflow: typecheck, test, README hygiene.

### Changed

- Repository positioning upgraded from media DAM to AI-native governance plane.

## [0.1.0] - 2026-11-10

### Added

- Initial repository skeleton and README.
