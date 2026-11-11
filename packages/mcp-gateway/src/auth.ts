import type { McpScope } from '@ai-native-dam/shared-schema';

/** An authenticated caller of the gateway. */
export interface Principal {
  id: string;
  scopes: McpScope[];
}

/**
 * Static token map. Key is the bearer token; value is the identity and the
 * scopes that identity holds. Loaded from the DAM_TOKENS env var (JSON).
 */
export type TokenMap = Record<string, { id: string; scopes: McpScope[] }>;

/**
 * Resolve an `Authorization: Bearer <token>` header to a Principal.
 * Returns null when the header is malformed or the token is unknown.
 */
export function resolvePrincipal(
  authorization: string | undefined,
  tokens: TokenMap,
): Principal | null {
  if (!authorization) return null;
  const space = authorization.indexOf(' ');
  if (space <= 0) return null;
  const scheme = authorization.slice(0, space).toLowerCase();
  const token = authorization.slice(space + 1).trim();
  if (scheme !== 'bearer' || !token) return null;
  const entry = tokens[token];
  if (!entry) return null;
  return { id: entry.id, scopes: entry.scopes };
}

/** True when the principal holds at least one of the tool's allowed scopes. */
export function hasAnyScope(principal: Principal, allowed: McpScope[]): boolean {
  return allowed.some(s => principal.scopes.includes(s));
}
