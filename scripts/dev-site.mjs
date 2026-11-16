/**
 * Minimal static dev server for the Cloudflare Pages site (repo root).
 * `npm run dev` → serves . on PORT (default 7100); `--port`/`--host` CLI
 * args are forwarded so the preview harness can pick a free port.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = argIndex(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const argIndex = (name) => args.findIndex((a) => a === `--${name}`);
const port = Number(arg('port') ?? process.env.PORT ?? 7100);
const host = arg('host') ?? process.env.HOST ?? '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    // Same-origin proxy so the console UI can reach the locally running
    // generated system without CORS changes to the deterministic server.
    if (path.startsWith('/api/sys/')) {
      const upstream = await fetch(`http://localhost:3000${path.slice('/api/sys'.length)}`);
      const body = await upstream.text();
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
      res.end(body);
      return;
    }
    // Same-origin governance overview: proxy the live gateway with the
    // Read-scoped token (token stays server-side); fall back to the
    // committed snapshot when the gateway is not running locally.
    if (path === '/api/overview' || path === '/api/overview/') {
      let liveBody = null;
      try {
        const tokenMap = JSON.parse(await readFile(join(process.cwd(), '.review/service/gateway-token.json'), 'utf8'));
        const token = Object.entries(tokenMap).find(([, e]) => Array.isArray(e?.scopes) && e.scopes.includes('Read'))?.[0];
        if (token) {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 2500);
          const up = await fetch('http://127.0.0.1:8080/overview', {
            headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal,
          });
          clearTimeout(t);
          if (up.ok) liveBody = await up.text();
        }
      } catch { /* fall through to snapshot */ }
      if (liveBody != null) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-DAM-Mode': 'live' });
        res.end(liveBody);
        return;
      }
      const snap = await readFile(join(process.cwd(), 'functions/data/overview.json'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-DAM-Mode': 'snapshot' });
      res.end(snap);
      return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(process.cwd(), path));
    if (!file.startsWith(process.cwd())) throw Object.assign(new Error('forbidden'), { code: 403 });
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(err?.code === 403 ? 403 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(err?.code === 403 ? 'forbidden' : 'not found');
  }
}).listen(port, host, () => console.log(`dev site → http://localhost:${port}/`));
