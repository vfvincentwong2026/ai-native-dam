#!/usr/bin/env node
/**
 * Sync a governance overview snapshot from the DAM gateway into the
 * Cloudflare Pages static bundle.
 *
 *   GET <gateway>/overview  →  functions/data/overview.json
 *
 * Gateway URL:  env DAM_GATEWAY_URL (default http://127.0.0.1:8080)
 * Token:        env DAM_READ_TOKEN, else the first token with the Read
 *               scope in .review/service/gateway-token.json
 *
 * Run before `wrangler pages deploy`, or on a schedule, to refresh the
 * public dashboard. The snapshot is aggregates + short operational
 * lists only (see packages/mcp-gateway/src/overview.ts).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gatewayUrl = (process.env.DAM_GATEWAY_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const outPath = join(root, 'functions', 'data', 'overview.json');

async function resolveToken() {
  if (process.env.DAM_READ_TOKEN) return process.env.DAM_READ_TOKEN;
  const tokenFile = join(root, '.review', 'service', 'gateway-token.json');
  const map = JSON.parse(await readFile(tokenFile, 'utf8'));
  for (const [token, entry] of Object.entries(map)) {
    if (Array.isArray(entry?.scopes) && entry.scopes.includes('Read')) return token;
  }
  throw new Error('no token with Read scope found; set DAM_READ_TOKEN');
}

const token = await resolveToken();
const res = await fetch(`${gatewayUrl}/overview`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!res.ok) {
  throw new Error(`gateway /overview responded ${res.status}: ${await res.text()}`);
}
const overview = await res.json();

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(overview, null, 2) + '\n', 'utf8');

console.log(
  `[sync-overview] snapshot written: skills=${overview.skills?.total ?? 0} ` +
    `specs=${overview.specs?.total ?? 0} distillations=${overview.distillations?.total ?? 0} ` +
    `instances=${overview.deployments?.instances?.total ?? 0} generated_at=${overview.generated_at}`,
);
