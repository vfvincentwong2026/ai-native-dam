/**
 * Builder Runtime REAL-LLM run — like `smoke:builder`, but compilation goes
 * through the model-router with a live OpenAI-compatible endpoint
 * (OpenRouter, DeepSeek, Ollama, …) instead of the stub completer.
 *
 * The run records every LLM call in the router's ledger (tier, model,
 * tokens) under the run-level budget breaker, and the verify gate stays
 * exactly as deterministic as in the smoke — generation quality is reviewed
 * by a human at the registration gate, not by the gate itself.
 *
 * Setup (repo root, git-ignored `.env` — see .env.example):
 *
 *   MODEL_ROUTER_BASE_URL=https://openrouter.ai/api/v1
 *   MODEL_ROUTER_API_KEY=sk-or-…
 *
 * Optional overrides:
 *   MODEL_TIER_C0..C3        concrete model per tier (default: openai/gpt-4o-mini)
 *   MODEL_RUN_MAX_CALLS      budget breaker (default 25)
 *   MODEL_RUN_MAX_TOKENS     budget breaker (default 200000)
 *   DAM_PG_DATA_DIR          governance store (default .review/pgdata)
 *
 * Usage:  pnpm build:real
 *
 * Idempotent: the real-built system registers as version 0.2.0 (0.1.0 is the
 * smoke's stub build); a repeat run finds it and just prints the chain.
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
import { ModelRouter, OpenAiHttpTransport } from '../runtime/model-router/dist/index.js';

const DATA_DIR = process.env.DAM_PG_DATA_DIR ?? '.review/pgdata';
const EDITOR_TOKEN = 'real-run-editor-token';
const BUILDER_TOKEN = 'real-run-builder-token';
const SPEC_TITLE = '版权到期预警台';
const SYSTEM_NAME = '版权到期预警台';
const SYSTEM_VERSION = '0.2.0'; // 0.1.0 is the smoke's stub build
const PROVENANCE_SKILL = 'operations:project-context';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

const log = (msg) => console.log(`[real] ${msg}`);
const fail = (msg) => {
  console.error(`[real] FAILED: ${msg}`);
  process.exitCode = 1;
};

// ---------------------------------------------------------- configuration
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env — env vars may come from the shell */
}
const baseUrl = process.env.MODEL_ROUTER_BASE_URL;
const apiKey = process.env.MODEL_ROUTER_API_KEY;
if (!baseUrl || !apiKey) {
  console.error('[real] MODEL_ROUTER_BASE_URL / MODEL_ROUTER_API_KEY unset — copy .env.example to .env and fill them in.');
  process.exit(1);
}
const tierModels = {
  C0: process.env.MODEL_TIER_C0 ?? DEFAULT_MODEL,
  C1: process.env.MODEL_TIER_C1 ?? DEFAULT_MODEL,
  C2: process.env.MODEL_TIER_C2 ?? DEFAULT_MODEL,
  C3: process.env.MODEL_TIER_C3 ?? DEFAULT_MODEL,
};
const budget = {
  maxCalls: Number(process.env.MODEL_RUN_MAX_CALLS ?? 25),
  maxTotalTokens: Number(process.env.MODEL_RUN_MAX_TOKENS ?? 200_000),
};

for (const dist of [
  'packages/mcp-gateway/dist/index.js',
  'runtime/orchestrator/dist/index.js',
  'runtime/model-router/dist/index.js',
]) {
  try {
    await access(dist);
  } catch {
    console.error(`[real] ${dist} missing — run \`pnpm build\` first.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- gateway
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

    // REAL compilation: every call routed by tier, ledgered, budget-guarded.
    const router = new ModelRouter({
      transport: new OpenAiHttpTransport({ baseUrl, apiKey }),
      tierModels,
      budget,
    });
    log(`compiling with real LLM egress (${baseUrl}; budget: ${budget.maxCalls} calls / ${budget.maxTotalTokens} tokens) …`);
    await orchestrator.compile(run.id, router);
    const usages = orchestrator.getSkillUsages(run.id) ?? [];
    log(`compiled; provenance skills applied: ${usages.map((u) => `${u.skillId}@${u.version}`).join(', ') || '(none)'}`);

    const cost = router.costSummary(run.id);
    log(`ledger: ${cost.calls} calls, ${cost.inputTokens} in / ${cost.outputTokens} out tokens, ${cost.failedCalls} failed`);

    // Peek at one generated model file to prove real generation.
    const build = orchestrator.getBuild(run.id);
    const modelFile = build?.files.find((f) => f.path.includes('model')) ?? build?.files[0];
    if (modelFile) {
      const head = modelFile.content.split('\n').slice(0, 6).join('\n');
      console.log(`\n--- ${modelFile.path} (first lines) ---\n${head}\n---`);
    }

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
      log('chain complete — real-LLM build registered.');
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
