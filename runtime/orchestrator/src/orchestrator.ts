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
import { ToolRejectedError, type McpClient } from './mcp-client.js';
import { assertTransition, RunStore, type BuildRun, type PendingRegistration } from './run.js';

export interface SpecSummary {
  readonly id: string;
  readonly title: string;
  readonly businessDomain: string;
}

export interface RegistrationRequest extends PendingRegistration {
  /** Pointer to the verify-before-register report (ADR 0010 §4). */
  readonly verifyReportRef: string;
}

interface SpecsPage {
  specs?: Array<{ id: string; title?: string; business_domain?: string }>;
}

interface RegisterResult {
  system?: { id?: string };
}

export class Orchestrator {
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
      .filter((s) => !this.runs.activeForSpec(s.id))
      .map((s) => ({ id: s.id, title: s.title ?? '', businessDomain: s.business_domain ?? '' }));
  }

  /** Open a run for a spec and enter `compiling`. Compilation itself plugs in here later. */
  async startRun(specId: string): Promise<BuildRun> {
    const active = this.runs.activeForSpec(specId);
    if (active) {
      throw new Error(`spec ${specId} already has an active run (${active.id}, ${active.state})`);
    }
    const run = this.runs.create(`run-${randomUUID()}`, specId);
    return this.runs.advance(run.id, 'compiling');
  }

  /** Compilation finished: record the Blueprint pointer and enter `verifying`. */
  completeCompilation(runId: string, blueprintRef: string): BuildRun {
    return this.runs.advance(runId, 'verifying', { blueprintRef });
  }

  /**
   * Verification passed: record the report and ask the gateway to register.
   * The tool is high-risk gated, so this normally ends at
   * `awaiting_registration` holding the confirmation token — the human
   * decision happens before `confirmRegistration`.
   */
  async requestRegistration(runId: string, request: RegistrationRequest): Promise<BuildRun> {
    const run = this.mustGet(runId);
    // Validate the transition before touching the gateway — no side effects
    // from an illegal state.
    assertTransition(run, 'awaiting_registration');
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
      this.runs.advance(runId, 'awaiting_registration', { verifyReportRef: request.verifyReportRef });
      return this.runs.advance(runId, 'registered', { systemId });
    }
    return this.runs.advance(runId, 'awaiting_registration', {
      verifyReportRef: request.verifyReportRef,
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
