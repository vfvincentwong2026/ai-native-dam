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
 * Two plan items are special-cased by construction:
 *  - `dam.manifest.yaml` is NEVER LLM-generated: its content is the
 *    deterministic `generateManifest(blueprint)` output.
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
  const stack = `Stack: ${blueprint.stack.runtime} / ${blueprint.stack.framework} / ${blueprint.stack.storage}.`;
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
    `Output ONLY the file content, no commentary.`,
  ]
    .filter(Boolean)
    .join('\n\n');
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
    if (item.file === 'dam.manifest.yaml') {
      // Deterministic by construction; the LLM is never asked for it.
      files.push({
        path: item.file,
        content: manifest,
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
    files.push({ path: item.file, content: result.text, tier: item.tier, promptSummary: item.promptSummary });
  }

  return { blueprintRef: blueprint.id, files, manifest, review };
}

/** Shape the verify gate consumes (paths + manifest contents). */
export function toBuildOutput(build: CompiledBuild): BuildOutput {
  return { files: build.files.map((f) => f.path), manifest: build.manifest };
}
