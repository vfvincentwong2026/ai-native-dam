/**
 * `runtime/model-router` — OpenSquilla adapter, sole LLM egress (ADR 0010).
 *
 * Public surface: the injectable transport seam (`ModelTransport`,
 * `SquillaHttpTransport`) and the `ModelRouter` with tier routing, run-local
 * call records, cost rollups, and budget circuit-breaking.
 */

export {
  RouterTransportError,
  SquillaHttpTransport,
  type ModelTier,
  type ModelTransport,
  type SquillaHttpTransportOptions,
  type TransportCall,
  type TransportResult,
} from './transport.js';
export {
  BudgetExceededError,
  DEFAULT_TIER_MODELS,
  ModelRouter,
  type CallRecord,
  type CompleteRequest,
  type CompleteResponse,
  type CostSummary,
  type ModelRouterOptions,
  type RunBudget,
  type TierCost,
  type TierModels,
} from './router.js';
