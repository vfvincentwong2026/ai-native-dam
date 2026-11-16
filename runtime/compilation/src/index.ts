/**
 * `runtime/compilation` — deterministic Spec → Blueprint planner (ADR 0010).
 * No LLM, no network, no clock: the same spec always yields the same
 * blueprint hash.
 */

export type {
  Blueprint,
  BlueprintFile,
  BlueprintModule,
  EntityFieldSchema,
  EntityTableSchema,
  FileKind,
  ModuleKind,
  PromptPlanItem,
  PromptTier,
  StackChoice,
} from './blueprint.js';
export { kebab, planBlueprint, tableName } from './plan.js';
export { generateManifest, type ManifestOptions } from './manifest.js';
export { verifyBuild, type BuildOutput, type VerifyCheck, type VerifyReport } from './verify.js';
export {
  columnList,
  executeBlueprint,
  generateConsole,
  generateContract,
  generateSchema,
  generateServer,
  generateTsconfig,
  isDeterministicPath,
  storageNote,
  stripCodeFences,
  toBuildOutput,
  type BlueprintCompleter,
  type CompiledBuild,
  type ExecuteOptions,
  type GeneratedFile,
} from './compile.js';
export {
  DEFAULT_SANDBOX_COMMANDS,
  DockerSandboxRunner,
  LocalSandboxRunner,
  materializeBuild,
  systemSpawn,
  type DockerSandboxOptions,
  type LocalSandboxOptions,
  type SandboxCommands,
  type SandboxResult,
  type SandboxRunner,
  type SandboxStep,
  type SandboxStepName,
  type SandboxVerifyOptions,
  type SpawnImpl,
} from './sandbox.js';
