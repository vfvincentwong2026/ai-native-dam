# Roadmap

| Phase | Focus | Status |
|---|---|---|
| 0 · Foundation | Governance plane skeleton, MCP contract, Cloudflare showcase | **nearly done** (CI green; Artbucket pending) |
| 1 · Skills & Knowledge | Skill Registry, layered knowledge, write-gated | **in progress** (MCP Gateway live with 8 tools, in-memory state) |
| 2 · Spec-first Generation | Builder Runtime, `generate_system_spec`, approval gate | planned |
| 3 · A2A Collaboration | Agent Card, task delegation, customer agents | planned |
| 4 · Distillation | `request_distillation`, pause-before-train, LoRA registry | planned |
| 5 · Meta-generation | Spec templates for "generate a DAM" | planned |

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
