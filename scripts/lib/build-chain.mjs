/**
 * Shared plumbing for scripts/build-smoke.mjs and scripts/build-real.mjs:
 * connect to the governance plane, run the gated spec flow, print the
 * four-level traceability chain.
 *
 * Connection policy — never double-open PGlite:
 *   1. If a resident gateway answers at DAM_GATEWAY_URL (default
 *      http://127.0.0.1:8080), talk HTTP to it with the service tokens from
 *      .review/service/gateway-token.json (machine-local, git-ignored).
 *   2. Otherwise boot an in-process gateway over DAM_PG_DATA_DIR (default
 *      .review/pgdata) with self-issued tokens.
 */

import { access, readFile } from 'node:fs/promises';
import {
  createGateway,
  openPgBackend,
  PgApprovalStore,
  PgGovernanceStore,
  PgSkillStore,
} from '../../packages/mcp-gateway/dist/index.js';

const LIVE_URL = (process.env.DAM_GATEWAY_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const DATA_DIR = process.env.DAM_PG_DATA_DIR ?? '.review/pgdata';
const TOKEN_FILE = '.review/service/gateway-token.json';

export async function ensureDist(log, extra = []) {
  for (const dist of ['packages/mcp-gateway/dist/index.js', 'runtime/orchestrator/dist/index.js', ...extra]) {
    try {
      await access(dist);
    } catch {
      console.error(`${dist} missing — run \`pnpm build\` first.`);
      process.exit(1);
    }
  }
}

/**
 * Connect to the governance plane. Returns `{ base, editorToken,
 * builderToken, mode, close }`; `close` is a no-op in live mode.
 */
export async function connectGateway(log) {
  // 1. live gateway?
  try {
    const res = await fetch(`${LIVE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const tokens = JSON.parse(await readFile(TOKEN_FILE, 'utf8'));
      const byId = (id) => Object.keys(tokens).find((t) => tokens[t].id === id);
      const editorToken = byId('dam-service');
      const builderToken = byId('builder-runtime');
      if (!editorToken || !builderToken) {
        throw new Error(`${TOKEN_FILE} must contain dam-service and builder-runtime principals`);
      }
      log(`live gateway at ${LIVE_URL} — using it (PGlite stays single-opened)`);
      return { base: LIVE_URL, editorToken, builderToken, mode: 'live', close: async () => {} };
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes(TOKEN_FILE)) throw err;
    // not live — fall through to embedded mode
  }

  // 2. embedded PGlite
  log(`no live gateway — opening PGlite store at ${DATA_DIR} …`);
  const tokens = {
    'smoke-editor-token': { id: 'smoke-editor', scopes: ['Suggest', 'Read', 'Edit'] },
    'smoke-builder-token': { id: 'builder-runtime', scopes: ['Build'] },
  };
  const backend = await openPgBackend({ dataDir: DATA_DIR });
  const { server } = createGateway({
    tokens,
    skillStore: await PgSkillStore.over(backend.db),
    store: await PgGovernanceStore.over(backend.db),
    approvalStore: await PgApprovalStore.over(backend.db),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  log(`embedded gateway listening at ${base}/mcp`);
  return {
    base,
    editorToken: 'smoke-editor-token',
    builderToken: 'smoke-builder-token',
    mode: 'embedded',
    close: async () => {
      try {
        await new Promise((resolve) => server.close(resolve));
      } catch {}
      try {
        await backend.close();
      } catch {}
    },
  };
}

/** JSON-RPC tools/call against the gateway, as the editor principal. */
export function makeCaller(base, editorToken) {
  let rpcId = 1;
  return async function callTool(name, args) {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${editorToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }),
    });
    if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`JSON-RPC ${body.error.code}: ${body.error.message}`);
    const payload = JSON.parse(body.result.content[0].text);
    if (body.result.isError) throw new Error(`tool rejected: ${payload.reason} — ${payload.message ?? ''}`);
    return payload;
  };
}

/** Two-call approval flow: begin, then confirm with the challenge token. */
export async function gated(callTool, name, args) {
  const first = await callTool(name, args);
  if (first.approval_required === true) return callTool(name, { ...args, _confirmation: first.confirmation_token });
  return first;
}

/** Print the chain; returns true when both provenance fields are present. */
export function printChain(system) {
  console.log('\n=== four-level traceability chain ===');
  console.log(`system:          ${system.id} (${system.name}@${system.version}, ${system.status})`);
  console.log(`spec:            ${system.source_spec_id}`);
  console.log(`blueprint_hash:  ${system.blueprint_hash}`);
  console.log(`verify_report:   ${system.verify_report_ref}`);
  console.log(`registered_by:   ${system.registered_by}`);
  return Boolean(system.blueprint_hash && system.verify_report_ref);
}

/** Idempotency check: find the already-registered system, if any. */
export async function findExisting(callTool, name, version) {
  const pre = await callTool('search_systems', { query: name });
  return pre.systems.find((s) => s.name === name && s.version === version) ?? null;
}

/** Reuse a matching draft spec, else draft a new one; submit when draft. */
export async function ensureApprovedSpec(callTool, log, { title, provenanceSkill, specArgs }) {
  const found = await callTool('search_specs', { query: title, limit: 10 });
  let specId = found.specs.find((s) => s.title === title && s.status === 'draft')?.id;
  if (!specId) {
    const { skills } = await callTool('search_skills', { only_approved: true });
    const provenance = skills.some((s) => s.id === provenanceSkill)
      ? [provenanceSkill]
      : skills.length > 0
        ? [skills[0].id]
        : [];
    log(`drafting spec "${title}" (provenance: ${provenance.join(', ') || 'none'}) …`);
    const drafted = await gated(callTool, 'generate_system_spec', { ...specArgs, source_skill_ids: provenance });
    specId = drafted.spec_id;
    log(`spec drafted: ${specId}`);
  } else {
    log(`reusing existing draft spec ${specId}`);
  }

  const specNow = (await callTool('search_specs', { query: title, limit: 10 }))
    .specs.find((s) => s.id === specId);
  if (specNow.status === 'draft') {
    await gated(callTool, 'submit_system_spec', { spec_id: specId });
    log('spec submitted → approved');
  } else {
    log(`spec already ${specNow.status}`);
  }
  return specId;
}

/** Read the registered system back and assert the chain. */
export async function readBack(callTool, name, version) {
  const { systems } = await callTool('search_systems', { query: name });
  const system = systems.find((s) => s.name === name && s.version === version);
  if (!system) throw new Error('registered system not found in search_systems');
  return { system, complete: printChain(system) };
}

/**
 * PGlite on Windows can trip a libuv assertion when the process exits while
 * its handles are mid-close — prefer a natural exit and only force-exit as a
 * delayed fallback once libuv has settled.
 */
export function settleExit(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1500).unref();
}
