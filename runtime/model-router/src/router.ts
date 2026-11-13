/**
 * Model router (ADR 0010 §1/§6) — the ONLY egress for LLM calls in the
 * Builder Runtime.
 *
 * Responsibilities:
 *  - tier routing: every call declares an OpenSquilla C0–C3 tier, the router
 *    maps it to a concrete model (configurable; upgrades are config, not code)
 *  - run-local recording: every call lands a record (run / tier / model /
 *    prompt summary / tokens / outcome) for provenance and cost accounting
 *  - budget guardrail: per-run call/token budgets; a breach throws
 *    `BudgetExceededError` BEFORE the transport is touched, so the
 *    orchestrator can fail the run without burning another token
 *
 * The router holds no governance knowledge and no network code — both are
 * injected (`ModelTransport`).
 */

import type { ModelTier, ModelTransport, TransportResult } from './transport.js';

export interface TierModels {
  readonly C0: string;
  readonly C1: string;
  readonly C2: string;
  readonly C3: string;
}

/**
 * Placeholder defaults — real deployments override with the models their
 * SquillaRouter actually serves (cheap local tiers for C0/C1, strong
 * reasoning for C3, per ADR 0010 §6).
 */
export const DEFAULT_TIER_MODELS: TierModels = {
  C0: 'squilla-c0-default',
  C1: 'squilla-c1-default',
  C2: 'squilla-c2-default',
  C3: 'squilla-c3-default',
};

export interface CompleteRequest {
  /** Owning run; every record is namespaced by it. */
  readonly runId: string;
  readonly tier: ModelTier;
  /**
   * Deterministic summary of the prompt (from the Blueprint prompt plan) —
   * recorded for provenance; the full prompt itself is not stored.
   */
  readonly promptSummary: string;
  readonly prompt: string;
  readonly maxTokens?: number;
}

export interface CompleteResponse extends TransportResult {
  /** Tier the call was routed under. */
  readonly tier: ModelTier;
}

export interface CallRecord {
  readonly runId: string;
  readonly tier: ModelTier;
  /** Requested model (tier mapping) — see `model` for what actually served. */
  readonly requestedModel: string;
  readonly model: string;
  readonly promptSummary: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly ok: boolean;
  readonly error?: string;
}

export interface TierCost {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface CostSummary {
  readonly runId: string;
  readonly calls: number;
  readonly failedCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly byTier: Readonly<Partial<Record<ModelTier, TierCost>>>;
}

export interface RunBudget {
  /** Maximum completed-or-failed calls for one run. */
  readonly maxCalls?: number;
  /** Maximum total tokens (in+out) consumed by one run. */
  readonly maxTotalTokens?: number;
}

/** Budget breach: carries the summary at the moment the breaker tripped. */
export class BudgetExceededError extends Error {
  constructor(
    public readonly summary: CostSummary,
    public readonly limit: string,
  ) {
    super(`run ${summary.runId} exceeded its model budget (${limit})`);
    this.name = 'BudgetExceededError';
  }
}

export interface ModelRouterOptions {
  readonly transport: ModelTransport;
  readonly tierModels?: Partial<TierModels>;
  readonly budget?: RunBudget;
}

export class ModelRouter {
  private readonly transport: ModelTransport;
  private readonly tierModels: TierModels;
  private readonly budget: RunBudget;
  /** run-local ledger: run id → call records. */
  private readonly records = new Map<string, CallRecord[]>();

  constructor(options: ModelRouterOptions) {
    this.transport = options.transport;
    this.tierModels = { ...DEFAULT_TIER_MODELS, ...options.tierModels };
    this.budget = options.budget ?? {};
  }

  /** Route one completion through the tier map, record it, enforce budget. */
  async complete(request: CompleteRequest): Promise<CompleteResponse> {
    this.checkBudget(request.runId);
    const requestedModel = this.tierModels[request.tier];

    try {
      const result = await this.transport.complete({
        model: requestedModel,
        tier: request.tier,
        prompt: request.prompt,
        ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
      });
      this.record(request, requestedModel, result, undefined);
      return { ...result, tier: request.tier };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.record(
        request,
        requestedModel,
        { text: '', model: requestedModel, inputTokens: 0, outputTokens: 0 },
        message,
      );
      throw err;
    }
  }

  /** All records for a run (stable call order). */
  getRecords(runId: string): readonly CallRecord[] {
    return this.ledger(runId);
  }

  /** Cost rollup for a run — feeds the ADR 0010 §6 run-level budget report. */
  costSummary(runId: string): CostSummary {
    const byTier: Partial<Record<ModelTier, TierCost>> = {};
    let inputTokens = 0;
    let outputTokens = 0;
    let failedCalls = 0;
    for (const rec of this.ledger(runId)) {
      inputTokens += rec.inputTokens;
      outputTokens += rec.outputTokens;
      if (!rec.ok) failedCalls += 1;
      const tier = byTier[rec.tier] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
      byTier[rec.tier] = {
        calls: tier.calls + 1,
        inputTokens: tier.inputTokens + rec.inputTokens,
        outputTokens: tier.outputTokens + rec.outputTokens,
      };
    }
    return {
      runId,
      calls: this.ledger(runId).length,
      failedCalls,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      byTier,
    };
  }

  /**
   * Breaker check runs BEFORE the transport: a breached budget never costs
   * another token. Counts every recorded call (failures included — a run
   * that keeps failing must not retry forever).
   */
  private checkBudget(runId: string): void {
    const summary = this.costSummary(runId);
    if (this.budget.maxCalls !== undefined && summary.calls >= this.budget.maxCalls) {
      throw new BudgetExceededError(summary, `maxCalls=${this.budget.maxCalls}`);
    }
    if (
      this.budget.maxTotalTokens !== undefined &&
      summary.totalTokens >= this.budget.maxTotalTokens
    ) {
      throw new BudgetExceededError(summary, `maxTotalTokens=${this.budget.maxTotalTokens}`);
    }
  }

  private record(
    request: CompleteRequest,
    requestedModel: string,
    result: TransportResult,
    error: string | undefined,
  ): void {
    this.ledger(request.runId).push({
      runId: request.runId,
      tier: request.tier,
      requestedModel,
      model: result.model,
      promptSummary: request.promptSummary,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      ok: error === undefined,
      ...(error !== undefined ? { error } : {}),
    });
  }

  private ledger(runId: string): CallRecord[] {
    let list = this.records.get(runId);
    if (!list) {
      list = [];
      this.records.set(runId, list);
    }
    return list;
  }
}
