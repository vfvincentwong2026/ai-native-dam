# Contributing to AI-Native DAM

Thanks for your interest. The governance plane (Phases 1–2) and the deployment
registries (Phase 6 data layer) are live; see [`docs/roadmap.md`](./docs/roadmap.md)
for current phase status. Contributions are welcome at every layer.

## Ways to contribute

- **Connectors** — add a new platform behind the `SocialDataSource` interface.
- **MCP tool contracts** — propose a new tool in `docs/mcp-tools.md` with
  `risk_level`, `gated` status, input/output JSON Schema, and one example call.
- **Governance policies** — add an example in `policies/`.
- **Documentation** — improve `docs/architecture.md`, `docs/a2a-contract.md`.

## Before you open a PR

1. Open an issue describing what you want to change and why.
2. Keep PRs scoped to one concern. Do not mix refactors with features.
3. If you change an MCP tool contract, update `docs/mcp-tools.md` in the same PR.
4. If you add a write tool, it **must** be gated through `mcp-approval`.

## Commit style

Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.
Example: `feat(mcp): add search_skills tool contract`.

## Multi-agent working rule (双会话协作约定)

This repo is actively developed by **parallel AI-agent sessions** (governance
plane and Builder Runtime). To keep the shared working tree safe:

1. **Package boundary.** The runtime session owns `runtime/`; the governance
   session owns `packages/`. Cross-boundary changes (e.g. a contract in
   `shared-schema` that the runtime needs) are announced before editing.
2. **Never commit the other session's uncommitted work-in-progress.** Before
   `git add -A`, check `git status` for files outside your scope; if found,
   pause and coordinate instead of sweeping them into your commit.
3. **Green before push.** `pnpm build && pnpm test` must pass on the whole
   workspace before every push — your push gates both sessions' work.
4. **Coordinate on `shared-schema`.** Contract changes affect both planes;
   land them in small, separate commits so the other side can rebase quickly.
5. **Comments in SQL DDL strings must not contain semicolons** — the
   PGlite init splitter cuts statements on `;` (learned the hard way).

## Code of Conduct

By participating, you agree to follow our [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
