# Roadmap

| Phase | Focus | Status |
|---|---|---|
| 0 · Foundation | Governance plane skeleton, MCP contract, Cloudflare showcase | **nearly done** (CI green; Artbucket pending) |
| 1 · Skills & Knowledge | Skill Registry, layered knowledge, write-gated | **done** (register/approve/revoke/apply + knowledge lifecycle, all durable via Postgres/PGlite, ADR 0004–0006) |
| 2 · Spec-first Generation | Builder Runtime, `generate_system_spec`, approval gate | **in progress** (spec draft/submit + `register_generated_system`/`search_systems` live in gateway, ADR 0007; Builder Runtime pending) |
| 3 · A2A Collaboration | Agent Card, task delegation, customer agents | planned |
| 4 · Distillation | `request_distillation`, pause-before-train, LoRA registry | **in progress** (gateway decision gate live: request/approve/search + LoRA metadata registry, ADR 0003/0008; execution-plane training pending) |
| 5 · Meta-generation | Spec templates for "generate a DAM" | planned |
| 6 · Deployment Plane | Target/Instance registries, InstallableUnit contract, peer MCP | **docs accepted** (ADR 0009; data-layer tooling after Phase 2 closes, actuation after Phase 3) |

## Phase 0 — completion criteria

- [x] README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, `.env.example`
- [x] `docs/architecture.md`, `docs/mcp-tools.md`, `docs/a2a-contract.md`
- [x] `docker-compose.yml` (Postgres + MinIO)
- [x] `packages/shared-schema` with Zod types for all tool contracts
- [x] `infra/migrations/0001_init.sql` covers assets, rights, skills, specs, knowledge, distillation, approval
- [x] `index.html` + Cloudflare Pages deployment
- [x] `functions/mcp.js` read-only showcase MCP endpoint
- [x] CI green on `main`
- [ ] Artbucket + MCP Gateway running locally
