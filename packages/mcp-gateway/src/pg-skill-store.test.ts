import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Skill } from '@ai-native-dam/shared-schema';
import { PgSkillStore } from './pg-skill-store.js';
import { createGateway, type Gateway } from './server.js';
import type { TokenMap } from './auth.js';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'operations:test-skill',
    version: '0.1.0',
    name: 'test-skill',
    description: 'a test skill with a long enough description',
    domain: 'operations',
    sourceSopId: null,
    status: 'pending_approval',
    approvedAt: null,
    approvedBy: null,
    loraArtifactRef: null,
    createdAt: '2026-11-12T00:00:00.000Z',
    sourceRepo: 'https://github.com/vfvincentwong2026/vincent-core',
    sourcePath: 'skills/test/SKILL.md',
    sourceCommit: '0028da1',
    ...overrides,
  };
}

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dam-pg-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('PgSkillStore (embedded PGlite)', () => {
  it('round-trips a skill version with all provenance fields', async () => {
    const store = await PgSkillStore.embedded(await tempDir());
    const skill = makeSkill();
    await store.put(skill);
    const got = await store.get(skill.id, skill.version);
    expect(got).toEqual(skill);
    await store.close();
  });

  it('returns undefined for an unknown version', async () => {
    const store = await PgSkillStore.embedded(await tempDir());
    await store.put(makeSkill());
    expect(await store.get('operations:test-skill', '9.9.9')).toBeUndefined();
    expect(await store.get('content:nope', '0.1.0')).toBeUndefined();
    await store.close();
  });

  it('search honors domain, query, and onlyApproved filters', async () => {
    const store = await PgSkillStore.embedded(await tempDir());
    await store.put(makeSkill());
    await store.put(
      makeSkill({
        id: 'content:ui-design',
        name: 'ui-design',
        description: 'interface design review checklist',
        domain: 'content',
        status: 'approved',
        approvedAt: '2026-11-01T00:00:00.000Z',
        approvedBy: 'vincent',
      }),
    );

    expect((await store.search({})).map(s => s.id).sort()).toEqual([
      'content:ui-design',
      'operations:test-skill',
    ]);
    expect((await store.search({ onlyApproved: true })).map(s => s.id)).toEqual(['content:ui-design']);
    expect((await store.search({ domain: 'operations' })).map(s => s.id)).toEqual([
      'operations:test-skill',
    ]);
    expect((await store.search({ query: 'DESIGN' })).map(s => s.id)).toEqual(['content:ui-design']);
    expect(await store.search({ query: 'no-such-thing' })).toEqual([]);
    await store.close();
  });

  it('survives a close/reopen cycle on the same data directory', async () => {
    const dir = await tempDir();
    const first = await PgSkillStore.embedded(dir);
    await first.put(makeSkill());
    await first.close();

    const second = await PgSkillStore.embedded(dir);
    expect(await second.get('operations:test-skill', '0.1.0')).toEqual(makeSkill());
    await second.close();
  });
});

describe('gateway with a persistent SkillStore', () => {
  const TOKENS: TokenMap = {
    'edit-token': { id: 'editor', scopes: ['Suggest', 'Read', 'Edit'] },
  };

  let gateway: Gateway | undefined;
  let baseUrl = '';

  async function startGateway(dataDir: string) {
    const skillStore = await PgSkillStore.embedded(dataDir);
    gateway = createGateway({ tokens: TOKENS, skillStore });
    await new Promise<void>(resolve => gateway!.server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(gateway!.server.address() as AddressInfo).port}`;
  }

  async function stopGateway() {
    if (!gateway) return;
    await new Promise<void>((resolve, reject) =>
      gateway!.server.close(err => (err ? reject(err) : resolve())),
    );
    await (gateway.skillStore as PgSkillStore).close();
    gateway = undefined;
  }

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer edit-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body: any = await res.json();
    const text = body?.result?.content?.[0]?.text;
    if (!text) throw new Error(`no tool content: ${JSON.stringify(body)}`);
    return JSON.parse(text);
  }

  it('a skill registered through RPC is still there after a gateway restart', async () => {
    const dir = await tempDir();
    const wireArgs = {
      id: 'operations:arb-aeon-trial',
      version: '0.1.0',
      name: 'arb-aeon-trial',
      description: 'appliance trial station setup SOP',
      domain: 'operations',
      source_repo: 'https://github.com/vfvincentwong2026/vincent-core',
      source_path: 'skills/arb-aeon/SKILL.md',
      source_commit: '0028da1',
    };

    await startGateway(dir);
    const first = await callTool('register_skill', wireArgs);
    expect(first.approval_required).toBe(true);
    const second = await callTool('register_skill', {
      ...wireArgs,
      _confirmation: first.confirmation_token,
    });
    expect(second.skill.status).toBe('pending_approval');
    await stopGateway();

    // Restart against the same data directory: registration must survive.
    await startGateway(dir);
    const found = await callTool('search_skills', { only_approved: false, domain: 'operations' });
    expect(found.skills.map((s: any) => s.id)).toContain('operations:arb-aeon-trial');
    expect(found.skills[0].source_commit).toBe('0028da1');

    // Re-registering the same version is rejected as a duplicate.
    const dupeFirst = await callTool('register_skill', wireArgs);
    const dupe = await callTool('register_skill', {
      ...wireArgs,
      _confirmation: dupeFirst.confirmation_token,
    });
    expect(dupe.rejected).toBe(true);
    expect(dupe.reason).toBe('skill_version_exists');
    await stopGateway();
  });
});
