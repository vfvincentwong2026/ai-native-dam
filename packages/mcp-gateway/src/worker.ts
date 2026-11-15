/**
 * Cloudflare Workers adapter for the AI-Native-DAM MCP Gateway.
 *
 * Reuses the compiled gateway (dist/) — createRpcHandler, tools, approval
 * gate — and hosts it inside a single global Durable Object so the Skill
 * Registry (DO SQLite via DoSkillStore) and approval challenges stay
 * consistent worldwide.
 *
 * Deploy (from packages/mcp-gateway):
 *   pnpm build
 *   wrangler secret put DAM_TOKENS   # JSON token map
 *   wrangler deploy
 *
 * This file is intentionally loose-typed (workerd globals) and excluded from
 * `tsc -b`; wrangler bundles it with esbuild.
 */

import { createRpcHandler } from '../dist/rpc.js';
import { createState } from '../dist/state.js';
import { ApprovalGate } from '../dist/approval.js';
import { DoSkillStore } from '../dist/do-skill-store.js';
import { DoKnowledgeMap } from '../dist/do-knowledge-map.js';
import {
  DoApprovalStore,
  DoAssetsMap,
  DoRightsMap,
  DoUsageLog,
  DoSkillUsageLog,
} from '../dist/do-state-store.js';
import { resolvePrincipal } from '../dist/auth.js';
import { MemoryGovernanceStore } from '../dist/governance-store.js';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export class RegistryHub {
  private handler: ReturnType<typeof createRpcHandler>;
  private tokens: Record<string, { id: string; scopes: string[] }>;

  constructor(ctx: any, env: any) {
    const state = createState();
    state.knowledge = new DoKnowledgeMap(ctx.storage.sql);
    state.assets = new DoAssetsMap(ctx.storage.sql);
    state.rights = new DoRightsMap(ctx.storage.sql);
    state.usage = new DoUsageLog(ctx.storage.sql);
    state.skillUsage = new DoSkillUsageLog(ctx.storage.sql);
    const skillStore = new DoSkillStore(ctx.storage.sql);
    const gate = new ApprovalGate(new DoApprovalStore(ctx.storage.sql));
    // state.assets/rights/usage/knowledge are already DO-backed, so the
    // memory store over state is a full GovernanceStore on the edge too.
    const store = new MemoryGovernanceStore(state);
    this.handler = createRpcHandler({ state, store, skillStore, gate });
    this.tokens = JSON.parse(env.DAM_TOKENS ?? '{}');
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(undefined, { status: 204, headers: CORS });

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json(200, { ok: true, server: 'ai-native-dam-gateway', version: '0.1.0', runtime: 'workers+do' });
    }
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

    const principal = resolvePrincipal(request.headers.get('authorization') ?? undefined, this.tokens as any);
    if (!principal) {
      return json(401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: missing or invalid bearer token' } });
    }

    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    const response = await this.handler(payload, principal);
    if (response === undefined) return new Response(undefined, { status: 202, headers: CORS });
    return json(200, response);
  }
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const stub = env.REGISTRY_HUB.getByName('global');
    return stub.fetch(request);
  },
};
