/**
 * Builder Runtime smoke — drives the full ADR 0010 chain against a real
 * (PGlite) governance store:
 *
 *   approved spec → Blueprint (content hash) → verify gate → registered system
 *
 * and asserts the registered system carries a non-empty `blueprint_hash` and
 * `verify_report_ref` — the four-level traceability chain.
 *
 * Self-contained: boots the MCP gateway in-process with its own tokens
 * (smoke-editor + builder-runtime) on a random local port. No external
 * services, no LLM — compilation uses a stub completer because the verify
 * gate is structural (file list, manifest fields, hash self-consistency).
 *
 * Usage (from the repo root, after `pnpm build`):
 *
 *   pnpm smoke:builder                       # against .review/pgdata
 *   DAM_PG_DATA_DIR=/tmp/dam-smoke pnpm smoke:builder
 *
 * Idempotent: reuses an existing draft spec, skips registration when the
 * system already exists, and prints the chain either way. Exit code is 0
 * only when the chain is complete.
 */
import { access } from 'node:fs/promises';
import {
  createGateway,
  openPgBackend,
  PgApprovalStore,
  PgGovernanceStore,
  PgSkillStore,
} from '../packages/mcp-gateway/dist/index.js';
import { HttpMcpClient, Orchestrator } from '../runtime/orchestrator/dist/index.js';

const DATA_DIR = process.env.DAM_PG_DATA_DIR ?? '.review/pgdata';
const EDITOR_TOKEN = 'smoke-editor-token';
const BUILDER_TOKEN = 'smoke-builder-token';
const SPEC_TITLE = '版权到期预警台';
const SYSTEM_NAME = '版权到期预警台';
const SYSTEM_VERSION = '0.1.0';
/** Preferred provenance skill; falls back to any approved skill, then none. */
const PROVENANCE_SKILL = 'operations:project-context';

const log = (msg) => console.log(`[smoke] ${msg}`);
const fail = (msg) => {
  console.error(`[smoke] FAILED: ${msg}`);
  process.exitCode = 1;
};

// Dist prerequisites (cross-package imports resolve against build output).
for (const dist of ['packages/mcp-gateway/dist/index.js', 'runtime/orchestrator/dist/index.js']) {
  try {
    await access(dist);
  } catch {
    console.error(`[smoke] ${dist} missing — run \`pnpm build\` first.`);
    process.exit(1);
  }
}

const tokens = {
  [EDITOR_TOKEN]: { id: 'smoke-editor', scopes: ['Suggest', 'Read', 'Edit'] },
  [BUILDER_TOKEN]: { id: 'builder-runtime', scopes: ['Build'] },
};

log(`opening PGlite store at ${DATA_DIR} …`);
const backend = await openPgBackend({ dataDir: DATA_DIR });
const { server } = createGateway({
  tokens,
  skillStore: await PgSkillStore.over(backend.db),
  store: await PgGovernanceStore.over(backend.db),
  approvalStore: await PgApprovalStore.over(backend.db),
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;
log(`gateway listening at ${BASE}/mcp`);

// ------------------------------------------------- raw JSON-RPC (Edit lane)
let rpcId = 1;
async function callTool(name, args) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EDITOR_TOKEN}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`JSON-RPC ${body.error.code}: ${body.error.message}`);
  const payload = JSON.parse(body.result.content[0].text);
  if (body.result.isError) throw new Error(`tool rejected: ${payload.reason} — ${payload.message ?? ''}`);
  return payload;
}
/** Two-call approval flow: begin, then confirm with the challenge token. */
async function gated(name, args) {
  const first = await callTool(name, args);
  if (first.approval_required === true) return callTool(name, { ...args, _confirmation: first.confirmation_token });
  return first;
}

function chainComplete(system) {
  console.log('\n=== four-level traceability chain ===');
  console.log(`system:          ${system.id} (${system.name}@${system.version}, ${system.status})`);
  console.log(`spec:            ${system.source_spec_id}`);
  console.log(`blueprint_hash:  ${system.blueprint_hash}`);
  console.log(`verify_report:   ${system.verify_report_ref}`);
  console.log(`registered_by:   ${system.registered_by}`);
  return Boolean(system.blueprint_hash && system.verify_report_ref);
}

let exitCode = 0;
try {
  // ------------------------------------- 0. idempotency: already registered?
  const pre = await callTool('search_systems', { query: SYSTEM_NAME });
  const already = pre.systems.find((s) => s.name === SYSTEM_NAME && s.version === SYSTEM_VERSION);
  if (already) {
    log(`system ${already.id} already registered — verifying the existing chain.`);
    if (!chainComplete(already)) fail('traceability fields missing on the registered system');
  } else {
    // ----------------------------- 1. spec (Edit) — reuse an existing draft
    const found = await callTool('search_specs', { query: SPEC_TITLE, limit: 10 });
    let specId = found.specs.find((s) => s.title === SPEC_TITLE && s.status === 'draft')?.id;
    if (!specId) {
      // Provenance: prefer the canonical skill, fall back to any approved
      // one so the smoke also runs against a fresh store.
      const { skills } = await callTool('search_skills', { only_approved: true });
      const provenance = skills.some((s) => s.id === PROVENANCE_SKILL)
        ? [PROVENANCE_SKILL]
        : skills.length > 0
          ? [skills[0].id]
          : [];
      log(`drafting spec "${SPEC_TITLE}" (provenance: ${provenance.join(', ') || 'none'}) …`);
      const drafted = await gated('generate_system_spec', {
        title: SPEC_TITLE,
        business_domain: 'operations',
        requirements:
          '每日扫描素材库版权到期日：到期前 30 天列入观察清单、前 7 天升级为重点预警；' +
          '输出待续约/待下架两条处置队列，运营同学按队列处理并回填结果。',
        entities: [
          {
            name: 'license_alert',
            fields: [
              { name: 'id', type: 'string', required: true, description: 'Primary key' },
              { name: 'asset_id', type: 'string', required: true, description: '关联素材' },
              { name: 'expires_at', type: 'datetime', required: true, description: '版权到期日' },
              { name: 'alert_level', type: 'string', required: true, description: 'watch / urgent' },
            ],
            permissions: ['read'],
          },
        ],
        workflows: ['daily_scan', 'renew_or_takedown'],
        source_skill_ids: provenance,
      });
      specId = drafted.spec_id;
      log(`spec drafted: ${specId}`);
    } else {
      log(`reusing existing draft spec ${specId}`);
    }

    const specNow = (await callTool('search_specs', { query: SPEC_TITLE, limit: 10 }))
      .specs.find((s) => s.id === specId);
    if (specNow.status === 'draft') {
      await gated('submit_system_spec', { spec_id: specId });
      log('spec submitted → approved');
    } else {
      log(`spec already ${specNow.status}`);
    }

    // ------------------------------------------- 2. Builder Runtime (Build)
    const client = new HttpMcpClient({ baseUrl: BASE, token: BUILDER_TOKEN });
    const orchestrator = new Orchestrator(client);

    const run = await orchestrator.startRun(specId);
    log(`run ${run.id} opened (state: ${run.state})`);
    const blueprint = orchestrator.getBlueprint(run.id);
    log(`blueprint planned: ${blueprint.id} hash=${blueprint.hash} files=${blueprint.files.length}`);

    const completer = {
      async complete({ promptSummary }) {
        return { text: `// generated by the builder-runtime smoke\n// ${promptSummary}\n` };
      },
    };
    await orchestrator.compile(run.id, completer);
    const usages = orchestrator.getSkillUsages(run.id) ?? [];
    log(`compiled; provenance skills applied: ${usages.map((u) => `${u.skillId}@${u.version}`).join(', ') || '(none)'}`);

    await orchestrator.requestRegistration(run.id, { name: SYSTEM_NAME, version: SYSTEM_VERSION });
    const report = orchestrator.getVerifyReport(run.id);
    log(`verify gate: ${report.ok ? 'PASS' : 'FAIL'} (${report.checks.length} checks)`);
    for (const c of report.checks) console.log(`    ${c.ok ? '✓' : '✗'} ${c.name} — ${c.detail}`);

    const done = await orchestrator.confirmRegistration(run.id);
    log(`run closed (state: ${done.state})`);

    // --------------------------------------------- 3. read back the chain
    const { systems } = await callTool('search_systems', { query: SYSTEM_NAME });
    const system = systems.find((s) => s.name === SYSTEM_NAME && s.version === SYSTEM_VERSION);
    if (!system) throw new Error('registered system not found in search_systems');
    if (!chainComplete(system)) {
      fail('traceability fields missing on the registered system');
    } else {
      log('chain complete.');
    }
  }
} catch (err) {
  exitCode = 1;
  fail(err instanceof Error ? err.message : String(err));
} finally {
  try {
    await new Promise((resolve) => server.close(resolve));
  } catch {}
  try {
    await backend.close();
  } catch {}
}
// PGlite on Windows can trip a libuv assertion when the process exits while
// its handles are mid-close — prefer a natural exit and only force-exit as a
// delayed fallback once libuv has settled.
process.exitCode = exitCode;
setTimeout(() => process.exit(exitCode), 1500).unref();
