import { describe, expect, it } from 'vitest';
import type { SystemSpec } from '@ai-native-dam/shared-schema';
import { generateManifest, planBlueprint, verifyBuild, type BuildOutput } from './index.js';

const spec: SystemSpec = {
  id: 'spec-0001',
  title: 'Order Admin',
  businessDomain: 'retail',
  requirements: 'Ops need an order admin console.',
  entities: [
    {
      name: 'order',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'title', type: 'string', required: true },
      ],
      permissions: ['read', 'write'],
    },
  ],
  workflows: ['fulfill order'],
  sourceSkillIds: ['operations:project-context'],
  sourceKnowledgeIds: [],
  status: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
  approvedAt: '2026-01-01T01:00:00.000Z',
  approvedBy: 'editor',
};

const blueprint = planBlueprint(spec);

/** A build that exactly matches the blueprint: every planned file + the manifest. */
function goodBuild(): BuildOutput {
  return {
    files: [...blueprint.files.map((f) => f.path), 'dam.manifest.yaml'],
    manifest: generateManifest(blueprint),
  };
}

describe('generateManifest', () => {
  it('emits the InstallableUnit L1 shape with provenance links', () => {
    const yaml = generateManifest(blueprint);
    expect(yaml).toContain('kind: InstallableUnit');
    expect(yaml).toContain('sourceSpec: spec-0001');
    expect(yaml).toContain(`blueprintHash: ${blueprint.hash}`);
    expect(yaml).toContain('path: /health');
    expect(yaml).toContain("id: 'operations:project-context'");
    expect(yaml).toContain('secrets: []');
    expect(yaml).toContain('exposes: false'); // L1: no MCP server required
  });

  it('is deterministic and quotes unsafe scalars', () => {
    expect(generateManifest(blueprint)).toBe(generateManifest(blueprint));
    const named = generateManifest(blueprint, { name: 'My Console v1' });
    expect(named).toContain("name: 'My Console v1'");
  });

  it('emits an empty skills list when the spec carries none', () => {
    const bp = planBlueprint({ ...spec, sourceSkillIds: [] });
    expect(generateManifest(bp)).toContain('skills: []');
  });
});

describe('verifyBuild', () => {
  it('passes a build that matches the blueprint exactly', () => {
    const report = verifyBuild(blueprint, goodBuild());
    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(report.blueprintRef).toBe(blueprint.id);
    expect(report.specId).toBe('spec-0001');
  });

  it('fails when a planned file is missing', () => {
    const build = goodBuild();
    const report = verifyBuild(blueprint, {
      ...build,
      files: build.files.filter((f) => f !== 'src/models/order.ts'),
    });
    expect(report.ok).toBe(false);
    const failed = report.checks.find((c) => !c.ok);
    expect(failed?.name).toBe('file_manifest_complete');
    expect(failed?.detail).toContain('src/models/order.ts');
  });

  it('fails on undeclared extra files', () => {
    const build = goodBuild();
    const report = verifyBuild(blueprint, { ...build, files: [...build.files, 'src/backdoor.ts'] });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'no_undeclared_files')?.ok).toBe(false);
  });

  it('fails when the manifest was not generated from this blueprint', () => {
    const other = planBlueprint({ ...spec, id: 'spec-9999', title: 'Other' });
    const report = verifyBuild(blueprint, { ...goodBuild(), manifest: generateManifest(other) });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'manifest_blueprint_hash')?.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'manifest_spec_link')?.ok).toBe(false);
  });

  it('fails when secrets are declared non-empty', () => {
    const tampered = goodBuild().manifest.replace('secrets: []', 'secrets:\n  - api_key');
    const report = verifyBuild(blueprint, { ...goodBuild(), manifest: tampered });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'no_secrets')?.ok).toBe(false);
  });

  it('fails without a manifest file in the build', () => {
    const build = goodBuild();
    const report = verifyBuild(blueprint, {
      ...build,
      files: build.files.filter((f) => f !== 'dam.manifest.yaml'),
    });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === 'manifest_present')?.ok).toBe(false);
  });

  it('is deterministic: same inputs, same verdict', () => {
    expect(verifyBuild(blueprint, goodBuild())).toEqual(verifyBuild(blueprint, goodBuild()));
  });
});
