import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { approvalKey, type ApprovalEntry } from './approval.js';
import { openPgBackend } from './pg-backend.js';
import { PgApprovalStore } from './pg-approval-store.js';
import { PgGovernanceStore } from './pg-governance-store.js';
import { PgSkillStore } from './pg-skill-store.js';
import { createGateway, type Gateway } from './server.js';
import type { TokenMap } from './auth.js';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dam-pgappr-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

function entry(overrides: Partial<ApprovalEntry> = {}): ApprovalEntry {
  return {
    key: approvalKey('record_usage', 'editor', { asset_id: 'a1' }),
    token: 'tok-1',
    createdAt: 1_000_000,
    expiresAt: 1_300_000,
    consumed: false,
    ...overrides,
  };
}

describe('PgApprovalStore (embedded PGlite, shared backend)', () => {
  it('round-trips and re-issues over an existing key', async () => {
    const backend = await openPgBackend({ dataDir: await tempDir() });
    const store = await PgApprovalStore.over(backend.db);

    expect(await store.get('missing')).toBeUndefined();
    await store.put(entry());
    expect(await store.get(entry().key)).toEqual(entry());

    // re-issue overwrites the unconsumed token for the same call
    await store.put(entry({ token: 'tok-2' }));
    expect((await store.get(entry().key))?.token).toBe('tok-2');
    await backend.close();
  });

  it('consumed state survives a close/reopen cycle', async () => {
    const dir = await tempDir();
    const first = await openPgBackend({ dataDir: dir });
    const s1 = await PgApprovalStore.over(first.db);
    await s1.put(entry({ consumed: true }));
    await first.close();

    const second = await openPgBackend({ dataDir: dir });
    const s2 = await PgApprovalStore.over(second.db);
    const loaded = await s2.get(entry().key);
    expect(loaded?.consumed).toBe(true);
    expect(loaded?.expiresAt).toBe(1_300_000);
    await second.close();
  });
});

describe('gateway with persistent approval tokens', () => {
  const TOKENS: TokenMap = {
    'edit-token': { id: 'editor', scopes: ['Suggest', 'Read', 'Edit'] },
  };

  let gateway: Gateway | undefined;
  let backendClose: (() => Promise<void>) | undefined;
  let baseUrl = '';

  async function startGateway(dataDir: string) {
    const backend = await openPgBackend({ dataDir });
    backendClose = backend.close;
    // same wiring as cli.ts: all three stores share one backend
    const approvalStore = await PgApprovalStore.over(backend.db);
    const store = await PgGovernanceStore.over(backend.db);
    const skillStore = await PgSkillStore.over(backend.db);
    gateway = createGateway({ tokens: TOKENS, approvalStore, store, skillStore });
    await new Promise<void>(resolve => gateway!.server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(gateway!.server.address() as AddressInfo).port}`;
  }

  async function stopGateway() {
    if (!gateway) return;
    await new Promise<void>((resolve, reject) =>
      gateway!.server.close(err => (err ? reject(err) : resolve())),
    );
    await backendClose?.();
    gateway = undefined;
    backendClose = undefined;
  }

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer edit-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }).then(r => r.json() as Promise<any>);
    const text = res?.result?.content?.[0]?.text;
    if (text) return JSON.parse(text);
    return res; // RPC-level error (e.g. invalid token)
  }

  it('an approval chain started before a restart completes after it', async () => {
    const dir = await tempDir();
    await startGateway(dir);

    // need a rights-cleared asset for record_usage to land on
    const createArgs = { title: 'Hero', mime_type: 'image/jpeg', rendition_url: 'https://example.com/h.jpg', license: 'internal' };
    const c1 = await callTool('create_asset', createArgs);
    const c2 = await callTool('create_asset', { ...createArgs, _confirmation: c1.confirmation_token });
    const assetId = c2.asset.id;
    const rightsArgs = { asset_id: assetId, license: 'internal', territories: ['CN'], channels: ['xiaohongshu'], status: 'Cleared' };
    const r1 = await callTool('set_rights', rightsArgs);
    await callTool('set_rights', { ...rightsArgs, _confirmation: r1.confirmation_token });

    // first half of the approval chain: token issued
    const usageArgs = { asset_id: assetId, channel: 'xiaohongshu', context: 'launch' };
    const u1 = await callTool('record_usage', usageArgs);
    expect(u1.approval_required).toBe(true);
    await stopGateway();

    // gateway restarts (deploy/crash) before the human confirms
    await startGateway(dir);
    const u2 = await callTool('record_usage', { ...usageArgs, _confirmation: u1.confirmation_token });
    expect(u2.recorded).toBe(true);

    // the spent token stays spent across another restart (no replay)
    await stopGateway();
    await startGateway(dir);
    const replay = await callTool('record_usage', { ...usageArgs, _confirmation: u1.confirmation_token });
    expect(replay.error?.code).toBe(-32010);
    await stopGateway();
  });
});
