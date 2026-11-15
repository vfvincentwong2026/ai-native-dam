import { describe, expect, it } from 'vitest';
import type { SystemSpec } from '@ai-native-dam/shared-schema';
import { executeBlueprint, generateManifest, generateSchema, generateServer, generateTsconfig, isDeterministicPath, planBlueprint, toBuildOutput, verifyBuild, type BlueprintCompleter, type PromptTier } from './index.js';

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
    // every item except the five deterministic files goes through the completer
    expect(calls).toHaveLength(planned.length - 5);
    expect(calls.map((c) => c.promptSummary)).toEqual(
      planned.filter((p) => !['dam.manifest.yaml', 'tsconfig.json', 'src/contract.ts', 'src/schema.ts', 'src/server.ts'].includes(p.file)).map((p) => p.promptSummary),
    );
    // tiers route as planned: workflow file at C2, review at C3
    const reviewCall = calls.find((c) => c.promptSummary.includes('Cross-module'));
    expect(reviewCall?.tier).toBe('C3');
    expect(calls.every((c) => c.runId === 'run-1')).toBe(true);
    // the build carries every planned file
    expect(build.files.map((f) => f.path)).toEqual(blueprint.files.map((f) => f.path));
    expect(build.blueprintRef).toBe(blueprint.id);
  });

  it('never asks the LLM for dam.manifest.yaml or tsconfig.json — both are deterministic', async () => {
    const blueprint = planBlueprint(SPEC);
    const { calls, completer } = fakeCompleter();

    const build = await executeBlueprint(blueprint, { runId: 'run-1', completer });

    expect(calls.some((c) => c.promptSummary.includes('dam.manifest.yaml'))).toBe(false);
    // other files' purposes legitimately mention tsconfig.json — assert the
    // tsconfig plan item itself was never sent, via its own promptSummary
    const tsconfigItem = blueprint.promptPlan.find((p) => p.file === 'tsconfig.json');
    expect(tsconfigItem).toBeDefined();
    expect(calls.some((c) => c.promptSummary === tsconfigItem!.promptSummary)).toBe(false);
    const serverItem = blueprint.promptPlan.find((p) => p.file === 'src/server.ts');
    expect(serverItem).toBeDefined();
    expect(calls.some((c) => c.promptSummary === serverItem!.promptSummary)).toBe(false);
    const manifestFile = build.files.find((f) => f.path === 'dam.manifest.yaml');
    expect(manifestFile?.content).toBe(generateManifest(blueprint));
    expect(build.manifest).toBe(generateManifest(blueprint));
    const tsconfig = build.files.find((f) => f.path === 'tsconfig.json');
    expect(tsconfig?.content).toBe(generateTsconfig());
    expect(tsconfig?.content).toContain('src/**/*.ts');
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


describe('stripCodeFences', () => {
  it('strips a whole-body markdown fence so generated code compiles', async () => {
    const blueprint = planBlueprint(SPEC);
    const completer: BlueprintCompleter = {
      async complete(req) {
        return { text: `\`\`\`typescript\n// ${req.promptSummary}\n\`\`\`\n` };
      },
    };

    const build = await executeBlueprint(blueprint, { runId: 'run-fences', completer });

    const generated = build.files.filter((f) => !['dam.manifest.yaml', 'tsconfig.json', 'src/contract.ts', 'src/schema.ts', 'src/server.ts'].includes(f.path));
    expect(generated.length).toBeGreaterThan(0);
    for (const f of generated) {
      expect(f.content.startsWith('```')).toBe(false);
      expect(f.content.endsWith('```')).toBe(false);
      expect(f.content).toContain(f.promptSummary);
    }
  });

  it('leaves unfenced and partially fenced content untouched', async () => {
    const blueprint = planBlueprint(SPEC);
    const plain = 'export const x = 1;\n';
    const partial = '```ts\nexport const x = 1;\n'; // no closing fence
    const completer: BlueprintCompleter = {
      async complete(req) {
        return { text: req.tier === 'C0' ? plain : partial };
      },
    };

    const build = await executeBlueprint(blueprint, { runId: 'run-plain', completer });

    const c0 = build.files.find((f) => f.path === 'package.json');
    expect(c0?.content).toBe(plain);
    // src/health.ts is C0 too — pick a C1 file explicitly (models are C1)
    const c1 = build.files.find((f) => f.path.startsWith('src/models/'));
    expect(c1?.content).toBe(partial);
  });

  it('drops a leading filename line before stripping the fence (observed LLM shape)', async () => {
    const blueprint = planBlueprint(SPEC);
    // The completer echoes the actual item path as a first line, then wraps
    // the body in a fence — exactly what the sandbox observed in the wild.
    const echoing: BlueprintCompleter = {
      async complete(req) {
        const file = /Generate the file (.+)\./.exec(req.prompt)?.[1] ?? 'unknown';
        if (req.tier === 'C3') return { text: 'ok' };
        return { text: `${file}\n\`\`\`typescript\n// ${req.promptSummary}\n\`\`\`\n` };
      },
    };

    const build = await executeBlueprint(blueprint, { runId: 'run-pathline', completer: echoing });

    const generated = build.files.filter((f) => !['dam.manifest.yaml', 'tsconfig.json', 'src/contract.ts', 'src/schema.ts', 'src/server.ts'].includes(f.path));
    for (const f of generated) {
      expect(f.content.startsWith('```')).toBe(false);
      expect(f.content.split('\n')[0]).not.toBe(f.path);
      expect(f.content).toContain(f.promptSummary);
    }
  });
});

describe('generateServer', () => {
  it('wires every planned route module behind /health, deterministically', () => {
    const blueprint = planBlueprint(SPEC);
    const server = generateServer(blueprint);
    const routes = blueprint.files.filter((f) => f.kind === 'route');

    // one aliased import per route, pointing at the emitted .js path
    for (const [i, r] of routes.entries()) {
      expect(server).toContain(`import { handle as handle${i} } from './${r.path.replace(/^src\//, '')}';`);
    }
    expect(server).toContain(`const handlers: RouteHandle[] = [${routes.map((_, i) => `handle${i}`).join(', ')}];`);
    expect(server).toContain("'/health'");
    expect(server).toContain('process.env.PORT');
    // deterministic: same blueprint, same bytes
    expect(generateServer(blueprint)).toBe(server);
    expect(isDeterministicPath('src/server.ts')).toBe(true);
    expect(isDeterministicPath('src/routes/drama.ts')).toBe(false);
  });

  it('applies the deterministic schema before serving', () => {
    const server = generateServer(planBlueprint(SPEC));
    expect(server).toContain(`import { ensureSchema } from './schema.ts';`);
    expect(server).toContain('ensureSchema(db);');
  });
});

describe('generateSchema', () => {
  it('emits CREATE TABLE IF NOT EXISTS for every planned entity table', () => {
    const blueprint = planBlueprint(SPEC);
    const schema = generateSchema(blueprint);

    expect(schema).toContain('export function ensureSchema(db: DatabaseSync): void');
    expect(schema).toContain(
      'CREATE TABLE IF NOT EXISTS drama (id TEXT PRIMARY KEY, title TEXT NOT NULL)',
    );
    // deterministic: same blueprint, same bytes; schema never goes to the LLM
    expect(generateSchema(blueprint)).toBe(schema);
    expect(isDeterministicPath('src/schema.ts')).toBe(true);
  });

  it('maps every spec field type onto a SQLite affinity', () => {
    const spec: SystemSpec = {
      ...SPEC,
      entities: [
        {
          name: 'asset',
          fields: [
            { name: 'id', type: 'string', required: true },
            { name: 'size', type: 'number', required: false },
            { name: 'active', type: 'boolean', required: true },
            { name: 'expiresAt', type: 'datetime', required: false },
            { name: 'meta', type: 'json', required: false },
          ],
          permissions: ['read'],
        },
      ],
    };
    const schema = generateSchema(planBlueprint(spec));
    expect(schema).toContain(
      'CREATE TABLE IF NOT EXISTS asset (id TEXT PRIMARY KEY, size REAL, active INTEGER NOT NULL, expiresAt TEXT, meta TEXT)',
    );
  });

  it('refuses identifiers that are not plain SQL (injection guard)', () => {
    const spec: SystemSpec = {
      ...SPEC,
      entities: [
        {
          name: 'evil',
          fields: [{ name: 'x"); DROP TABLE t; --', type: 'string', required: true }],
          permissions: ['read'],
        },
      ],
    };
    expect(() => generateSchema(planBlueprint(spec))).toThrow(/not a plain SQL identifier/);
  });

  it('tells model/route/test prompts the exact planned table and bans CREATE TABLE', async () => {
    const blueprint = planBlueprint(SPEC);
    const { calls, completer } = fakeCompleter();
    await executeBlueprint(blueprint, { runId: 'run-tbl', completer });

    for (const kind of ['src/models/', 'src/routes/', 'tests/']) {
      const call = calls.find((c) => c.prompt.includes(`Generate the file ${kind}drama`));
      expect(call?.prompt).toContain('Table contract: SQLite table "drama" ALREADY EXISTS');
      expect(call?.prompt).toContain('NEVER write CREATE TABLE');
    }
    // tests must build the schema on their in-memory db themselves
    const test = calls.find((c) => c.prompt.includes('Generate the file tests/drama'));
    expect(test?.prompt).toContain('ensureSchema(db)');
  });
});
