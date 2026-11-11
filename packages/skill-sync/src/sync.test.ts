import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { parseSkillMd } from './frontmatter.js';
import { SkillManifest } from './manifest.js';
import { scanSkillFiles } from './scan.js';
import { syncSkills } from './sync.js';
import { createGateway } from '@ai-native-dam/mcp-gateway';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '__fixtures__', 'valid-repo');

describe('parseSkillMd', () => {
  it('parses frontmatter and body', () => {
    const parsed = parseSkillMd('---\nname: foo\ndescription: a valid description\n---\n# Body\n');
    expect(parsed).not.toBeNull();
    expect(parsed!.data.name).toBe('foo');
    expect(parsed!.body).toContain('# Body');
  });

  it('returns null without a frontmatter block', () => {
    expect(parseSkillMd('# No frontmatter\n')).toBeNull();
  });
});

describe('SkillManifest', () => {
  it('applies defaults', () => {
    const m = SkillManifest.parse({ name: 'x-skill', description: 'does something useful' });
    expect(m.version).toBe('0.1.0');
    expect(m.domain).toBe('generic');
    expect(m.risk).toBe('low');
  });

  it('rejects bad versions and bad names', () => {
    expect(SkillManifest.safeParse({ name: 'ok-name', description: 'valid description', version: '1.0' }).success).toBe(false);
    expect(SkillManifest.safeParse({ name: 'Bad Name', description: 'valid description' }).success).toBe(false);
  });

  it('accepts semver prerelease and build tags (e.g. 1.0.0-neutral)', () => {
    expect(SkillManifest.safeParse({ name: 'ok-name', description: 'valid description', version: '1.0.0-neutral' }).success).toBe(true);
    expect(SkillManifest.safeParse({ name: 'ok-name', description: 'valid description', version: '2.1.0-beta.1' }).success).toBe(true);
    expect(SkillManifest.safeParse({ name: 'ok-name', description: 'valid description', version: '2.1.0+build.5' }).success).toBe(true);
    expect(SkillManifest.safeParse({ name: 'ok-name', description: 'valid description', version: '1.0' }).success).toBe(false);
    expect(SkillManifest.safeParse({ name: 'ok-name', description: 'valid description', version: 'v1.0.0' }).success).toBe(false);
  });
});

describe('scanSkillFiles', () => {
  it('finds every SKILL.md recursively, sorted', async () => {
    const files = await scanSkillFiles(REPO);
    expect(files.length).toBe(4);
    expect(files.some(f => f.endsWith(join('script-split', 'SKILL.md')))).toBe(true);
  });
});

describe('syncSkills (dry run)', () => {
  it('validates the repo: 2 valid, 2 invalid with errors', async () => {
    const records = await syncSkills(REPO, { dryRun: true });
    const ok = records.filter(r => r.ok);
    const bad = records.filter(r => !r.ok);
    expect(ok.length).toBe(2);
    expect(bad.length).toBe(2);

    const scriptSplit = ok.find(r => r.file.includes('script-split'));
    expect(scriptSplit?.registration?.id).toBe('short_drama:script-split');
    expect(scriptSplit?.registration?.version).toBe('1.2.0');
    expect(scriptSplit?.registration?.sourcePath).toBe('skills/short_drama/script-split/SKILL.md');

    expect(bad.map(r => r.file).join()).toContain('bad-version');
    expect(bad.map(r => r.file).join()).toContain('no-frontmatter');
  });
});

describe('syncSkills (live gateway)', () => {
  let gatewayUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const gateway = createGateway({
      tokens: { 'sync-token': { id: 'syncer', scopes: ['Suggest', 'Read', 'Edit'] } },
    });
    await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
    gatewayUrl = `http://127.0.0.1:${(gateway.server.address() as AddressInfo).port}`;
    close = () => new Promise<void>((res, rej) => gateway.server.close(e => (e ? rej(e) : res())));
  });

  afterAll(() => close());

  it('registers valid skills through the approval gate end to end', async () => {
    const skillsDir = join(REPO, 'skills'); // only the two valid skills
    const records = await syncSkills(skillsDir, { gatewayUrl, token: 'sync-token' });
    expect(records.length).toBe(2);
    expect(records.every(r => r.registered)).toBe(true);

    // Verify they landed in the registry as pending_approval.
    const res = await fetch(`${gatewayUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sync-token' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'search_skills', arguments: { only_approved: false } },
      }),
    });
    const body: any = await res.json();
    const skills = JSON.parse(body.result.content[0].text).skills;
    expect(skills.length).toBe(2);
    expect(skills.map((s: { status: string }) => s.status)).toEqual(['pending_approval', 'pending_approval']);
    expect(skills.map((s: { id: string }) => s.id).sort()).toEqual(['ecommerce:price-quote', 'short_drama:script-split']);
  });
});
