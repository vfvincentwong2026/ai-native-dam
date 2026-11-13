/**
 * MCP client for the DAM governance gateway (Streamable HTTP, JSON-RPC POST).
 *
 * ADR 0010 §5: the orchestrator may only touch a whitelist of tools —
 * reads (search_specs / search_skills / search_knowledge) and two gated
 * writes (register_generated_system, apply_skill). The whitelist is enforced
 * here, at the client, so no caller can accidentally widen the surface.
 *
 * Gated tools follow the gateway's two-call confirmation flow:
 * `beginGated` issues the first call and returns the challenge
 * (confirmation token); `confirmGated` quotes the token back. The human
 * decision point lives between those two calls — the client never
 * auto-confirms.
 */

/** Tools the Builder Runtime is allowed to call (ADR 0010 §5). */
export const ALLOWED_TOOLS = [
  'search_specs',
  'search_skills',
  'search_knowledge',
  'register_generated_system',
  'apply_skill',
] as const;
export type AllowedTool = (typeof ALLOWED_TOOLS)[number];

/** JSON-RPC / transport level failure (HTTP error, -32601, -32602, …). */
export class McpError extends Error {
  constructor(
    public readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/** Domain rejection from the gateway (result.isError, e.g. invalid_status_transition). */
export class ToolRejectedError extends Error {
  constructor(
    public readonly reason: string,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'ToolRejectedError';
  }
}

/** Challenge returned by the first call of a gated tool. */
export interface GatedChallenge {
  readonly confirmationToken: string;
  readonly riskLevel?: string;
}

export type GatedBegin =
  | { readonly executed: true; readonly result: unknown }
  | { readonly executed: false; readonly challenge: GatedChallenge };

export interface McpClientOptions {
  /** e.g. http://127.0.0.1:8080 (the /mcp path is appended). */
  readonly baseUrl: string;
  readonly token: string;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface McpClient {
  /** Call a whitelisted tool that must not be gated (reads). */
  call(tool: AllowedTool, args: Record<string, unknown>): Promise<unknown>;
  /** First step of a gated tool: returns either the challenge or the executed result. */
  beginGated(tool: AllowedTool, args: Record<string, unknown>): Promise<GatedBegin>;
  /** Second step: quote the challenge token back to execute the write. */
  confirmGated(tool: AllowedTool, args: Record<string, unknown>, token: string): Promise<unknown>;
}

function assertAllowed(tool: string): asserts tool is AllowedTool {
  if (!(ALLOWED_TOOLS as readonly string[]).includes(tool)) {
    throw new McpError(null, `tool '${tool}' is not on the Builder Runtime whitelist (ADR 0010 §5)`);
  }
}

export class HttpMcpClient implements McpClient {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private nextId = 1;

  constructor(options: McpClientOptions) {
    this.endpoint = `${options.baseUrl.replace(/\/+$/, '')}/mcp`;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  call(tool: AllowedTool, args: Record<string, unknown>): Promise<unknown> {
    return this.invoke(tool, args);
  }

  async beginGated(tool: AllowedTool, args: Record<string, unknown>): Promise<GatedBegin> {
    const payload = await this.invoke(tool, args);
    const challenge = payload as Record<string, unknown>;
    if (challenge.approval_required === true && typeof challenge.confirmation_token === 'string') {
      return {
        executed: false,
        challenge: {
          confirmationToken: challenge.confirmation_token,
          riskLevel: typeof challenge.risk_level === 'string' ? challenge.risk_level : undefined,
        },
      };
    }
    return { executed: true, result: payload };
  }

  confirmGated(tool: AllowedTool, args: Record<string, unknown>, token: string): Promise<unknown> {
    return this.invoke(tool, { ...args, _confirmation: token });
  }

  private async invoke(tool: AllowedTool, args: Record<string, unknown>): Promise<unknown> {
    assertAllowed(tool);
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      throw new McpError(null, `gateway HTTP ${res.status}`);
    }
    const body = (await res.json()) as Record<string, unknown>;
    const rpcError = body.error as { code?: number; message?: string } | undefined;
    if (rpcError) {
      throw new McpError(rpcError.code ?? null, rpcError.message ?? 'JSON-RPC error');
    }
    const result = body.result as Record<string, unknown> | undefined;
    const text = (result?.content as Array<{ text?: string }> | undefined)?.[0]?.text;
    if (typeof text !== 'string') {
      throw new McpError(null, `malformed tool response: ${JSON.stringify(body)}`);
    }
    const payload = JSON.parse(text) as Record<string, unknown>;
    if (result?.isError === true) {
      throw new ToolRejectedError(
        typeof payload.reason === 'string' ? payload.reason : 'rejected',
        typeof payload.message === 'string' ? payload.message : undefined,
      );
    }
    return payload;
  }
}
