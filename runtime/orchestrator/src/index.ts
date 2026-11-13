/**
 * Builder Runtime — orchestrator package (ADR 0010).
 *
 * Public surface: the whitelisted MCP client, the run state machine, and
 * the Orchestrator driving approved specs to gated registration.
 */

export {
  ALLOWED_TOOLS,
  HttpMcpClient,
  McpError,
  ToolRejectedError,
  type AllowedTool,
  type GatedBegin,
  type GatedChallenge,
  type McpClient,
  type McpClientOptions,
} from './mcp-client.js';
export {
  InvalidTransitionError,
  RunStore,
  RUN_STATES,
  assertTransition,
  type BuildRun,
  type PendingRegistration,
  type RunState,
} from './run.js';
export {
  Orchestrator,
  VerificationFailedError,
  type RegistrationRequest,
  type SpecSummary,
} from './orchestrator.js';
