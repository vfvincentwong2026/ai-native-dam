/**
 * Transport-neutral JSON-RPC handler for the MCP Gateway.
 *
 * Extracted from server.ts so the same logic serves both the Node http
 * server (cli.ts / docker) and the Cloudflare Workers adapter (worker.ts)
 * without dragging `node:http` into the edge bundle.
 */
import { hasAnyScope, type Principal } from './auth.js';
import type { ApprovalGate } from './approval.js';
import type { GovernanceStore } from './governance-store.js';
import type { SkillStore } from './skill-store.js';
import type { GatewayState } from './state.js';
import { GATEWAY_TOOLS, findGatewayTool, ToolRejection } from './tools.js';
import { wireToInternal, internalToWire } from './wire.js';

export const MCP_PROTOCOL_VERSION = '2024-11-05';

/** Deprecated tool names still accepted on the wire; tools/list only shows canonical names. */
export const DEPRECATED_TOOL_ALIASES: Record<string, string> = {
  check_use: 'check_usage_rights',
};

export interface RpcPayload {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface RpcHandlerOptions {
  state: GatewayState;
  store: GovernanceStore;
  skillStore: SkillStore;
  gate: ApprovalGate;
  serverName?: string;
  serverVersion?: string;
  distillationThreshold?: number;
}

export type RpcHandler = (payload: RpcPayload, principal: Principal) => Promise<unknown>;

function rpcOk(id: RpcPayload['id'], result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function rpcError(id: RpcPayload['id'], code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function toolResult(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

export function createRpcHandler(options: RpcHandlerOptions): RpcHandler {
  const { state, store, skillStore, gate } = options;
  const serverName = options.serverName ?? 'ai-native-dam-gateway';
  const serverVersion = options.serverVersion ?? '0.1.0';

  return async function handleRpc(payload: RpcPayload, principal: Principal): Promise<unknown> {
    const { id, method, params } = payload;

    switch (method) {
      case 'initialize':
        return rpcOk(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: serverName, version: serverVersion },
        });

      case 'ping':
        return rpcOk(id, {});

      case 'tools/list': {
        const tools = GATEWAY_TOOLS.filter(t => hasAnyScope(principal, t.scopes)).map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        return rpcOk(id, { tools });
      }

      case 'tools/call': {
        const name = params?.name;
        const rawArgs = (params?.arguments ?? {}) as Record<string, unknown>;
        if (typeof name !== 'string') {
          return rpcError(id, -32602, 'Invalid params: name must be a string');
        }
        // Deprecated aliases keep working; the result is marked so clients migrate.
        const canonicalName = DEPRECATED_TOOL_ALIASES[name] ?? name;
        const deprecation =
          canonicalName === name ? {} : { deprecated_alias: name, use_instead: canonicalName };
        const tool = findGatewayTool(canonicalName);
        if (!tool) {
          return rpcError(id, -32601, `Unknown tool: ${name}`);
        }
        if (!hasAnyScope(principal, tool.scopes)) {
          return rpcError(id, -32003, `Forbidden: tool ${name} requires scope ${tool.scopes.join(' | ')}`);
        }

        // Approval gate: the wire repeats the exact same arguments plus `_confirmation`.
        const { _confirmation, ...wireArgs } = rawArgs;
        const args = wireToInternal<Record<string, unknown>>(wireArgs);

        if (tool.gated) {
          const check = await gate.require(
            tool.name,
            principal.id,
            wireArgs,
            typeof _confirmation === 'string' ? _confirmation : undefined,
          );
          if (check.status === 'invalid_token') {
            return rpcError(id, -32010, 'Invalid, expired, or already-used confirmation token');
          }
          if (check.status === 'confirmation_required') {
            return rpcOk(id, {
              ...toolResult({
                approval_required: true,
                tool: tool.name,
                risk_level: tool.riskLevel,
                confirmation_token: check.confirmationToken,
                expires_at: check.expiresAt,
                instructions:
                  'Repeat this tools/call with identical arguments plus "_confirmation": <token>.',
              }),
              ...deprecation,
            });
          }
        }

        const parsed = tool.schema.safeParse(args);
        if (!parsed.success) {
          return rpcError(id, -32602, 'Invalid tool arguments', parsed.error.issues);
        }

        try {
          const result = await tool.handler(parsed.data as never, {
            state, store, skillStore, principal,
            distillationThreshold: options.distillationThreshold ?? 20,
          });
          return rpcOk(id, { ...toolResult(internalToWire(result)), ...deprecation });
        } catch (err) {
          if (err instanceof ToolRejection) {
            return rpcOk(id, { ...toolResult({ rejected: true, reason: err.reason }, true), ...deprecation });
          }
          const message = err instanceof Error ? err.message : 'Internal error';
          return rpcError(id, -32603, message);
        }
      }

      default:
        if (method?.startsWith('notifications/')) {
          return undefined; // notifications carry no response
        }
        return rpcError(id, -32601, `Unknown method: ${String(method)}`);
    }
  };
}
