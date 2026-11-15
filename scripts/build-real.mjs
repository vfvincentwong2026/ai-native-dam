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
 *   MODEL_TIER_C0..C3        concrete model per tier (default: cohere/north-mini-code:free;
 *                            see .env.example for a free-tier per-tier lineup)
 *   MODEL_RUN_MAX_CALLS      budget breaker (default 25)
 *   MODEL_RUN_MAX_TOKENS     budget breaker (default 200000)
 *   BUILD_SYSTEM_VERSION     version to register (default 0.2.0)
 *   BUILD_SANDBOX            executable verification: auto (default, docker
 *                            when available) | docker | local (host shell,
 *                            no isolation — dev only) | off
 *   DAM_GATEWAY_URL          resident gateway (default http://127.0.0.1:8080)
 *   DAM_PG_DATA_DIR          embedded store when no gateway answers
 *
 * Usage:  pnpm build:real
 *
 * Idempotent: the real-built system registers as version 0.2.0 (0.1.0 is the
 * smoke's stub build); a repeat run finds it and just prints the chain.
 */
import { Orchestrator, HttpMcpClient } from '../runtime/orchestrator/dist/index.js';
import { ModelRouter, OpenAiHttpTransport } from '../runtime/model-router/dist/index.js';
import { DockerSandboxRunner, LocalSandboxRunner, systemSpawn } from '../runtime/compilation/dist/index.js';
import {
  connectGateway,
  ensureApprovedSpec,
  ensureDist,
  findExisting,
  makeCaller,
  printChain,
  readBack,
  settleExit,
} from './lib/build-chain.mjs';

const SPEC_TITLE = '版权到期预警台';
const SYSTEM_NAME = '版权到期预警台';
const SYSTEM_VERSION = process.env.BUILD_SYSTEM_VERSION ?? '0.2.0'; // 0.1.0 is the smoke's stub build
const PROVENANCE_SKILL = 'operations:project-context';
const DEFAULT_MODEL = 'cohere/north-mini-code:free';

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

await ensureDist(log, ['runtime/model-router/dist/index.js']);

const gw = await connectGateway(log);
const callTool = makeCaller(gw.base, gw.editorToken);

let exitCode = 0;
try {
  const already = await findExisting(callTool, SYSTEM_NAME, SYSTEM_VERSION);
  if (already) {
    log(`system ${already.id} already registered — verifying the existing chain.`);
    if (!printChain(already)) fail('traceability fields missing on the registered system');
  } else {
    const specId = await ensureApprovedSpec(callTool, log, {
      title: SPEC_TITLE,
      provenanceSkill: PROVENANCE_SKILL,
      specArgs: {
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
      },
    });

    // --------------------------------------------- Builder Runtime (Build)
    const client = new HttpMcpClient({ baseUrl: gw.base, token: gw.builderToken });

    // Executable verification (ADR 0010 §4 step 2). BUILD_SANDBOX:
    //   auto  (default) — docker when the CLI answers, otherwise off
    //   docker — throwaway containers (requires a running Docker)
    //   local  — host shell, NO isolation; dev machines only
    //   off    — structural gate only
    const sandboxMode = (process.env.BUILD_SANDBOX ?? 'auto').toLowerCase();
    let sandbox;
    if (sandboxMode === 'docker') {
      sandbox = new DockerSandboxRunner();
    } else if (sandboxMode === 'local') {
      sandbox = new LocalSandboxRunner();
      log('sandbox: LOCAL host execution (no isolation — dev only)');
    } else if (sandboxMode === 'auto') {
      const probe = await systemSpawn('docker', ['--version']).catch(() => null);
      if (probe && probe.exitCode === 0) {
        sandbox = new DockerSandboxRunner();
      } else {
        log('sandbox: docker CLI not found — structural gate only (set BUILD_SANDBOX=local to verify on the host)');
      }
    } else if (sandboxMode !== 'off') {
      throw new Error(`unknown BUILD_SANDBOX "${sandboxMode}" (auto|docker|local|off)`);
    }
    if (sandbox) log(`sandbox: ${sandboxMode === 'auto' ? 'docker (auto-detected)' : sandboxMode}`);

    const orchestrator = new Orchestrator(client, undefined, {
      ...(sandbox ? { sandbox } : {}),
      sandboxWorkDir: '.dam-runs',
      // Free-tier models occasionally emit broken code (stray token, orphan
      // fence, node:sqlite API guesses). Allow two targeted repair rounds:
      // the blamed files are regenerated with the exact compiler log, then
      // the sandbox re-runs.
      sandboxRepairAttempts: 4,
    });

    const run = await orchestrator.startRun(specId);
    log(`run ${run.id} opened (state: ${run.state})`);
    const blueprint = orchestrator.getBlueprint(run.id);
    log(`blueprint planned: ${blueprint.id} hash=${blueprint.hash} files=${blueprint.files.length}`);

    // REAL compilation: every call routed by tier, ledgered, budget-guarded.
    // Free-pool models (e.g. 550B params) can take minutes per completion —
    // the 120s transport default aborts them mid-generation, so the timeout
    // is an explicit run knob.
    const router = new ModelRouter({
      transport: new OpenAiHttpTransport({
        baseUrl,
        apiKey,
        timeoutMs: Number(process.env.MODEL_TIMEOUT_MS ?? 120_000),
      }),
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

    const { complete } = await readBack(callTool, SYSTEM_NAME, SYSTEM_VERSION);
    if (!complete) {
      fail('traceability fields missing on the registered system');
    } else {
      log('chain complete — real-LLM build registered.');
    }
  }
} catch (err) {
  exitCode = 1;
  // VerificationFailedError carries the gate report — print every check so
  // a sandbox failure shows its log tail without digging into .dam-runs.
  const report = err && typeof err === 'object' ? err.report : undefined;
  if (report?.checks) {
    console.error(`[real] verify gate report (${report.ok ? 'PASS' : 'FAIL'}):`);
    for (const c of report.checks) console.error(`    ${c.ok ? '✓' : '✗'} ${c.name} — ${c.detail}`);
  }
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await gw.close();
}
settleExit(exitCode);
