# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
