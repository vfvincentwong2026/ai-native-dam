/**
 * Blueprint executor (ADR 0010 §1/§7): runs the prompt plan of a Blueprint
 * and produces the generated build that the verify gate checks.
 *
 * The pipeline stays pure in its *structure*: iteration order, prompts, and
 * file assembly are deterministic functions of the blueprint. The only
 * non-determinism lives behind the injected `BlueprintCompleter` seam — in
 * production that is the model-router (which records every call run-locally
 * and enforces the budget breaker), in tests a stub.
 *
 * Plan items are special-cased by construction:
 *  - `dam.manifest.yaml`, `tsconfig.json`, `src/server.ts` are NEVER
 *    LLM-generated: deterministic infrastructure (`DETERMINISTIC_FILES`).
 *  - the `(review)` item runs the C3 cross-module consistency pass; its
 *    result is returned as review notes, not written as a file.
 */

import type { Blueprint, EntityTableSchema, PromptPlanItem, PromptTier } from './blueprint.js';
import { generateManifest } from './manifest.js';
import type { BuildOutput } from './verify.js';

/**
 * Minimal LLM seam — structurally satisfied by `ModelRouter` from
 * `@ai-native-dam/runtime-model-router`, so compilation needs no hard
 * dependency on the router package (and never touches the network itself).
 */
export interface BlueprintCompleter {
  complete(request: {
    runId: string;
    tier: PromptTier;
    promptSummary: string;
    prompt: string;
  }): Promise<{ text: string }>;
}

export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
  readonly tier: PromptTier;
  readonly promptSummary: string;
}

export interface CompiledBuild {
  readonly blueprintRef: string;
  /** Every planned file, in blueprint order (includes dam.manifest.yaml). */
  readonly files: readonly GeneratedFile[];
  /** Contents of dam.manifest.yaml (deterministic, not LLM output). */
  readonly manifest: string;
  /** C3 cross-module consistency review notes. */
  readonly review: string;
}

export interface ExecuteOptions {
  readonly runId: string;
  readonly completer: BlueprintCompleter;
  /** Override prompt construction (tests, prompt experiments). */
  readonly promptFor?: (item: PromptPlanItem, blueprint: Blueprint) => string;
}

/** Deterministic default prompt: stack + module context + the planned purpose. */
function defaultPrompt(item: PromptPlanItem, blueprint: Blueprint): string {
  const storage = storageNote(blueprint);
  const stack = `Stack: ${blueprint.stack.runtime} / ${blueprint.stack.framework} / ${storage}.`;
  if (item.file === '(review)') {
    const listing = blueprint.files.map((f) => `- ${f.path} (${f.kind}, module ${f.module}): ${f.purpose}`).join('\n');
    return [
      `Cross-module consistency review of a generated system.`,
      stack,
      `Planned files:\n${listing}`,
      `Check: imports resolve across modules; route/model field alignment; manifest matches actual endpoints. Report issues only.`,
    ].join('\n\n');
  }
  const file = blueprint.files.find((f) => f.path === item.file);
  const module = blueprint.modules.find((m) => m.name === file?.module);
  return [
    `Generate the file ${item.file}.`,
    stack,
    module ? `Module ${module.name}: ${module.purpose}` : '',
    `Purpose: ${file?.purpose ?? item.promptSummary}`,
    // The LLM must not invent dependency versions: hallucinated versions
    // (ETARGET) and peer conflicts are the top install failures the
    // executable sandbox caught. The dependency set is fixed by the stack —
    // and every other file may import ONLY from that set (plus node:
    // built-ins); the sandbox caught tests importing uninstalled frameworks
    // (express/supertest) otherwise.
    item.file === 'package.json'
      ? `Rules: use EXACTLY this dependency set — no additions, removals, or version changes (split runtime vs devDependencies sensibly): ${JSON.stringify(stackDependencies(blueprint))}. Include scripts "build" (tsc -p tsconfig.json) and "test" (vitest run).`
      : `Rules: import ONLY from these installed dependencies ${JSON.stringify(Object.keys(stackDependencies(blueprint)))} or Node.js built-in modules (node:sqlite, node:http, node:fs, node:path...). No web frameworks (express, fastify, koa) — they are NOT installed.`,
    // The deterministic server entry calls every route module's handle() in
    // order — the contract is compile-enforced (tsc checks the call site),
    // so state it exactly. Contract types live in src/contract.ts so test
    // mocks type-check without casts. Relative imports use literal .ts
    // extensions (the service runs under node's native type stripping).
    file?.kind === 'route'
      ? `Contract: export EXACTLY one entry — \`export const handle: RouteHandle = async (req, res, db) => { ... }\` with \`import type { RouteHandle } from '../contract.ts';\` (relative imports MUST use the literal .ts extension). Mount at the EXACT base path "/${file.entity?.table ?? '<table>'}" — list is GET /${file.entity?.table ?? '<table>'}, item is GET /${file.entity?.table ?? '<table>'}/:id, write verbs (POST/PUT/DELETE) only if listed in Purpose. The generated management console calls these exact paths, so no other path spellings (no plurals, no kebab variants). Match on req.method + parsed url pathname, res.writeHead(...).end(body), return true when this module handled the request; return false otherwise. Use the db argument for ALL data access — never open your own DatabaseSync. No server creation, no listen() — the deterministic src/server.ts owns the server.`
      : '',
    file?.kind === 'model'
      ? 'Contract: every exported function takes db: DatabaseSync (type-import from \'node:sqlite\') as its first parameter. NO module-level DatabaseSync, NO getDb() singleton — the caller owns the connection (tests pass an in-memory db; a module-level connection makes tables vanish).'
      : '',
    // The table binding is planned, not chosen: state the exact table and
    // columns so model/route/test agree byte-for-byte, and ban CREATE TABLE
    // (src/schema.ts owns schema — observed runtime failure: nothing created
    // the table, so every CRUD route 500'd despite green tests).
    file?.entity
      ? `Table contract: SQLite table "${file.entity.table}" ALREADY EXISTS with columns (${columnList(file.entity)}). The deterministic src/schema.ts creates it — NEVER write CREATE TABLE yourself, just use the table.`
      : '',
    // Tests exercise the route contract directly against the contract types.
    file?.kind === 'test'
      ? 'Contract: import { handle } from the route module under test (literal .ts extension) and call it with plain mock objects satisfying DamRequest/DamResponse from \'../src/contract.ts\' — e.g. req = { method, url, headers: {} } and res = { statusCode: 0, writeHead: vi.fn(), end: vi.fn() }; NO casts, the literals satisfy the contract directly. handle is async — ALWAYS `await handle(...)` before asserting. Create a fresh DatabaseSync(":memory:") and FIRST run ensureSchema(db) from \'../src/schema.ts\' on it — tables exist only after ensureSchema runs. sqlite returns TEXT columns as strings and INTEGER as numbers — assert loosely (String(...) coercion, or toBe("1") on TEXT ids). No HTTP server, no supertest, no node:http classes.'
      : '',
    `Output ONLY the raw file content — no markdown \`\`\` fences, no leading filename line, no commentary.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Fixed dependency sets per stack storage. Versions are caret ranges on
 * releases verified to exist and resolve together; the LLM assembles the
 * manifest but never invents versions.
 */
function stackDependencies(blueprint: Blueprint): Record<string, string> {
  const base = {
    typescript: '^5.6.0',
    // vitest 2.x (vite 5) cannot resolve prefix-only builtins like
    // node:sqlite — vite-node checks module.builtinModules, which omits them,
    // so the id is stripped to 'sqlite' and resolution fails. vitest 3 fixed
    // the builtin detection (verified in-sandbox with node:sqlite imports).
    vitest: '^3.2.0',
    '@types/node': '^22.0.0',
  };
  const storage: Record<string, Record<string, string>> = {
    // sqlite uses the built-in node:sqlite module — no npm driver at all.
    postgres: { pg: '^8.13.0' },
  };
  return { ...base, ...(storage[blueprint.stack.storage] ?? {}) };
}

/**
 * Storage line shared by generation and repair prompts. For sqlite the
 * model must be TOLD the node:sqlite API surface — models otherwise
 * hallucinate better-sqlite3-style methods (execSync/prepareSync) or import
 * native drivers the sandbox cannot install (observed in real runs).
 */
export function storageNote(blueprint: Blueprint): string {
  if (blueprint.stack.storage !== 'sqlite') return blueprint.stack.storage;
  return [
    'sqlite via the built-in node:sqlite module (NO npm driver — never import better-sqlite3/sqlite3).',
    'The import specifier must be exactly "node:sqlite" WITH the node: prefix — bare "sqlite" does not resolve under vitest.',
    'Exact API: import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync("data.db");',
    'db.exec("CREATE TABLE ..."); const s = db.prepare("INSERT ..."); s.run(...params); s.get(...); s.all(...).',
    'There is NO execSync/prepareSync — those do not exist.',
    'Typing: params must be scalars (string | number | bigint | null | Uint8Array) — never arrays or objects.',
    'prepare().all() returns Record<string, SQLOutputValue>[] — map rows field by field (String(row.id), Number(row.x)) into your types.',
    'A bare `as YourType[]` cast is rejected by tsc strict (TS2352); if you must assert, use `as unknown as YourType[]` — field mapping is preferred.',
  ].join(' ');
}

/**
 * Spec field types map onto SQLite affinities. datetime/json stay TEXT (ISO
 * strings / serialized JSON); booleans are INTEGER 0/1 — the storageNote
 * already teaches models to map rows back field by field.
 */
const SQL_TYPES: Record<EntityTableSchema['fields'][number]['type'], string> = {
  string: 'TEXT',
  number: 'REAL',
  boolean: 'INTEGER',
  datetime: 'TEXT',
  json: 'TEXT',
};

const SQL_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** SQL column list for prompts, e.g. "id TEXT PRIMARY KEY, title TEXT NOT NULL". */
export function columnList(entity: EntityTableSchema): string {
  return entity.fields
    .map((f) => {
      const pk = f.name === 'id' ? ' PRIMARY KEY' : '';
      const nn = f.required && f.name !== 'id' ? ' NOT NULL' : '';
      return `${f.name} ${SQL_TYPES[f.type]}${pk}${nn}`;
    })
    .join(', ');
}

/**
 * src/schema.ts is deterministic infrastructure (like src/server.ts): it
 * emits CREATE TABLE IF NOT EXISTS for every planned entity table. Without
 * it the schema only existed if an LLM happened to write CREATE TABLE — when
 * it didn't, every CRUD route failed at runtime with "no such table" while
 * the whole build+test gate stayed green (tests mocked or self-created the
 * table). Table and column names are validated as plain SQL identifiers so
 * spec content can never inject into the emitted SQL.
 */
export function generateSchema(blueprint: Blueprint): string {
  const tables = new Map<string, EntityTableSchema>();
  for (const f of blueprint.files) {
    if (f.entity && !tables.has(f.entity.table)) tables.set(f.entity.table, f.entity);
  }
  const stmts = [...tables.values()].map((entity) => {
    for (const ident of [entity.table, ...entity.fields.map((f) => f.name)]) {
      if (!SQL_IDENT.test(ident)) {
        throw new Error(`schema: '${ident}' is not a plain SQL identifier — refusing to emit it`);
      }
    }
    return `  db.exec("CREATE TABLE IF NOT EXISTS ${entity.table} (${columnList(entity)})");`;
  });
  return `${HEADER_COMMENT}
import type { DatabaseSync } from 'node:sqlite';

/**
 * Creates every entity table (idempotent). src/server.ts calls this once at
 * boot; tests call it on their in-memory db before exercising routes.
 */
export function ensureSchema(db: DatabaseSync): void {
${stmts.join('\n')}
}
`;
}

/**
 * tsconfig.json is stack-determined infrastructure, exactly like
 * dam.manifest.yaml — letting the LLM write it only adds failure modes
 * (observed: "include": ["*.ts"] → TS18003 no inputs). Deterministic.
 */
export function generateTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        // node runs TS sources directly (native type stripping) — that
        // requires literal .ts import specifiers, and type-check-only build.
        allowImportingTsExtensions: true,
        noEmit: true,
        types: ['node'],
      },
      include: ['src/**/*.ts', 'tests/**/*.ts'],
      exclude: ['node_modules', 'dist'],
    },
    null,
    2,
  )}\n`;
}

/**
 * src/contract.ts is the deterministic contract between the server entry,
 * the LLM-written route modules, and the LLM-written tests. Structural
 * minimal shapes — NOT node:http classes — so test mocks type-check under
 * strict mode without casts (observed failure: express-style mocks failed
 * TS2322/TS2339 against ServerResponse).
 */
export function generateContract(): string {
  return `${HEADER_COMMENT}
import type { DatabaseSync } from 'node:sqlite';

export interface DamRequest {
  method?: string;
  url?: string;
  // Always present (mirrors node:http IncomingMessage.headers).
  headers: Record<string, string | string[] | undefined>;
}

export interface DamResponse {
  statusCode?: number;
  // void return — a chainable return type forces mocks to return themselves,
  // which generated tests get wrong (observed TS2352 in generated tests).
  writeHead(status: number, headers?: Record<string, string>): void;
  end(body?: string): void;
}

/** Route entry: return true when this module handled the request. */
export type RouteHandle = (req: DamRequest, res: DamResponse, db: DatabaseSync) => Promise<boolean>;
`;
}

/**
 * src/server.ts is deterministic infrastructure (like the manifest and
 * tsconfig): it wires /health plus every route module's contracted
 * `handle()` in blueprint order. Route paths come from the plan, so the
 * server never needs the LLM — and tsc enforces the route contract at the
 * call site. Import specifiers use literal .ts extensions because the
 * service runs under node's native type stripping (no .js → .ts mapping).
 */
export function generateServer(blueprint: Blueprint): string {
  const routes = blueprint.files.filter((f) => f.kind === 'route').map((f) => f.path);
  const imports = routes
    .map((p, i) => `import { handle as handle${i} } from './${p.replace(/^src\//, '')}';`)
    .join('\n');
  const handlers = routes.map((_, i) => `handle${i}`).join(', ');
  return `${HEADER_COMMENT}
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { RouteHandle } from './contract.ts';
import { ensureSchema } from './schema.ts';
${imports}

const db = new DatabaseSync(process.env.DB_PATH ?? 'data.db');
// Tables are deterministic infrastructure — created here, never by routes.
ensureSchema(db);
const handlers: RouteHandle[] = [${handlers}];
// The management console is a compiler-generated static SPA (console/index.html).
const consoleHtml = readFileSync(new URL('../console/index.html', import.meta.url), 'utf8');

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy' }));
      return;
    }
    if (req.method === 'GET' && (req.url === '/console' || req.url === '/console/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(consoleHtml);
      return;
    }
    for (const handle of handlers) {
      if (await handle(req, res, db)) return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal', detail: String(err) }));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(\`listening on :\${port}\`));
`;
}

/**
 * console/index.html — the generated system's management console, emitted
 * deterministically from the blueprint's entity bindings. Zero LLM tokens:
 * the UI structure is a pure function of the planned entities, exactly like
 * schema.ts. It is a generic JSON-table SPA (one view per entity, fetched
 * from the entity's fixed route path /<slug>) so it stays correct regardless
 * of the JSON shape the LLM chose for row mapping.
 */
export function generateConsole(blueprint: Blueprint): string {
  const entities = new Map<string, EntityTableSchema>();
  for (const f of blueprint.files) {
    if (f.entity && !entities.has(f.entity.table)) entities.set(f.entity.table, f.entity);
  }
  const views = [...entities.entries()].map(([table], i) => {
    const slug = table; // route base path is mandated as /<table> in the route prompt
    return `    <a class="nav-item${i === 0 ? ' on' : ''}" data-view="${slug}" href="#">▦ ${table}</a>`;
  }).join('\n');
  const first = [...entities.keys()][0] ?? '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>管理控制台 · AI-Native DAM Generated System</title>
<style>
  :root { --bg:#05080e; --panel:rgba(15,21,32,.78); --line:#1b2534; --line-soft:rgba(27,37,52,.6);
    --ink:#e9eff7; --dim:#7c8aa0; --faint:#55637a; --green:#2ee59d; --amber:#f0b429; --cyan:#38d5e8;
    --mono:"SFMono-Regular",Consolas,Menlo,monospace; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--ink);min-height:100vh;display:flex;
    font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  aside{width:210px;flex:none;border-right:1px solid var(--line);background:rgba(7,12,20,.85);
    padding:22px 14px;display:flex;flex-direction:column;gap:4px;position:sticky;top:0;height:100vh}
  .logo{display:flex;align-items:center;gap:10px;padding:0 8px 18px;border-bottom:1px solid var(--line);margin-bottom:12px}
  .logo .mark{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;
    background:linear-gradient(135deg,rgba(46,229,157,.22),rgba(79,163,255,.16));
    border:1px solid rgba(46,229,157,.42);color:var(--green);font-family:var(--mono);font-weight:700}
  .logo .t{font-size:13.5px;font-weight:650}
  .logo .t span{color:var(--green);font-family:var(--mono);font-size:9.5px;display:block;letter-spacing:.14em}
  .nav-item{display:block;padding:9px 12px;border-radius:8px;font-size:12.5px;color:var(--dim);
    cursor:pointer;text-decoration:none;font-family:var(--mono)}
  .nav-item.on{background:rgba(46,229,157,.08);color:var(--green)}
  .demo{margin-top:auto;font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--amber);
    border:1px solid rgba(240,180,41,.4);border-radius:6px;padding:6px 10px;text-align:center}
  main{flex:1;padding:24px 32px 60px;min-width:0}
  .top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:18px}
  .top h1{font-size:19px;font-weight:650}
  .top h1 small{font-family:var(--mono);font-size:10.5px;color:var(--faint);margin-left:8px}
  .conn{font-family:var(--mono);font-size:11px;color:var(--dim);display:inline-flex;align-items:center;gap:6px}
  .conn i{width:8px;height:8px;border-radius:50%;background:#ff5c6c}
  .conn.ok i{background:var(--green);box-shadow:0 0 8px rgba(46,229,157,.5)}
  .kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px 16px;
    display:inline-block;min-width:150px;margin-bottom:16px;position:relative;overflow:hidden}
  .kpi::after{content:"";position:absolute;inset:auto 0 0 0;height:2px;background:linear-gradient(90deg,var(--green),transparent)}
  .kpi .l{font-size:10px;letter-spacing:.16em;color:var(--dim);text-transform:uppercase}
  .kpi .n{font-family:var(--mono);font-size:28px;font-weight:600;font-variant-numeric:tabular-nums}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:auto}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--faint);
    font-weight:500;text-transform:uppercase;padding:11px 13px;border-bottom:1px solid var(--line);white-space:nowrap}
  td{padding:10px 13px;border-bottom:1px solid var(--line-soft);color:var(--dim);font-family:var(--mono);font-size:11.5px}
  .empty{padding:38px;text-align:center;color:var(--faint);font-size:13px}
  .foot{margin-top:16px;font-family:var(--mono);font-size:10.5px;color:var(--faint)}
  .foot code{color:var(--cyan)}
</style>
</head>
<body>
<aside>
  <div class="logo"><div class="mark">D</div><div class="t">管理控制台<span>AI-NATIVE DAM · GENERATED</span></div></div>
${views}
  <div class="demo">GENERATED SYSTEM</div>
</aside>
<main>
  <div class="top">
    <h1 id="title">${first}<small>GET /${first}</small></h1>
    <span class="conn" id="conn"><i></i><span id="connText">连接中…</span></span>
  </div>
  <div class="kpi"><div class="l">记录总数</div><div class="n" id="kTotal">–</div></div>
  <div class="panel" id="panel"><div class="empty">加载中…</div></div>
  <div class="foot">数据接口：<code id="apiPath">/${first}</code> · 30s 自动刷新 · 界面由 DAM 编译器确定性生成（未经 LLM）</div>
</main>
<script>
(function(){
  var current = '${first}';
  function esc(s){ return String(s).replace(/[&<>]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }
  function setConn(ok, t){
    document.getElementById('conn').className = 'conn' + (ok ? ' ok' : '');
    document.getElementById('connText').textContent = t;
  }
  async function load(){
    try{
      var r = await fetch('/' + current);
      if(!r.ok) throw new Error('HTTP ' + r.status);
      var data = await r.json();
      var rows = Array.isArray(r) ? r : (Array.isArray(data) ? data : []);
      setConn(true, 'API 在线');
      document.getElementById('kTotal').textContent = rows.length;
      var panel = document.getElementById('panel');
      if(!rows.length){ panel.innerHTML = '<div class="empty">暂无记录</div>'; return; }
      var cols = [];
      rows.forEach(function(row){ Object.keys(row).forEach(function(k){ if(cols.indexOf(k)<0) cols.push(k); }); });
      var html = '<table><thead><tr>' + cols.map(function(c){ return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
      rows.forEach(function(row){
        html += '<tr>' + cols.map(function(c){ return '<td>' + esc(row[c] == null ? '' : row[c]) + '</td>'; }).join('') + '</tr>';
      });
      panel.innerHTML = html + '</tbody></table>';
    }catch(e){
      setConn(false, 'API 离线');
      document.getElementById('panel').innerHTML = '<div class="empty">接口暂不可用：' + esc(e.message) + '</div>';
    }
  }
  Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function(a){
    a.addEventListener('click', function(ev){
      ev.preventDefault();
      Array.prototype.forEach.call(document.querySelectorAll('.nav-item'), function(x){ x.classList.remove('on'); });
      a.classList.add('on');
      current = a.dataset.view;
      document.getElementById('title').innerHTML = esc(current) + '<small>GET /' + esc(current) + '</small>';
      document.getElementById('apiPath').textContent = '/' + current;
      load();
    });
  });
  load();
  setInterval(load, 30000);
})();
</script>
</body>
</html>
`;
}

const HEADER_COMMENT = `// Deterministic file — generated by the DAM compiler, never by an LLM.`;

/** Files whose content is a pure function of the blueprint. */
const DETERMINISTIC_FILES: Readonly<Record<string, (blueprint: Blueprint) => string>> = {
  'dam.manifest.yaml': (bp) => generateManifest(bp),
  'tsconfig.json': () => generateTsconfig(),
  'src/contract.ts': () => generateContract(),
  'src/schema.ts': (bp) => generateSchema(bp),
  'src/server.ts': (bp) => generateServer(bp),
  'console/index.html': (bp) => generateConsole(bp),
};

/** True when the path is deterministic infrastructure, never LLM output. */
export function isDeterministicPath(path: string): boolean {
  return path in DETERMINISTIC_FILES;
}

/**
 * Execute a blueprint's prompt plan sequentially, in plan order (parallel
 * compile queues are an ADR 0010 Deferred item). Completer errors —
 * including budget breakers — propagate to the caller unchanged.
 */
export async function executeBlueprint(
  blueprint: Blueprint,
  options: ExecuteOptions,
): Promise<CompiledBuild> {
  const promptFor = options.promptFor ?? defaultPrompt;
  const files: GeneratedFile[] = [];
  let review = '';

  for (const item of blueprint.promptPlan) {
    const deterministic = DETERMINISTIC_FILES[item.file];
    if (deterministic) {
      // Deterministic by construction; the LLM is never asked for these.
      files.push({
        path: item.file,
        content: deterministic(blueprint),
        tier: item.tier,
        promptSummary: item.promptSummary,
      });
      continue;
    }
    const result = await options.completer.complete({
      runId: options.runId,
      tier: item.tier,
      promptSummary: item.promptSummary,
      prompt: promptFor(item, blueprint),
    });
    if (item.file === '(review)') {
      review = result.text;
      continue;
    }
    files.push({ path: item.file, content: stripCodeFences(result.text, item.file), tier: item.tier, promptSummary: item.promptSummary });
  }

  return { blueprintRef: blueprint.id, files, manifest: generateManifest(blueprint), review };
}

/**
 * Models habitually wrap code in markdown fences despite "output ONLY the
 * raw file content" — a fence line is a syntax error in the generated file
 * (caught by the executable sandbox). Two real observed shapes are handled:
 *  1. the whole body wrapped in a ``` fence;
 *  2. a leading line echoing the file path, then a fence around the rest.
 * Partial fences and anything else are left untouched so real content is
 * never mangled.
 */
export function stripCodeFences(text: string, filePath?: string): string {
  let body = text;
  if (filePath) {
    const nl = body.indexOf('\n');
    if (nl > 0 && body.slice(0, nl).trim() === filePath) body = body.slice(nl + 1);
  }
  const match = body.trim().match(/^```[a-zA-Z0-9+-]*\r?\n([\s\S]*?)\r?\n?```\s*$/);
  return match ? `${match[1]}\n` : body;
}

/** Shape the verify gate consumes (paths + manifest contents). */
export function toBuildOutput(build: CompiledBuild): BuildOutput {
  return { files: build.files.map((f) => f.path), manifest: build.manifest };
}
