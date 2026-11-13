/**
 * Blueprint types (ADR 0010 §2).
 *
 * A Blueprint is the run-local intermediate between an approved System Spec
 * and the generated code tree: stack choice, module breakdown, file manifest,
 * and the prompt plan that a later model-router pass would execute. It is a
 * PURE function of the spec — no timestamps, no randomness — so its content
 * hash is a stable identity: the same spec always compiles to the same
 * blueprint, which is what makes `blueprint_hash` meaningful as provenance.
 */

/** Model tier a file's generation would be routed to (OpenSquilla C0–C3). */
export type PromptTier = 'C0' | 'C1' | 'C2' | 'C3';

export interface StackChoice {
  readonly runtime: string;
  readonly framework: string;
  readonly storage: string;
  readonly rationale: string;
}

export type ModuleKind = 'core' | 'entity' | 'workflow';

export interface BlueprintModule {
  readonly name: string;
  readonly kind: ModuleKind;
  readonly purpose: string;
  readonly entityRefs: readonly string[];
  readonly workflowRefs: readonly string[];
}

export type FileKind =
  | 'manifest'
  | 'config'
  | 'health'
  | 'doc'
  | 'model'
  | 'route'
  | 'workflow'
  | 'test';

export interface BlueprintFile {
  readonly path: string;
  readonly kind: FileKind;
  /** Owning module name. */
  readonly module: string;
  readonly purpose: string;
  /** Tier the file's generation prompt would be routed to. */
  readonly tier: PromptTier;
}

export interface PromptPlanItem {
  /** File path, or '(review)' for the cross-module consistency pass. */
  readonly file: string;
  readonly tier: PromptTier;
  readonly promptSummary: string;
}

export interface Blueprint {
  /** `bp-<hash12>` — derived from content, not random. */
  readonly id: string;
  readonly specId: string;
  readonly stack: StackChoice;
  readonly modules: readonly BlueprintModule[];
  readonly files: readonly BlueprintFile[];
  readonly promptPlan: readonly PromptPlanItem[];
  /** Provenance denormalized from the source spec. */
  readonly provenance: {
    readonly sourceSkillIds: readonly string[];
    readonly sourceKnowledgeIds: readonly string[];
  };
  /** sha256 over the canonical content (everything except id/hash). */
  readonly hash: string;
}
