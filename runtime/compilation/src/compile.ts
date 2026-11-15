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
 * Three plan items are special-cased by construction:
 *  - `dam.manifest.yaml` is NEVER LLM-generated: its content is the
 *    deterministic `generateManifest(blueprint)` output.
 *  - `tsconfig.json` is NEVER LLM-generated either: it is stack-determined
 *    infrastructure (`generateTsconfig()`).
 *  - the `(review)` item runs the C3 cross-module consistency pass; its
 *    result is returned as review notes, not written as a file.
 */

import type { Blueprint, PromptPlanItem, PromptTier } from './blueprint.js';
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
    'prepare().all() returns Record<string, SQLOutputValue>[] — map rows field by field (String(row.id), Number(row.x)) into your types; NEVER cast with `as` — tsc strict rejects the cast.',
  ].join(' ');
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
        outDir: 'dist',
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
 * Execute a blueprint's prompt plan sequentially, in plan order (parallel
 * compile queues are an ADR 0010 Deferred item). Completer errors —
 * including budget breakers — propagate to the caller unchanged.
 */
export async function executeBlueprint(
  blueprint: Blueprint,
  options: ExecuteOptions,
): Promise<CompiledBuild> {
  const promptFor = options.promptFor ?? defaultPrompt;
  const manifest = generateManifest(blueprint);
  const files: GeneratedFile[] = [];
  let review = '';

  for (const item of blueprint.promptPlan) {
    if (item.file === 'dam.manifest.yaml' || item.file === 'tsconfig.json') {
      // Deterministic by construction; the LLM is never asked for either.
      files.push({
        path: item.file,
        content: item.file === 'dam.manifest.yaml' ? manifest : generateTsconfig(),
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

  return { blueprintRef: blueprint.id, files, manifest, review };
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
