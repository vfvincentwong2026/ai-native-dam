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

  it('approve transitions only from draft/pending_approval and stamps the approver', async () => {
    const store = await PgSkillStore.embedded(await tempDir());
    await store.put(makeSkill());
    await store.put(makeSkill({ id: 'operations:draft-skill', version: '0.1.0', status: 'draft' }));
    await store.put(makeSkill({
      id: 'operations:done-skill', version: '0.1.0', status: 'approved',
      approvedAt: '2026-11-01T00:00:00.000Z', approvedBy: 'vincent',
    }));
    await store.put(makeSkill({ id: 'operations:dead-skill', version: '0.1.0', status: 'revoked' }));

    const approved = await store.approve('operations:test-skill', '0.1.0', 'vincent', '2026-11-12T01:00:00.000Z');
    expect(approved?.status).toBe('approved');
    expect(approved?.approvedBy).toBe('vincent');
    expect(approved?.approvedAt).toBe('2026-11-12T01:00:00.000Z');

    // draft → approved is allowed
    expect((await store.approve('operations:draft-skill', '0.1.0', 'v', '2026-11-12T01:01:00.000Z'))?.status)
      .toBe('approved');
    // already approved / revoked / missing → undefined, no mutation
    expect(await store.approve('operations:done-skill', '0.1.0', 'v', '2026-11-12T01:02:00.000Z')).toBeUndefined();
    expect(await store.approve('operations:dead-skill', '0.1.0', 'v', '2026-11-12T01:03:00.000Z')).toBeUndefined();
    expect(await store.approve('operations:ghost', '0.1.0', 'v', '2026-11-12T01:04:00.000Z')).toBeUndefined();
    expect((await store.get('operations:done-skill', '0.1.0'))?.approvedBy).toBe('vincent');
    await store.close();
  });

  it('approval survives a close/reopen cycle', async () => {
    const dir = await tempDir();
    const first = await PgSkillStore.embedded(dir);
    await first.put(makeSkill());
    await first.approve('operations:test-skill', '0.1.0', 'vincent', '2026-11-12T01:00:00.000Z');
    await first.close();

    const second = await PgSkillStore.embedded(dir);
    const got = await second.get('operations:test-skill', '0.1.0');
    expect(got?.status).toBe('approved');
    expect(got?.approvedBy).toBe('vincent');
    expect(await second.search({ onlyApproved: true })).toHaveLength(1);
    await second.close();
  });

  it('revoke works from any non-revoked state and is not repeatable', async () => {
    const store = await PgSkillStore.embedded(await tempDir());
    await store.put(makeSkill());
    await store.put(makeSkill({
      id: 'operations:done-skill', version: '0.1.0', status: 'approved',
      approvedAt: '2026-11-01T00:00:00.000Z', approvedBy: 'vincent',
    }));

    // revoke from pending_approval and from approved
    expect((await store.revoke('operations:test-skill', '0.1.0'))?.status).toBe('revoked');
    expect((await store.revoke('operations:done-skill', '0.1.0'))?.status).toBe('revoked');
    // approval stamps survive revocation (audit trail)
    expect((await store.get('operations:done-skill', '0.1.0'))?.approvedBy).toBe('vincent');
    // repeat revoke / missing → undefined, no mutation
    expect(await store.revoke('operations:test-skill', '0.1.0')).toBeUndefined();
    expect(await store.revoke('operations:ghost', '0.1.0')).toBeUndefined();
    // revoked versions leave the default search, stay in the registry
    expect(await store.search({ onlyApproved: true })).toHaveLength(0);
    expect(await store.search({})).toHaveLength(2);
    await store.close();
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

  it('approve_skill (gated) makes a pending skill discoverable and is idempotent-safe', async () => {
    const dir = await tempDir();
    const wireArgs = {
      id: 'operations:arb-aeon-trial',
      version: '0.1.0',
      name: 'arb-aeon-trial',
      description: 'appliance trial station setup SOP',
      domain: 'operations',
    };

    await startGateway(dir);
    const regFirst = await callTool('register_skill', wireArgs);
    await callTool('register_skill', { ...wireArgs, _confirmation: regFirst.confirmation_token });

    // Not visible under the default only_approved filter before approval.
    const before = await callTool('search_skills', {});
    expect(before.skills).toHaveLength(0);

    // approve_skill is gated too: first call returns a token, second executes.
    const approveFirst = await callTool('approve_skill', { id: wireArgs.id, version: wireArgs.version });
    expect(approveFirst.approval_required).toBe(true);
    expect(approveFirst.risk_level).toBe('high');
    const approved = await callTool('approve_skill', {
      id: wireArgs.id,
      version: wireArgs.version,
      _confirmation: approveFirst.confirmation_token,
    });
    expect(approved.skill.status).toBe('approved');
    // Approver identity comes from the token principal, not from arguments.
    expect(approved.skill.approved_by).toBe('editor');
    expect(approved.skill.approved_at).toBeTruthy();

    const after = await callTool('search_skills', {});
    expect(after.skills.map((s: any) => s.id)).toEqual(['operations:arb-aeon-trial']);

    // Second approval attempt is rejected, not silently re-stamped.
    const againFirst = await callTool('approve_skill', { id: wireArgs.id, version: wireArgs.version });
    const again = await callTool('approve_skill', {
      id: wireArgs.id,
      version: wireArgs.version,
      _confirmation: againFirst.confirmation_token,
    });
    expect(again.rejected).toBe(true);
    expect(again.reason).toBe('invalid_status_transition');

    // Unknown skill → skill_not_found.
    const missingFirst = await callTool('approve_skill', { id: 'operations:ghost', version: '9.9.9' });
    const missing = await callTool('approve_skill', {
      id: 'operations:ghost',
      version: '9.9.9',
      _confirmation: missingFirst.confirmation_token,
    });
    expect(missing.rejected).toBe(true);
    expect(missing.reason).toBe('skill_not_found');
    await stopGateway();

    // Approval persists across a gateway restart.
    await startGateway(dir);
    const afterRestart = await callTool('search_skills', {});
    expect(afterRestart.skills[0].status).toBe('approved');
    expect(afterRestart.skills[0].approved_by).toBe('editor');
    await stopGateway();
  });

  it('revoke_skill (gated) removes a skill from default search and is not repeatable', async () => {
    const dir = await tempDir();
    const wireArgs = {
      id: 'content:news-broadcast',
      version: '0.1.0',
      name: 'news-broadcast',
      description: 'news brief pipeline skill',
      domain: 'content',
    };

    await startGateway(dir);
    const regFirst = await callTool('register_skill', wireArgs);
    await callTool('register_skill', { ...wireArgs, _confirmation: regFirst.confirmation_token });
    const apFirst = await callTool('approve_skill', { id: wireArgs.id, version: wireArgs.version });
    await callTool('approve_skill', { id: wireArgs.id, version: wireArgs.version, _confirmation: apFirst.confirmation_token });
    expect((await callTool('search_skills', {})).skills).toHaveLength(1);

    const rvFirst = await callTool('revoke_skill', { id: wireArgs.id, version: wireArgs.version });
    expect(rvFirst.approval_required).toBe(true);
    expect(rvFirst.risk_level).toBe('high');
    const rv = await callTool('revoke_skill', {
      id: wireArgs.id,
      version: wireArgs.version,
      _confirmation: rvFirst.confirmation_token,
    });
    expect(rv.skill.status).toBe('revoked');
    expect((await callTool('search_skills', {})).skills).toHaveLength(0);

    // repeat revoke → rejected
    const rv2First = await callTool('revoke_skill', { id: wireArgs.id, version: wireArgs.version });
    const rv2 = await callTool('revoke_skill', {
      id: wireArgs.id,
      version: wireArgs.version,
      _confirmation: rv2First.confirmation_token,
    });
    expect(rv2.rejected).toBe(true);
    expect(rv2.reason).toBe('invalid_status_transition');

    // missing → skill_not_found
    const mFirst = await callTool('revoke_skill', { id: 'content:ghost', version: '9.9.9' });
    const m = await callTool('revoke_skill', {
      id: 'content:ghost',
      version: '9.9.9',
      _confirmation: mFirst.confirmation_token,
    });
    expect(m.rejected).toBe(true);
    expect(m.reason).toBe('skill_not_found');
    await stopGateway();
  });
});
