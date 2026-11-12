/**
 * Standalone entrypoint for the MCP Gateway.
 *
 *   DAM_TOKENS='{"dev-token":{"id":"dev","scopes":["Suggest","Read","Edit"]}}' \
 *   MCP_PORT=8080 \
 *   pnpm --filter @ai-native-dam/mcp-gateway start
 *
 * When DAM_TOKENS is unset, a single development token `dev-token` with all
 * scopes is issued. Never run like this in production.
 *
 * Persistence (first match wins) — covers the Skill Registry, every
 * governance collection (assets, rights, usage, knowledge, skill usage),
 * and approval confirmation tokens:
 *   DAM_DATABASE_URL  postgres://user:pass@host:5432/db  (docker compose postgres)
 *   DAM_PG_DATA_DIR   ./data/pg  (embedded Postgres via PGlite, no server install)
 *   (neither)         in-memory — lost on restart, dev only
 */
import { createGateway } from './server.js';
import { openPgBackend, type PgBackend } from './pg-backend.js';
import { PgApprovalStore } from './pg-approval-store.js';
import { PgGovernanceStore } from './pg-governance-store.js';
import { PgSkillStore } from './pg-skill-store.js';
import type { ApprovalStore } from './approval.js';
import type { GovernanceStore } from './governance-store.js';
import type { SkillStore } from './skill-store.js';
import type { TokenMap } from './auth.js';

function loadTokens(): TokenMap {
  const raw = process.env.DAM_TOKENS;
  if (!raw) {
    console.warn('[gateway] DAM_TOKENS unset — issuing development token "dev-token" with all scopes');
    return { 'dev-token': { id: 'dev', scopes: ['Suggest', 'Read', 'Edit'] } };
  }
  return JSON.parse(raw) as TokenMap;
}

async function createStores(): Promise<{
  skillStore?: SkillStore;
  store?: GovernanceStore;
  approvalStore?: ApprovalStore;
  backend?: PgBackend;
}> {
  const databaseUrl = process.env.DAM_DATABASE_URL;
  const dataDir = process.env.DAM_PG_DATA_DIR;
  if (!databaseUrl && !dataDir) {
    console.warn('[gateway] state in-memory, NOT durable — set DAM_DATABASE_URL or DAM_PG_DATA_DIR');
    return {}; // createGateway falls back to memory stores
  }
  const backend = await openPgBackend({ databaseUrl, dataDir });
  console.log(
    `[gateway] persistence: ${databaseUrl ? 'Postgres via DAM_DATABASE_URL' : `embedded Postgres (PGlite) at ${dataDir}`}`,
  );
  return {
    backend,
    skillStore: await PgSkillStore.over(backend.db),
    store: await PgGovernanceStore.over(backend.db),
    approvalStore: await PgApprovalStore.over(backend.db),
  };
}

const port = Number(process.env.MCP_PORT ?? 8080);
const { skillStore, store, approvalStore, backend } = await createStores();
const { server } = createGateway({ tokens: loadTokens(), skillStore, store, approvalStore });

server.listen(port, () => {
  console.log(`[gateway] MCP endpoint listening on http://localhost:${port}/mcp`);
  console.log(`[gateway] Health check: http://localhost:${port}/health`);
});

async function shutdown() {
  server.close();
  await backend?.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
