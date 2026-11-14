import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DockerSandboxRunner,
  materializeBuild,
  type CompiledBuild,
  type SpawnImpl,
} from './index.js';

const BUILD: CompiledBuild = {
  blueprintRef: 'bp-abc123',
  files: [
    { path: 'dam.manifest.yaml', content: 'kind: InstallableUnit\n', tier: 'C0', promptSummary: 'm' },
    { path: 'package.json', content: '{}\n', tier: 'C0', promptSummary: 'p' },
    { path: 'src/models/order.ts', content: 'export {}\n', tier: 'C1', promptSummary: 'mo' },
  ],
  manifest: 'kind: InstallableUnit\n',
  review: '',
};

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dam-sandbox-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe('materializeBuild', () => {
  it('writes every generated file, creating nested directories', async () => {
    const dir = await tempDir();
    await materializeBuild(dir, BUILD);

    expect(await readFile(join(dir, 'dam.manifest.yaml'), 'utf8')).toBe('kind: InstallableUnit\n');
    expect(await readFile(join(dir, 'src/models/order.ts'), 'utf8')).toBe('export {}\n');
  });
});

describe('DockerSandboxRunner', () => {
  function fakeSpawn(exitCodes: Record<string, number>) {
    const seen: { command: string; args: string[] }[] = [];
    const spawnImpl: SpawnImpl = async (command, args) => {
      seen.push({ command, args: [...args] });
      const name = args[args.indexOf('--name') + 1]; // dam-verify-<run>-<step>
      const step = name.split('-').pop()!;
      return { exitCode: exitCodes[step] ?? 0, output: `output of ${step}` };
    };
    return { seen, spawnImpl };
  }

  it('runs install → build → smoke in order inside throwaway containers', async () => {
    const { seen, spawnImpl } = fakeSpawn({});
    const runner = new DockerSandboxRunner({ image: 'node:22-alpine', spawnImpl });

    const result = await runner.verify('/tmp/run-1', { runId: 'run-1' });

    expect(result.ok).toBe(true);
    expect(result.steps.map((s) => s.name)).toEqual(['install', 'build', 'smoke']);
    expect(seen).toHaveLength(3);
    for (const call of seen) {
      expect(call.command).toBe('docker');
      expect(call.args).toContain('--rm');
      expect(call.args).toContain('-v');
      expect(call.args[call.args.indexOf('-v') + 1]).toBe('/tmp/run-1:/work');
    }
    expect(seen[0].args.at(-1)).toBe('npm install --no-audit --no-fund');
    expect(seen[2].args.at(-1)).toBe('npm test');
  });

  it('short-circuits on the first failing step and keeps the log tail', async () => {
    const { seen, spawnImpl } = fakeSpawn({ build: 2 });
    const runner = new DockerSandboxRunner({ spawnImpl });

    const result = await runner.verify('/tmp/run-2', { runId: 'run-2' });

    expect(result.ok).toBe(false);
    expect(result.steps.map((s) => s.name)).toEqual(['install', 'build']);
    expect(result.steps[1].exitCode).toBe(2);
    expect(result.steps[1].logTail).toBe('output of build');
    // smoke never ran
    expect(seen.some((c) => c.args.join(' ').includes('npm test'))).toBe(false);
  });

  it('honours command overrides for non-default stacks', async () => {
    const { seen, spawnImpl } = fakeSpawn({});
    const runner = new DockerSandboxRunner({ spawnImpl });

    await runner.verify('/tmp/run-3', { runId: 'run-3', commands: { smoke: 'node dist/health.js' } });

    expect(seen[2].args.at(-1)).toBe('node dist/health.js');
  });
});
