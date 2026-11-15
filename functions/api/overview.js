// Read-only governance overview endpoint for Cloudflare Pages.
// Serves the latest snapshot synced from the DAM gateway's GET /overview
// by scripts/sync-overview-snapshot.mjs. Aggregates only — no secrets.

import snapshot from '../data/overview.json';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export function onRequestGet() {
  return new Response(JSON.stringify(snapshot), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      ...CORS
    }
  });
}
