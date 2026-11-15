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
