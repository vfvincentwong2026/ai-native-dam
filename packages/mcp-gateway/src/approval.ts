import { createHash, randomUUID } from 'node:crypto';

/**
 * Two-call confirmation-token approval, the mcp-approval fallback semantics:
 *
 *  1. First call to a gated tool returns a random token bound to
 *     (principal, tool, exact arguments).
 *  2. The client repeats the identical call quoting the token back in
 *     `_confirmation`. Only then does the write execute.
 *
 * The token proves the same arguments were sent twice; when the MCP client
 * supports `elicitation`, a future version of this gate should ask the human
 * through the client instead. High-risk tools never skip this flow.
 */

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function approvalKey(toolName: string, principalId: string, args: unknown): string {
  const hash = createHash('sha256').update(stableStringify(args)).digest('hex');
  return `${principalId}:${toolName}:${hash}`;
}

export interface ApprovalEntry {
  key: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
}

export interface ApprovalStore {
  get(key: string): ApprovalEntry | undefined;
  put(entry: ApprovalEntry): void;
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly entries = new Map<string, ApprovalEntry>();

  get(key: string): ApprovalEntry | undefined {
    return this.entries.get(key);
  }

  put(entry: ApprovalEntry): void {
    this.entries.set(entry.key, entry);
  }
}

export type ApprovalCheck =
  | { status: 'approved' }
  | { status: 'confirmation_required'; confirmationToken: string; expiresAt: string }
  | { status: 'invalid_token' };

export class ApprovalGate {
  constructor(
    private readonly store: ApprovalStore = new InMemoryApprovalStore(),
    private readonly ttlMs: number = 5 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Check whether a gated call may proceed. Pass the raw tool arguments
   * (without `_confirmation`) and the quoted confirmation token, if any.
   */
  require(
    toolName: string,
    principalId: string,
    args: unknown,
    confirmationToken?: string,
  ): ApprovalCheck {
    const key = approvalKey(toolName, principalId, args);

    if (confirmationToken !== undefined) {
      const entry = this.store.get(key);
      const valid =
        entry !== undefined &&
        !entry.consumed &&
        entry.expiresAt > this.now() &&
        entry.token === confirmationToken;
      if (!valid) {
        return { status: 'invalid_token' };
      }
      this.store.put({ ...entry, consumed: true });
      return { status: 'approved' };
    }

    const now = this.now();
    const entry: ApprovalEntry = {
      key,
      token: randomUUID(),
      createdAt: now,
      expiresAt: now + this.ttlMs,
      consumed: false,
    };
    // Re-issuing overwrites any previous unconsumed token for the same call.
    this.store.put(entry);
    return {
      status: 'confirmation_required',
      confirmationToken: entry.token,
      expiresAt: new Date(entry.expiresAt).toISOString(),
    };
  }
}
