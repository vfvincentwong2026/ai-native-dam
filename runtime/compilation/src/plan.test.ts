import { describe, expect, it } from 'vitest';
import type { SystemSpec } from '@ai-native-dam/shared-schema';
import { kebab, planBlueprint } from './index.js';

const baseSpec: SystemSpec = {
  id: 'spec-0001',
  title: 'DramaPulse 榜单运营台',
  businessDomain: 'short-drama',
  requirements: '运营每天需要看到印尼短剧榜单快照、异常波动和素材消耗。',
  entities: [
    {
      name: 'shortDramaRecord',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'title', type: 'string', required: true },
        { name: 'status', type: 'string', required: true },
      ],
      permissions: ['read'],
    },
  ],
  workflows: ['每日榜单快照', '异常波动告警'],
  sourceSkillIds: ['operations:project-context'],
  sourceKnowledgeIds: ['kn-0001'],
  status: 'approved',
  createdAt: '2026-11-12T10:58:06.332Z',
  approvedAt: '2026-11-12T10:58:06.351Z',
  approvedBy: 'vincent',
};

describe('planBlueprint', () => {
  it('is deterministic: same spec compiles to the same blueprint hash', () => {
    const a = planBlueprint(baseSpec);
    const b = planBlueprint(baseSpec);
    expect(a).toEqual(b);
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.id).toBe(`bp-${a.hash.slice(0, 12)}`);
  });

  it('different specs produce different hashes', () => {
    const other = planBlueprint({ ...baseSpec, id: 'spec-0002', title: 'Other Console' });
    expect(other.hash).not.toBe(planBlueprint(baseSpec).hash);
  });

  it('emits the InstallableUnit L1 core files (manifest + health)', () => {
    const bp = planBlueprint(baseSpec);
    const paths = bp.files.map((f) => f.path);
    expect(paths).toContain('dam.manifest.yaml');
    expect(paths).toContain('src/health.ts');
    const manifest = bp.files.find((f) => f.path === 'dam.manifest.yaml');
    expect(manifest?.module).toBe('core');
    expect(manifest?.tier).toBe('C0');
  });

  it('maps every entity to model + route + test files (C1) with verbs from permissions', () => {
    const bp = planBlueprint(baseSpec);
    const paths = bp.files.map((f) => f.path);
    expect(paths).toContain('src/models/short-drama-record.ts');
    expect(paths).toContain('src/routes/short-drama-record.ts');
    expect(paths).toContain('tests/short-drama-record.test.ts');

    const route = bp.files.find((f) => f.path === 'src/routes/short-drama-record.ts');
    expect(route?.tier).toBe('C1');
    expect(route?.purpose).toContain('GET');
    expect(route?.purpose).not.toContain('POST'); // read-only entity
  });

  it('write permission adds mutating verbs to the route purpose', () => {
    const spec: SystemSpec = {
      ...baseSpec,
      entities: [{ ...baseSpec.entities[0], permissions: ['read', 'write'] }],
    };
    const route = planBlueprint(spec).files.find((f) => f.kind === 'route');
    expect(route?.purpose).toContain('POST');
    expect(route?.purpose).toContain('DELETE');
  });

  it('maps every workflow to a C2 workflow file and module', () => {
    const bp = planBlueprint(baseSpec);
    const workflowFiles = bp.files.filter((f) => f.kind === 'workflow');
    expect(workflowFiles).toHaveLength(2);
    expect(workflowFiles.every((f) => f.tier === 'C2')).toBe(true);
    // CJK workflow names must not collapse into one file path
    expect(new Set(workflowFiles.map((f) => f.path)).size).toBe(2);
    const moduleNames = bp.modules.map((m) => m.name);
    for (const f of workflowFiles) expect(moduleNames).toContain(f.module);
  });

  it('every file references an existing module', () => {
    const bp = planBlueprint(baseSpec);
    const moduleNames = new Set(bp.modules.map((m) => m.name));
    for (const f of bp.files) expect(moduleNames.has(f.module)).toBe(true);
  });

  it('prompt plan covers every file exactly once plus the C3 review pass', () => {
    const bp = planBlueprint(baseSpec);
    const planFiles = bp.promptPlan.filter((p) => p.file !== '(review)').map((p) => p.file);
    expect(planFiles.sort()).toEqual(bp.files.map((f) => f.path).sort());
    const review = bp.promptPlan.find((p) => p.file === '(review)');
    expect(review?.tier).toBe('C3');
  });

  it('carries provenance from the spec verbatim', () => {
    const bp = planBlueprint(baseSpec);
    expect(bp.provenance.sourceSkillIds).toEqual(['operations:project-context']);
    expect(bp.provenance.sourceKnowledgeIds).toEqual(['kn-0001']);
  });

  it('routes order/transaction domains to postgres, others to the default', () => {
    const retail = planBlueprint({ ...baseSpec, businessDomain: 'retail' });
    expect(retail.stack.storage).toBe('postgres');
    const drama = planBlueprint(baseSpec);
    expect(drama.stack.storage).toBe('sqlite');
    const unknown = planBlueprint({ ...baseSpec, businessDomain: 'legal-tech' });
    expect(unknown.stack).toEqual(planBlueprint({ ...baseSpec, businessDomain: 'misc' }).stack);
  });

  it('kebab slugifies camelCase, CJK, and punctuation deterministically', () => {
    expect(kebab('shortDramaRecord')).toBe('short-drama-record');
    expect(kebab('每日榜单快照')).toBe('unnamed'); // CJK has no ascii slug — deterministic fallback
    expect(kebab('  Hello World!! ')).toBe('hello-world');
  });
});
