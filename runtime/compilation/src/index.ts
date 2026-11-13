/**
 * `runtime/compilation` — deterministic Spec → Blueprint planner (ADR 0010).
 * No LLM, no network, no clock: the same spec always yields the same
 * blueprint hash.
 */

export type {
  Blueprint,
  BlueprintFile,
  BlueprintModule,
  FileKind,
  ModuleKind,
  PromptPlanItem,
  PromptTier,
  StackChoice,
} from './blueprint.js';
export { kebab, planBlueprint } from './plan.js';
