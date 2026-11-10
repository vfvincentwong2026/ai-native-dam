/**
 * Builder Runtime — orchestrator skeleton.
 *
 * Phase 2 responsibility: drive the Spec-first generation loop.
 * This file defines the contract only; no LLM calls, no MCP transport yet.
 */

import type {
  GenerateSystemSpecInput,
  GenerateSystemSpecOutput,
} from '@ai-native-dam/shared-schema';

export interface OrchestratorContext {
  readonly damMcpUrl: string;
  readonly damToken: string;
  readonly routerBaseUrl: string;
}

export interface Orchestrator {
  generateSystemSpec(
    input: GenerateSystemSpecInput,
    ctx: OrchestratorContext,
  ): Promise<GenerateSystemSpecOutput>;
}

export const PHASE_2_NOTE =
  'Orchestrator implementation lands in Phase 2. ' +
  'It must call the governance plane via MCP — never write directly.';
