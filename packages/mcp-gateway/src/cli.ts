/**
 * Standalone entrypoint for the MCP Gateway.
 *
 *   DAM_TOKENS='{"dev-token":{"id":"dev","scopes":["Suggest","Read","Edit"]}}' \
 *   MCP_PORT=8080 \
 *   pnpm --filter @ai-native-dam/mcp-gateway start
 *
 * When DAM_TOKENS is unset, a single development token `dev-token` with all
 * scopes is issued. Never run like this in production.
 */
import { createGateway } from './server.js';
import type { TokenMap } from './auth.js';

function loadTokens(): TokenMap {
  const raw = process.env.DAM_TOKENS;
  if (!raw) {
    console.warn('[gateway] DAM_TOKENS unset — issuing development token "dev-token" with all scopes');
    return { 'dev-token': { id: 'dev', scopes: ['Suggest', 'Read', 'Edit'] } };
  }
  return JSON.parse(raw) as TokenMap;
}

const port = Number(process.env.MCP_PORT ?? 8080);
const { server } = createGateway({ tokens: loadTokens() });

server.listen(port, () => {
  console.log(`[gateway] MCP endpoint listening on http://localhost:${port}/mcp`);
  console.log(`[gateway] Health check: http://localhost:${port}/health`);
});
