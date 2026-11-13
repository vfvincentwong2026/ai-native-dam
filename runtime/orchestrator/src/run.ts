/**
 * Build run state machine (ADR 0010 §7).
 *
 *   queued → compiling → verifying → awaiting_registration → registered
 *      └────────────── any non-terminal state ──────────────┴→ failed
 *
 * Runs are execution-plane-local entities, not governed assets; the run id
 * and verify summary join the registration context so the traceability chain
 * System → Run → Blueprint → Spec stays intact. Failed runs are terminal;
 * recompiling the same spec starts a NEW run (idempotent, run-local).
 */

export const RUN_STATES = [
  'queued',
  'compiling',
  'verifying',
  'awaiting_registration',
  'registered',
  'failed',
] as const;
export type RunState = (typeof RUN_STATES)[number];

export interface BuildRun {
  readonly id: string;
  readonly specId: string;
  readonly state: RunState;
  /** Run-local pointer (path or hash) to the Blueprint produced by compilation. */
  readonly blueprintRef: string | null;
  /** Run-local pointer to the generated code tree (set when compilation finishes). */
  readonly buildRef: string | null;
  /** Run-local pointer to the verify-before-register report. */
  readonly verifyReportRef: string | null;
  /** Confirmation token held while awaiting the human register decision. */
  readonly pendingConfirmation: string | null;
  /** Registration arguments remembered between the gated challenge and confirmation. */
  readonly pendingRegistration: PendingRegistration | null;
  /** Governed system id once register_generated_system succeeds. */
  readonly systemId: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PendingRegistration {
  readonly name: string;
  readonly version: string;
  readonly endpointUri?: string;
}

const TRANSITIONS: Record<RunState, readonly RunState[]> = {
  queued: ['compiling', 'failed'],
  compiling: ['verifying', 'failed'],
  verifying: ['awaiting_registration', 'failed'],
  awaiting_registration: ['registered', 'failed'],
  registered: [],
  failed: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly runId: string,
    public readonly from: RunState,
    public readonly to: RunState,
  ) {
    super(`run ${runId}: invalid transition ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(run: BuildRun, to: RunState): void {
  if (!TRANSITIONS[run.state].includes(to)) {
    throw new InvalidTransitionError(run.id, run.state, to);
  }
}

/** In-memory run store. Persistence is a deliberate non-goal for the skeleton. */
export class RunStore {
  private readonly runs = new Map<string, BuildRun>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  create(id: string, specId: string): BuildRun {
    const ts = this.now().toISOString();
    const run: BuildRun = {
      id,
      specId,
      state: 'queued',
      blueprintRef: null,
      buildRef: null,
      verifyReportRef: null,
      pendingConfirmation: null,
      pendingRegistration: null,
      systemId: null,
      error: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.runs.set(id, run);
    return run;
  }

  get(id: string): BuildRun | undefined {
    return this.runs.get(id);
  }

  /** Apply a state transition with optimistic field updates; throws on illegal moves. */
  advance(id: string, to: RunState, patch: Partial<Omit<BuildRun, 'id' | 'state' | 'createdAt' | 'updatedAt'>> = {}): BuildRun {
    const run = this.runs.get(id);
    if (!run) throw new Error(`run ${id} does not exist`);
    assertTransition(run, to);
    const next: BuildRun = { ...run, ...patch, state: to, updatedAt: this.now().toISOString() };
    this.runs.set(id, next);
    return next;
  }

  list(): BuildRun[] {
    return [...this.runs.values()];
  }

  /** Active (non-terminal) run for a spec, if any — used to dedupe discovery. */
  activeForSpec(specId: string): BuildRun | undefined {
    return this.list().find((r) => r.specId === specId && r.state !== 'registered' && r.state !== 'failed');
  }
}
