import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createGateway } from './server.js';
import type { TokenMap } from './auth.js';
import type { Asset, RightsRecord } from '@ai-native-dam/shared-schema';

const TOKENS: TokenMap = {
  'edit-token': { id: 'editor', scopes: ['Suggest', 'Read', 'Edit'] },
  'read-token': { id: 'viewer', scopes: ['Suggest', 'Read'] },
};

const asset: Asset = {
  id: 'asset-0001',
  title: 'Summer campaign hero image',
  mimeType: 'image/jpeg',
  sizeBytes: 2048,
  tags: ['summer', 'campaign'],
  renditionUrl: 'https://example.com/asset-0001.jpg',
  rightsStatus: 'Cleared',
  createdAt: '2026-01-01T00:00:00Z',
};

const rights: RightsRecord = {
  assetId: 'asset-0001',
  license: 'internal',
  territories: ['CN'],
  channels: ['xiaohongshu'],
  embargoUntil: null,
  expiresAt: null,
  status: 'Cleared',
};

let baseUrl: string;
let server: ReturnType<typeof createGateway>['server'];

async function rpc(body: unknown, token?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const parsed: any = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

function callTool(name: string, args: Record<string, unknown>, token = 'edit-token') {
  return rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, token);
}

function unwrapToolJson(response: { body: any }) {
  const text = response.body?.result?.content?.[0]?.text;
  if (!text) throw new Error('no tool content in response');
  return JSON.parse(text);
}

beforeAll(async () => {
  const gateway = createGateway({
    tokens: TOKENS,
    seed: { assets: [asset], rights: [rights] },
  });
  server = gateway.server;
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
});

describe('gateway transport', () => {
  it('answers initialize with protocol version and server info', async () => {
    const { body } = await rpc({ jsonrpc: '2.0', id: 7, method: 'initialize' }, 'read-token');
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.serverInfo.name).toBe('ai-native-dam-gateway');
  });

  it('rejects calls without a bearer token', async () => {
    const { status, body } = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(status).toBe(401);
    expect(body.error.code).toBe(-32001);
  });

  it('rejects unknown tokens', async () => {
    const { status } = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'nope');
    expect(status).toBe(401);
  });

  it('rejects malformed JSON with -32700', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer read-token' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error.code).toBe(-32700);
  });
});

describe('RBAC', () => {
  it('read-scoped principals do not see edit-only tools', async () => {
    const { body } = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'read-token');
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('search_assets');
    expect(names).not.toContain('create_asset');
    expect(names).not.toContain('record_usage');
  });

  it('edit-scoped principals see the full surface', async () => {
    const { body } = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'edit-token');
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['search_assets', 'check_usage_rights', 'create_asset', 'set_rights', 'record_usage', 'search_knowledge', 'write_knowledge', 'search_skills']));
  });

  it('blocks an edit-only tool for a read principal even when called directly', async () => {
    const { body } = await callTool('record_usage', { asset_id: 'asset-0001', channel: 'xiaohongshu' }, 'read-token');
    expect(body.error.code).toBe(-32003);
  });
});

describe('read tools', () => {
  it('search_assets finds the seeded asset (snake_case wire)', async () => {
    const { body } = await callTool('search_assets', { query: 'summer' }, 'read-token');
    const out = unwrapToolJson({ body });
    expect(out.total).toBe(1);
    expect(out.assets[0].id).toBe('asset-0001');
    expect(out.assets[0].rendition_url).toBe('https://example.com/asset-0001.jpg');
  });

  it('check_usage_rights allows a licensed channel and denies an unlicensed one', async () => {
    const ok = unwrapToolJson({ body: (await callTool('check_usage_rights', { asset_id: 'asset-0001', channel: 'xiaohongshu' }, 'read-token')).body });
    expect(ok.allowed).toBe(true);

    const no = unwrapToolJson({ body: (await callTool('check_usage_rights', { asset_id: 'asset-0001', channel: 'x' }, 'read-token')).body });
    expect(no.allowed).toBe(false);
    expect(no.reason).toBe('channel_not_licensed');
  });

  it('check_usage_rights reports asset_not_found', async () => {
    const out = unwrapToolJson({ body: (await callTool('check_usage_rights', { asset_id: 'ghost', channel: 'x' }, 'read-token')).body });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('asset_not_found');
  });

  it('deprecated alias check_use still works and is marked', async () => {
    const { body } = await callTool('check_use', { asset_id: 'asset-0001', channel: 'xiaohongshu' }, 'read-token');
    expect(body.result.deprecated_alias).toBe('check_use');
    expect(body.result.use_instead).toBe('check_usage_rights');
    const out = unwrapToolJson({ body });
    expect(out.allowed).toBe(true);
  });

  it('tools/list shows only the canonical name', async () => {
    const { body } = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'read-token');
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('check_usage_rights');
    expect(names).not.toContain('check_use');
  });
});

describe('gated write tools (two-call confirmation)', () => {
  it('first call issues a token; quoting it back executes the write', async () => {
    const args = { asset_id: 'asset-0001', channel: 'xiaohongshu', context: 'launch post' };

    const first = unwrapToolJson({ body: (await callTool('record_usage', args)).body });
    expect(first.approval_required).toBe(true);
    expect(first.confirmation_token).toBeTruthy();

    const second = unwrapToolJson({ body: (await callTool('record_usage', { ...args, _confirmation: first.confirmation_token })).body });
    expect(second.recorded).toBe(true);
    expect(second.usage_id).toMatch(/^usage-/);
  });

  it('a wrong confirmation token is rejected', async () => {
    const args = { asset_id: 'asset-0001', channel: 'xiaohongshu' };
    await callTool('record_usage', args);
    const { body } = await callTool('record_usage', { ...args, _confirmation: 'bogus' });
    expect(body.error.code).toBe(-32010);
  });

  it('record_usage is rejected when rights do not cover the channel', async () => {
    const args = { asset_id: 'asset-0001', channel: 'x' };
    const first = unwrapToolJson({ body: (await callTool('record_usage', args)).body });
    const second = await callTool('record_usage', { ...args, _confirmation: first.confirmation_token });
    expect(second.body.result.isError).toBe(true);
    const out = unwrapToolJson({ body: second.body });
    expect(out.rejected).toBe(true);
    expect(out.reason).toBe('channel_not_licensed');
  });

  it('create_asset + set_rights make an asset usable (full lifecycle)', async () => {
    const createArgs = {
      title: 'New Year teaser',
      mime_type: 'video/mp4',
      rendition_url: 'https://example.com/ny.mp4',
      tags: ['newyear'],
      license: 'brand-owned',
    };
    const c1 = unwrapToolJson({ body: (await callTool('create_asset', createArgs)).body });
    const c2 = unwrapToolJson({ body: (await callTool('create_asset', { ...createArgs, _confirmation: c1.confirmation_token })).body });
    expect(c2.asset.rights_status).toBe('Pending');

    const id = c2.asset.id as string;
    const rightsArgs = { asset_id: id, license: 'brand-owned', territories: ['CN'], channels: ['x'], status: 'Cleared' };
    const r1 = unwrapToolJson({ body: (await callTool('set_rights', rightsArgs)).body });
    const r2 = unwrapToolJson({ body: (await callTool('set_rights', { ...rightsArgs, _confirmation: r1.confirmation_token })).body });
    expect(r2.rights.status).toBe('Cleared');

    const check = unwrapToolJson({ body: (await callTool('check_usage_rights', { asset_id: id, channel: 'x' }, 'read-token')).body });
    expect(check.allowed).toBe(true);
  });

  it('write_knowledge lands as pending_approval and is hidden from default search', async () => {
    const args = { title: 'XHS posting SOP', layer: 'manual', content: 'Post between 12:00 and 13:00.' };
    const w1 = unwrapToolJson({ body: (await callTool('write_knowledge', args)).body });
    const w2 = unwrapToolJson({ body: (await callTool('write_knowledge', { ...args, _confirmation: w1.confirmation_token })).body });
    expect(w2.entry.status).toBe('pending_approval');

    const hidden = unwrapToolJson({ body: (await callTool('search_knowledge', { query: 'posting' }, 'read-token')).body });
    expect(hidden.entries).toHaveLength(0);

    const visible = unwrapToolJson({ body: (await callTool('search_knowledge', { query: 'posting', only_approved: false }, 'read-token')).body });
    expect(visible.entries).toHaveLength(1);
  });
});

describe('argument validation', () => {
  it('unknown tool returns -32601', async () => {
    const { body } = await callTool('nope_tool', {});
    expect(body.error.code).toBe(-32601);
  });

  it('invalid arguments return -32602', async () => {
    const { body } = await callTool('check_usage_rights', { channel: 'x' }, 'read-token');
    expect(body.error.code).toBe(-32602);
  });
});

describe('register_skill', () => {
  const skillArgs = {
    id: 'drama:script-split',
    version: '1.0.0',
    name: 'Script Split',
    description: 'Split a short-drama script into scenes.',
    domain: 'short_drama',
    source_repo: 'https://github.com/vfvincentwong2026/drama-skills',
    source_path: 'script-split/SKILL.md',
    source_commit: 'abc123',
  };

  it('registers via the confirmation flow and lands as pending_approval', async () => {
    const first = unwrapToolJson({ body: (await callTool('register_skill', skillArgs)).body });
    expect(first.approval_required).toBe(true);

    const second = unwrapToolJson({
      body: (await callTool('register_skill', { ...skillArgs, _confirmation: first.confirmation_token })).body,
    });
    expect(second.skill.status).toBe('pending_approval');
    expect(second.skill.source_commit).toBe('abc123');

    // Hidden from default (approved-only) search, visible with only_approved=false.
    const hidden = unwrapToolJson({ body: (await callTool('search_skills', { query: 'script' }, 'read-token')).body });
    expect(hidden.skills).toHaveLength(0);
    const visible = unwrapToolJson({ body: (await callTool('search_skills', { query: 'script', only_approved: false }, 'read-token')).body });
    expect(visible.skills).toHaveLength(1);
  });

  it('rejects re-registering the same id@version', async () => {
    const first = unwrapToolJson({ body: (await callTool('register_skill', skillArgs)).body });
    const second = await callTool('register_skill', { ...skillArgs, _confirmation: first.confirmation_token });
    expect(second.body.result.isError).toBe(true);
    expect(unwrapToolJson({ body: second.body }).reason).toBe('skill_version_exists');
  });

  it('rejects malformed skill ids at validation', async () => {
    const args = { ...skillArgs, id: 'Bad ID!' };
    const first = unwrapToolJson({ body: (await callTool('register_skill', args)).body });
    const second = await callTool('register_skill', { ...args, _confirmation: first.confirmation_token });
    expect(second.body.error.code).toBe(-32602);
  });
});
