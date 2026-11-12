import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Asset, KnowledgeEntry, RightsRecord, SkillUsageRecord, SystemSpec, UsageRecord } from '@ai-native-dam/shared-schema';
import { openPgBackend } from './pg-backend.js';
import { PgGovernanceStore } from './pg-governance-store.js';
import { PgSkillStore } from './pg-skill-store.js';
import { createGateway, type Gateway } from './server.js';
import type { TokenMap } from './auth.js';

const asset: Asset = {
  id: 'asset-0001',
  title: 'Summer campaign hero image',
  mimeType: 'image/jpeg',
  sizeBytes: 2048,
  tags: ['summer', 'campaign'],
  renditionUrl: 'https://example.com/asset-0001.jpg',
  rightsStatus: 'Pending',
  createdAt: '2026-01-01T00:00:00.000Z',
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

const usage: UsageRecord = {
  id: 'usage-0001',
  assetId: 'asset-0001',
  channel: 'xiaohongshu',
  territory: 'CN',
  context: 'launch post',
  recordedAt: '2026-01-02T00:00:00.000Z',
  recordedBy: 'editor',
};

const entry: KnowledgeEntry = {
  id: 'kn-0001',
  title: 'Posting SOP',
  layer: 'manual',
  content: 'Post between 12:00 and 13:00.',
  sourceAssetIds: ['asset-0001'],
  status: 'pending_approval',
  createdAt: '2026-01-01T00:00:00.000Z',
  approvedAt: null,
};

const skillUsage: SkillUsageRecord = {
  id: 'su-0001',
  skillId: 'operations:project-context',
  version: '0.1.0',
  targetSystemId: 'client-bot-01',
  context: 'kickoff',
  appliedBy: 'editor',
  appliedAt: '2026-01-03T00:00:00.000Z',
};

const spec: SystemSpec = {
  id: 'spec-0001',
  title: 'Campaign Ops Console',
  businessDomain: 'content-ops',
  requirements: 'Editors need a console.',
  entities: [{ name: 'post', fields: [{ name: 'id', type: 'string', required: true }], permissions: ['read'] }],
  workflows: ['schedule post'],
  sourceSkillIds: ['operations:project-context'],
  sourceKnowledgeIds: ['kn-0001'],
  status: 'draft',
  createdAt: '2026-01-04T00:00:00.000Z',
  approvedAt: null,
  approvedBy: null,
};

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dam-pggov-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('PgGovernanceStore (embedded PGlite, shared backend)', () => {
  it('round-trips all six collections', async () => {
    const backend = await openPgBackend({ dataDir: await tempDir() });
    const store = await PgGovernanceStore.over(backend.db);

    await store.putAsset(asset);
    await store.putRights(rights);
    await store.appendUsage(usage);
    await store.putKnowledge(entry);
    await store.appendSkillUsage(skillUsage);
    await store.putSpec(spec);

    expect(await store.getAsset(asset.id)).toEqual(asset);
    expect(await store.getRights(asset.id)).toEqual(rights);
    expect(await store.listUsage(asset.id)).toEqual([usage]);
    expect(await store.getKnowledge(entry.id)).toEqual(entry);
    expect(await store.listSkillUsage(skillUsage.skillId)).toEqual([skillUsage]);
    expect(await store.getSpec(spec.id)).toEqual(spec);
    expect(await store.listSpecs('draft')).toEqual([spec]);
    expect(await store.listSpecs('approved')).toEqual([]);

    const joined = await store.listAssetsWithRights();
    expect(joined).toHaveLength(1);
    expect(joined[0].asset).toEqual(asset);
    expect(joined[0].rights).toEqual(rights);

    // knowledge search semantics mirror the memory store
    expect(await store.searchKnowledge({ query: 'posting' })).toHaveLength(0); // pending hidden
    expect(await store.searchKnowledge({ query: 'posting', onlyApproved: false })).toHaveLength(1);
    expect(await store.searchKnowledge({ query: 'posting', layer: 'rule', onlyApproved: false })).toHaveLength(0);

    await backend.close();
  });

  it('upserts assets and rights on conflict', async () => {
    const backend = await openPgBackend({ dataDir: await tempDir() });
    const store = await PgGovernanceStore.over(backend.db);
    await store.putAsset(asset);
    await store.putAsset({ ...asset, rightsStatus: 'Cleared' });
    expect((await store.getAsset(asset.id))?.rightsStatus).toBe('Cleared');
    await store.putRights(rights);
    await store.putRights({ ...rights, license: 'extended' });
    expect((await store.getRights(asset.id))?.license).toBe('extended');
    await backend.close();
  });

  it('all collections survive a close/reopen cycle', async () => {
    const dir = await tempDir();
    const first = await openPgBackend({ dataDir: dir });
    const s1 = await PgGovernanceStore.over(first.db);
    await s1.putAsset(asset);
    await s1.putRights(rights);
    await s1.appendUsage(usage);
    await s1.putKnowledge({ ...entry, status: 'approved', approvedAt: '2026-01-02T00:00:00.000Z' });
    await s1.appendSkillUsage(skillUsage);
    await s1.putSpec({ ...spec, status: 'approved', approvedAt: '2026-01-05T00:00:00.000Z', approvedBy: 'editor' });
    await first.close();

    const second = await openPgBackend({ dataDir: dir });
    const s2 = await PgGovernanceStore.over(second.db);
    expect(await s2.getAsset(asset.id)).toEqual(asset);
    expect((await s2.getKnowledge(entry.id))?.status).toBe('approved');
    expect(await s2.listUsage()).toHaveLength(1);
    expect(await s2.listSkillUsage()).toHaveLength(1);
    const reloaded = await s2.getSpec(spec.id);
    expect(reloaded?.status).toBe('approved');
    expect(reloaded?.approvedBy).toBe('editor');
    expect(reloaded?.entities).toEqual(spec.entities);
    await second.close();
  });
});

describe('gateway with full Postgres persistence (shared backend)', () => {
  const TOKENS: TokenMap = {
    'edit-token': { id: 'editor', scopes: ['Suggest', 'Read', 'Edit'] },
  };

  let gateway: Gateway | undefined;
  let backendClose: (() => Promise<void>) | undefined;
  let baseUrl = '';

  async function startGateway(dataDir: string) {
    const backend = await openPgBackend({ dataDir });
    backendClose = backend.close;
    const store = await PgGovernanceStore.over(backend.db);
    const skillStore = await PgSkillStore.over(backend.db);
    gateway = createGateway({ tokens: TOKENS, store, skillStore });
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

  async function callTool(name: string, args: Record<string, unknown>, confirm = true) {
    const post = (a: Record<string, unknown>) =>
      fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer edit-token' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: a } }),
      }).then(r => r.json() as Promise<any>);
    const first = await post(args);
    const text = first?.result?.content?.[0]?.text;
    if (!text) throw new Error(`no tool content: ${JSON.stringify(first)}`);
    const payload = JSON.parse(text);
    if (!confirm || !payload.approval_required) return payload;
    const second = await post({ ...args, _confirmation: payload.confirmation_token });
    const secondText = second?.result?.content?.[0]?.text;
    if (!secondText) throw new Error(`no tool content: ${JSON.stringify(second)}`);
    return JSON.parse(secondText);
  }

  it('asset lifecycle survives a gateway restart', async () => {
    const dir = await tempDir();
    await startGateway(dir);

    // create_asset → set_rights → record_usage, all through the gate
    const created = await callTool('create_asset', {
      title: 'Hero image', mime_type: 'image/jpeg', rendition_url: 'https://example.com/hero.jpg', license: 'internal',
    });
    const assetId = created.asset.id;
    expect(created.asset.rights_status).toBe('Pending');

    await callTool('set_rights', {
      asset_id: assetId, license: 'internal', territories: ['CN'], channels: ['xiaohongshu'], status: 'Cleared',
    });
    const checked = await callTool('check_usage_rights', { asset_id: assetId, channel: 'xiaohongshu' });
    expect(checked.allowed).toBe(true);
    const recorded = await callTool('record_usage', { asset_id: assetId, channel: 'xiaohongshu', context: 'launch' });
    expect(recorded.recorded).toBe(true);

    // skill register + apply on the same backend
    const reg = await callTool('register_skill', {
      id: 'operations:project-context', version: '0.1.0', name: 'project-context',
      description: 'routes project questions', domain: 'operations',
    });
    await callTool('approve_skill', { id: 'operations:project-context', version: '0.1.0' });
    expect(reg.skill.status).toBe('pending_approval');
    const applied = await callTool('apply_skill', {
      skill_id: 'operations:project-context', version: '0.1.0', target_system_id: 'bot-1', context: 'kickoff',
    });
    expect(applied.applied).toBe(true);
    await stopGateway();

    // restart: everything must still be there
    await startGateway(dir);
    const found = await callTool('search_assets', { query: 'hero' });
    expect(found.total).toBe(1);
    expect(found.assets[0].rights_status).toBe('Cleared');
    const recheck = await callTool('check_usage_rights', { asset_id: assetId, channel: 'xiaohongshu' });
    expect(recheck.allowed).toBe(true);
    const skills = await callTool('search_skills', {});
    expect(skills.skills.map((s: any) => s.id)).toContain('operations:project-context');
    await stopGateway();
  });
});
