/**
 * Builder Runtime orchestrator (ADR 0010).
 *
 * Drives the run state machine from an approved System Spec to a gated
 * registration request. The orchestrator is the ONLY Builder Runtime
 * component that talks to the governance plane, and only through the
 * whitelisted McpClient. It holds no approval logic of its own: the run
 * pauses at `awaiting_registration` until a human confirms out of band.
 *
 * Not included yet (per ADR 0010 Deferred): the compilation pipeline itself
 * and the model router. `completeCompilation` / `requestRegistration` are
 * the seams where those plug in.
 */

import { randomUUID } from 'node:crypto';
import type { SystemSpec } from '@ai-native-dam/shared-schema';
import {
  executeBlueprint,
  planBlueprint,
  toBuildOutput,
  verifyBuild,
  type Blueprint,
  type BlueprintCompleter,
  type BuildOutput,
  type CompiledBuild,
  type VerifyReport,
} from '@ai-native-dam/runtime-compilation';
import { ToolRejectedError, type McpClient } from './mcp-client.js';
import { assertTransition, RunStore, type BuildRun, type PendingRegistration } from './run.js';

/** Verification gate failure: carries the deterministic report for review. */
export class VerificationFailedError extends Error {
  constructor(public readonly report: VerifyReport) {
    const failed = report.checks.filter((c) => !c.ok).map((c) => c.name);
    super(`verify-before-register failed: ${failed.join(', ')}`);
    this.name = 'VerificationFailedError';
  }
}

export interface SpecSummary {
  readonly id: string;
  readonly title: string;
  readonly businessDomain: string;
}

export interface RegistrationRequest extends PendingRegistration {
  /**
   * The generated build to verify (file list + manifest contents).
   * Optional when the run was compiled in-process via `compile()` — the
   * stored CompiledBuild is verified instead.
   */
  readonly build?: BuildOutput;
}

interface SpecsPage {
  specs?: Array<Record<string, unknown>>;
}

interface RegisterResult {
  system?: { id?: string };
}

/** The gateway speaks snake_case on the wire; map back to the domain type. */
function wireToSpec(raw: Record<string, unknown>): SystemSpec {
  return {
    id: raw.id as string,
    title: raw.title as string,
    businessDomain: (raw.business_domain ?? raw.businessDomain) as string,
    requirements: raw.requirements as string,
    entities: (raw.entities ?? []) as SystemSpec['entities'],
    workflows: (raw.workflows ?? []) as string[],
    sourceSkillIds: (raw.source_skill_ids ?? raw.sourceSkillIds ?? []) as string[],
    sourceKnowledgeIds: (raw.source_knowledge_ids ?? raw.sourceKnowledgeIds ?? []) as string[],
    status: raw.status as SystemSpec['status'],
    createdAt: (raw.created_at ?? raw.createdAt) as string,
    approvedAt: (raw.approved_at ?? raw.approvedAt ?? null) as string | null,
    approvedBy: (raw.approved_by ?? raw.approvedBy ?? null) as string | null,
  };
}

export class Orchestrator {
  /** Run-local blueprint registry: blueprint id → plan (ADR 0010 §2, not governed). */
  private readonly blueprints = new Map<string, Blueprint>();
  /** Run-local verify reports: run id → deterministic gate report. */
  private readonly verifyReports = new Map<string, VerifyReport>();
  /** Run-local compiled builds: run id → generated code tree (in-memory). */
  private readonly builds = new Map<string, CompiledBuild>();

  constructor(
    private readonly client: McpClient,
    private readonly runs: RunStore = new RunStore(),
  ) {}

  get runStore(): RunStore {
    return this.runs;
  }

  /** Approved specs that have no active run — the compilable work queue. */
  async discoverWork(): Promise<SpecSummary[]> {
    const page = (await this.client.call('search_specs', { status: 'approved', limit: 50 })) as SpecsPage;
    return (page.specs ?? [])
      .filter((s) => !this.runs.activeForSpec(s.id as string))
      .map((s) => ({
        id: s.id as string,
        title: (s.title as string) ?? '',
        businessDomain: (s.business_domain as string) ?? '',
      }));
  }

  /** The Blueprint planned for a run (undefined until startRun completes). */
  getBlueprint(runId: string): Blueprint | undefined {
    const ref = this.runs.get(runId)?.blueprintRef;
    return ref ? this.blueprints.get(ref) : undefined;
  }

  /** The verify-before-register report for a run (undefined until the gate ran). */
  getVerifyReport(runId: string): VerifyReport | undefined {
    return this.verifyReports.get(runId);
  }

  private async fetchSpec(specId: string): Promise<SystemSpec> {
    const page = (await this.client.call('search_specs', { limit: 50 })) as SpecsPage;
    const raw = (page.specs ?? []).find((s) => s.id === specId);
    if (!raw) throw new Error(`spec ${specId} not found on the governance plane`);
    return wireToSpec(raw);
  }

  /**
   * Open a run for an approved spec: fetch it from the governance plane,
   * plan the deterministic Blueprint (compilation package), and enter
   * `compiling`. Only approved specs compile (ADR 0007/0010) — the gateway
   * remains the source of truth and re-checks at registration.
   */
  async startRun(specId: string): Promise<BuildRun> {
    const active = this.runs.activeForSpec(specId);
    if (active) {
      throw new Error(`spec ${specId} already has an active run (${active.id}, ${active.state})`);
    }
    const spec = await this.fetchSpec(specId);
    if (spec.status !== 'approved') {
      throw new Error(`spec ${specId} has status ${spec.status}; only approved specs enter the Builder Runtime`);
    }
    const blueprint = planBlueprint(spec);
    this.blueprints.set(blueprint.id, blueprint);
    const run = this.runs.create(`run-${randomUUID()}`, specId);
    return this.runs.advance(run.id, 'compiling', { blueprintRef: blueprint.id });
  }

  /** Compilation finished: record the generated-code pointer and enter `verifying`. */
  completeCompilation(runId: string, buildRef: string): BuildRun {
    return this.runs.advance(runId, 'verifying', { buildRef });
  }

  /**
   * In-process compilation (ADR 0010 §7): execute the run's Blueprint prompt
   * plan through the injected completer (in production: the model-router, so
   * every call is recorded and budget-guarded), store the build run-locally,
   * and enter `verifying`. Completer failures — including budget breakers —
   * fail the run with zero governance-plane writes.
   */
  async compile(runId: string, completer: BlueprintCompleter): Promise<BuildRun> {
    const run = this.mustGet(runId);
    assertTransition(run, 'verifying'); // legal only from `compiling`
    const blueprint = run.blueprintRef ? this.blueprints.get(run.blueprintRef) : undefined;
    if (!blueprint) {
      this.runs.advance(runId, 'failed', { error: 'no blueprint recorded for this run' });
      throw new Error(`run ${runId} has no blueprint to compile`);
    }
    try {
      const build = await executeBlueprint(blueprint, { runId, completer });
      this.builds.set(runId, build);
      return this.runs.advance(runId, 'verifying', { buildRef: `build://${runId}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.runs.advance(runId, 'failed', { error: `compilation failed: ${message}` });
      throw err;
    }
  }

  /** The compiled build for a run (undefined until `compile` completes). */
  getBuild(runId: string): CompiledBuild | undefined {
    return this.builds.get(runId);
  }

  /**
   * Verification gate + registration request (ADR 0010 §4).
   *
   * The deterministic build is verified against its Blueprint BEFORE the
   * gateway is touched: a failed gate fails the run and never reaches the
   * governance plane. On pass, the tool is high-risk gated, so this normally
   * ends at `awaiting_registration` holding the confirmation token — the
   * human decision happens before `confirmRegistration`.
   */
  async requestRegistration(runId: string, request: RegistrationRequest): Promise<BuildRun> {
    const run = this.mustGet(runId);
    // Validate the transition before touching the gateway — no side effects
    // from an illegal state.
    assertTransition(run, 'awaiting_registration');
    const blueprint = run.blueprintRef ? this.blueprints.get(run.blueprintRef) : undefined;
    if (!blueprint) {
      const failedRun = this.runs.advance(runId, 'failed', {
        error: 'no blueprint recorded for this run — cannot verify the build',
      });
      throw new Error(`run ${runId} has no blueprint to verify against (state ${failedRun.state})`);
    }
    // Resolve the build: explicit request payload wins; otherwise the build
    // compiled in-process via `compile()` is verified.
    const stored = this.builds.get(runId);
    const build: BuildOutput | undefined = request.build ?? (stored ? toBuildOutput(stored) : undefined);
    if (!build) {
      this.runs.advance(runId, 'failed', {
        error: 'no build to verify — call compile() first or pass request.build',
      });
      throw new Error(`run ${runId} has no build to verify`);
    }
    // Verify-before-register: the deterministic gate decides, not the caller.
    const report = verifyBuild(blueprint, build);
    if (!report.ok) {
      const failed = report.checks.filter((c) => !c.ok).map((c) => c.name);
      this.runs.advance(runId, 'failed', { error: `verification failed: ${failed.join(', ')}` });
      throw new VerificationFailedError(report);
    }
    const verifyReportRef = `verify://${runId}`;
    this.verifyReports.set(runId, report);

    const args: Record<string, unknown> = {
      source_spec_id: run.specId,
      name: request.name,
      version: request.version,
    };
    if (request.endpointUri) args.endpoint_uri = request.endpointUri;

    const begin = await this.client.beginGated('register_generated_system', args);
    if (begin.executed) {
      // Defensive: the tool is documented as always gated; accept an immediate
      // execution if a future gateway auto-approves this principal. Walk the
      // state machine through both hops so the log stays truthful.
      const systemId = (begin.result as RegisterResult).system?.id ?? null;
      this.runs.advance(runId, 'awaiting_registration', { verifyReportRef });
      return this.runs.advance(runId, 'registered', { systemId });
    }
    return this.runs.advance(runId, 'awaiting_registration', {
      verifyReportRef,
      pendingConfirmation: begin.challenge.confirmationToken,
      pendingRegistration: {
        name: request.name,
        version: request.version,
        endpointUri: request.endpointUri,
      },
    });
  }

  /** Human approved: quote the stored token back and close the run as registered. */
  async confirmRegistration(runId: string): Promise<BuildRun> {
    const run = this.mustGet(runId);
    // Validate the transition before touching the gateway — no side effects
    // from an illegal state.
    assertTransition(run, 'registered');
    if (!run.pendingConfirmation || !run.pendingRegistration) {
      throw new Error(`run ${runId} holds no pending registration (state ${run.state})`);
    }
    const args: Record<string, unknown> = {
      source_spec_id: run.specId,
      name: run.pendingRegistration.name,
      version: run.pendingRegistration.version,
    };
    if (run.pendingRegistration.endpointUri) args.endpoint_uri = run.pendingRegistration.endpointUri;

    try {
      const result = (await this.client.confirmGated(
        'register_generated_system',
        args,
        run.pendingConfirmation,
      )) as RegisterResult;
      return this.runs.advance(runId, 'registered', {
        systemId: result.system?.id ?? null,
        pendingConfirmation: null,
        pendingRegistration: null,
      });
    } catch (err) {
      if (err instanceof ToolRejectedError) {
        // Human-facing gate said no (or spec state moved): close the run failed.
        this.runs.advance(runId, 'failed', {
          error: `registration rejected: ${err.reason}`,
          pendingConfirmation: null,
          pendingRegistration: null,
        });
      }
      throw err;
    }
  }

  /** Fail a run from any non-terminal state. */
  fail(runId: string, reason: string): BuildRun {
    return this.runs.advance(runId, 'failed', { error: reason });
  }

  private mustGet(runId: string): BuildRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`run ${runId} does not exist`);
    return run;
  }
}
