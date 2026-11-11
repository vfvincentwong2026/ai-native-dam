/**
 * Wire-format translation. The canonical MCP contract (docs/mcp-tools.md) is
 * snake_case on the wire; internal TypeScript types are camelCase. The gateway
 * translates at the boundary so neither side leaks into the other.
 */

function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function camelToSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

function mapKeys(value: unknown, map: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map(v => mapKeys(v, map));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[map(k)] = mapKeys(v, map);
    }
    return out;
  }
  return value;
}

/** Incoming wire arguments (snake_case) → internal camelCase. */
export function wireToInternal<T = unknown>(value: unknown): T {
  return mapKeys(value, snakeToCamelKey) as T;
}

/** Outgoing internal result (camelCase) → wire snake_case. */
export function internalToWire(value: unknown): unknown {
  return mapKeys(value, camelToSnakeKey);
}
