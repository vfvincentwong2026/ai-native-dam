// Read-only MCP endpoint for Cloudflare Pages.
// Exposes only `search_assets` and `check_use` against a static JSON snapshot.
// Full MCP with write tools lives on the Docker host; this is a public showcase.

import assets from './data/assets.json';

const MCP_PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'search_assets',
    description: 'Query a read-only snapshot of the AI-Native DAM asset catalog.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        channel: { type: 'string' },
        limit: { type: 'integer', default: 20 }
      },
      required: ['query']
    }
  },
  {
    name: 'check_use',
    description: 'Check whether an asset may be used on a channel. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        channel: { type: 'string' },
        territory: { type: 'string', default: 'CN' }
      },
      required: ['assetId', 'channel']
    }
  }
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

function rpcOk(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function handleToolCall(params) {
  const name = params?.name;
  const args = params?.arguments || {};

  if (name === 'search_assets') {
    const query = String(args.query || '').toLowerCase();
    const limit = Math.min(args.limit || 20, 50);
    const filtered = assets
      .filter(a => JSON.stringify(a).toLowerCase().includes(query))
      .slice(0, limit);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ assets: filtered, total: filtered.length })
      }]
    };
  }

  if (name === 'check_use') {
    const asset = assets.find(a => a.id === args.assetId);
    if (!asset) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ allowed: false, reason: 'asset_not_found', replacementId: null })
        }]
      };
    }
    const allowed = asset.rightsStatus === 'Cleared';
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          allowed,
          reason: allowed ? 'ok' : `rights_${asset.rightsStatus.toLowerCase()}`,
          replacementId: null
        })
      }]
    };
  }

  return null;
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, 'Parse error'));
  }

  const { id, method, params } = payload;

  try {
    if (method === 'initialize') {
      return jsonResponse(rpcOk(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-native-dam-showcase', version: '0.1.0' }
      }));
    }
    if (method === 'tools/list') {
      return jsonResponse(rpcOk(id, { tools: TOOLS }));
    }
    if (method === 'tools/call') {
      const result = handleToolCall(params);
      if (!result) {
        return jsonResponse(rpcError(id, -32601, `Unknown tool: ${params?.name}`));
      }
      return jsonResponse(rpcOk(id, result));
    }
    return jsonResponse(rpcError(id, -32601, `Unknown method: ${method}`));
  } catch (e) {
    return jsonResponse(rpcError(id, -32603, e.message || 'Internal error'));
  }
}
