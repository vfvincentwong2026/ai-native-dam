import { describe, expect, it } from 'vitest';
import type { SystemSpec } from '@ai-native-dam/shared-schema';
import { executeBlueprint, generateManifest, planBlueprint, toBuildOutput, verifyBuild, type BlueprintCompleter, type PromptTier } from './index.js';

const SPEC: SystemSpec = {
  id: 'spec-0001',
  title: 'Drama Ops Console',
  businessDomain: 'short_drama',
  requirements: 'Ops team manages short-drama assets.',
  entities: [
    {
      name: 'drama',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'title', type: 'string', required: true },
      ],
      permissions: ['read', 'write'],
    },
  ],
  workflows: ['上架审核'],
  sourceSkillIds: ['operations:project-context'],
  sourceKnowledgeIds: [],
  status: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
  approvedAt: '2026-01-01T01:00:00.000Z',
  approvedBy: 'editor',
};

interface CapturedCall {
  runId: string;
  tier: PromptTier;
  promptSummary: string;
  prompt: string;
}

function fakeCompleter(handler?: (req: CapturedCall) => string) {
  const calls: CapturedCall[] = [];
  const completer: BlueprintCompleter = {
    async complete(req) {
      calls.push(req);
      return { text: handler?.(req) ?? `// ${req.promptSummary}` };
    },
  };
  return { calls, completer };
}

describe('executeBlueprint', () => {
  it('executes every prompt plan item in order with its planned tier', async () => {
    const blueprint = planBlueprint(SPEC);
    const { calls, completer } = fakeCompleter();

    const build = await executeBlueprint(blueprint, { runId: 'run-1', completer });

    const planned = blueprint.promptPlan;
    // every item except dam.manifest.yaml goes through the completer
    expect(calls).toHaveLength(planned.length - 1);
    expect(calls.map((c) => c.promptSummary)).toEqual(
      planned.filter((p) => p.file !== 'dam.manifest.yaml').map((p) => p.promptSummary),
    );
    // tiers route as planned: workflow file at C2, review at C3
    const reviewCall = calls.find((c) => c.promptSummary.includes('Cross-module'));
    expect(reviewCall?.tier).toBe('C3');
    expect(calls.every((c) => c.runId === 'run-1')).toBe(true);
    // the build carries every planned file
    expect(build.files.map((f) => f.path)).toEqual(blueprint.files.map((f) => f.path));
    expect(build.blueprintRef).toBe(blueprint.id);
  });

  it('never asks the LLM for dam.manifest.yaml — content is deterministic', async () => {
    const blueprint = planBlueprint(SPEC);
    const { calls, completer } = fakeCompleter();

    const build = await executeBlueprint(blueprint, { runId: 'run-1', completer });

    expect(calls.some((c) => c.promptSummary.includes('dam.manifest.yaml'))).toBe(false);
    const manifestFile = build.files.find((f) => f.path === 'dam.manifest.yaml');
    expect(manifestFile?.content).toBe(generateManifest(blueprint));
    expect(build.manifest).toBe(generateManifest(blueprint));
  });

  it('captures the C3 review as notes, not as a file', async () => {
    const blueprint = planBlueprint(SPEC);
    const { completer } = fakeCompleter((req) =>
      req.tier === 'C3' ? 'routes align with models; manifest ok' : `// ${req.promptSummary}`,
    );

    const build = await executeBlueprint(blueprint, { runId: 'run-1', completer });

    expect(build.review).toBe('routes align with models; manifest ok');
    expect(build.files.some((f) => f.path === '(review)')).toBe(false);
  });

  it('produces a build that passes the verify gate end to end', async () => {
    const blueprint = planBlueprint(SPEC);
    const { completer } = fakeCompleter();

    const build = await executeBlueprint(blueprint, { runId: 'run-1', completer });
    const report = verifyBuild(blueprint, toBuildOutput(build));

    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.ok)).toBe(true);
  });

  it('propagates completer failures unchanged (budget breaker surfaces)', async () => {
    const blueprint = planBlueprint(SPEC);
    const failing: BlueprintCompleter = {
      async complete() {
        throw new Error('run run-1 exceeded its model budget (maxCalls=2)');
      },
    };

    await expect(executeBlueprint(blueprint, { runId: 'run-1', completer: failing })).rejects.toThrow(
      /exceeded its model budget/,
    );
  });

  it('supports prompt overrides for prompt experiments', async () => {
    const blueprint = planBlueprint(SPEC);
    const { calls, completer } = fakeCompleter();

    await executeBlueprint(blueprint, {
      runId: 'run-1',
      completer,
      promptFor: (item) => `CUSTOM :: ${item.file}`,
    });

    expect(calls.every((c) => c.prompt.startsWith('CUSTOM :: '))).toBe(true);
  });
});
