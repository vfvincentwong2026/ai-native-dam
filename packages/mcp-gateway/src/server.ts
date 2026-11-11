import http from 'node:http';
import { resolvePrincipal, hasAnyScope, type TokenMap, type Principal } from './auth.js';
import { ApprovalGate, InMemoryApprovalStore } from './approval.js';
import { MemorySkillStore, type SkillStore } from './skill-store.js';
import { createState, type GatewayState, type StateSeed } from './state.js';
import { GATEWAY_TOOLS, findGatewayTool, ToolRejection } from './tools.js';
import { wireToInternal, internalToWire } from './wire.js';

export const MCP_PROTOCOL_VERSION = '2024-11-05';

/** Deprecated tool names still accepted on the wire; tools/list only shows canonical names. */
export const DEPRECATED_TOOL_ALIASES: Record<string, string> = {
  check_use: 'check_usage_rights',
};

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export interface GatewayOptions {
  tokens: TokenMap;
  seed?: StateSeed;
  /** Skill Registry persistence. Defaults to an in-memory store over state.skills. */
  skillStore?: SkillStore;
  approvalTtlMs?: number;
  serverName?: string;
  serverVersion?: string;
}

export interface Gateway {
  server: http.Server;
  state: GatewayState;
  skillStore: SkillStore;
  gate: ApprovalGate;
}

interface RpcPayload {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

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

export function createGateway(options: GatewayOptions): Gateway {
  const state = createState(options.seed);
  const skillStore = options.skillStore ?? new MemorySkillStore(state.skills);
  const gate = new ApprovalGate(new InMemoryApprovalStore(), options.approvalTtlMs);
  const serverName = options.serverName ?? 'ai-native-dam-gateway';
  const serverVersion = options.serverVersion ?? '0.1.0';

  async function handleRpc(payload: RpcPayload, principal: Principal): Promise<unknown> {
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
          const check = gate.require(
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
          const result = await tool.handler(parsed.data as never, { state, skillStore, principal });
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
  }

  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      send(200, { ok: true, server: serverName, version: serverVersion });
      return;
    }

    if (req.method !== 'POST') {
      send(405, { error: 'Method not allowed' });
      return;
    }

    const principal = resolvePrincipal(req.headers.authorization, options.tokens);
    if (!principal) {
      send(401, rpcError(null, -32001, 'Unauthorized: missing or invalid bearer token'));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      let payload: RpcPayload;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RpcPayload;
      } catch {
        send(400, rpcError(null, -32700, 'Parse error'));
        return;
      }
      try {
        const response = await handleRpc(payload, principal);
        if (response === undefined) {
          res.writeHead(202, CORS);
          res.end();
          return;
        }
        send(200, response);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal error';
        send(200, rpcError(payload.id ?? null, -32603, message));
      }
    });
  });

  return { server, state, skillStore, gate };
}
