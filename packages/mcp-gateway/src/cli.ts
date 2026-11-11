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
 * Skill Registry persistence (first match wins):
 *   DAM_DATABASE_URL  postgres://user:pass@host:5432/db  (docker compose postgres)
 *   DAM_PG_DATA_DIR   ./data/pg  (embedded Postgres via PGlite, no server install)
 *   (neither)         in-memory — lost on restart, dev only
 */
import { createGateway } from './server.js';
import { PgSkillStore } from './pg-skill-store.js';
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

async function createSkillStore(): Promise<SkillStore | undefined> {
  const databaseUrl = process.env.DAM_DATABASE_URL;
  if (databaseUrl) {
    console.log('[gateway] Skill Registry: Postgres via DAM_DATABASE_URL');
    return PgSkillStore.connect(databaseUrl);
  }
  const dataDir = process.env.DAM_PG_DATA_DIR;
  if (dataDir) {
    console.log(`[gateway] Skill Registry: embedded Postgres (PGlite) at ${dataDir}`);
    return PgSkillStore.embedded(dataDir);
  }
  console.warn('[gateway] Skill Registry: in-memory, NOT durable — set DAM_DATABASE_URL or DAM_PG_DATA_DIR');
  return undefined; // createGateway falls back to MemorySkillStore
}

const port = Number(process.env.MCP_PORT ?? 8080);
const skillStore = await createSkillStore();
const { server } = createGateway({ tokens: loadTokens(), skillStore });

server.listen(port, () => {
  console.log(`[gateway] MCP endpoint listening on http://localhost:${port}/mcp`);
  console.log(`[gateway] Health check: http://localhost:${port}/health`);
});

async function shutdown() {
  server.close();
  await skillStore?.close?.();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
