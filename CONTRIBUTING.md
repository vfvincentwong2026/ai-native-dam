# Contributing to AI-Native DAM

Thanks for your interest. This project is in **Phase 0** — the governance plane
is being bootstrapped. Contributions are welcome at every layer.

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

## Code of Conduct

By participating, you agree to follow our [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).
