/**
 * Executable verification sandbox (ADR 0010 §4 step 2, Open Question 3).
 *
 * Structural verification (`verifyBuild`) stays pure and deterministic.
 * Executable verification — install, build, smoke — needs a machine, so it
 * lives behind the `SandboxRunner` seam: `DockerSandboxRunner` runs a
 * throwaway container over the materialized build, tests inject a fake.
 *
 * The runner contract is deliberately small: three named steps, each with an
 * exit code and a log tail, first failure short-circuits (a build that does
 * not install cannot build). What "smoke" means is configurable because it
 * depends on the generated stack.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { CompiledBuild } from './compile.js';

export type SandboxStepName = 'install' | 'build' | 'smoke';

export interface SandboxStep {
  readonly name: SandboxStepName;
  readonly ok: boolean;
  readonly exitCode: number | null;
  /** Last ~500 chars of combined output, for the review UI. */
  readonly logTail: string;
}

export interface SandboxResult {
  readonly ok: boolean;
  readonly steps: readonly SandboxStep[];
}

export interface SandboxCommands {
  readonly install: string;
  readonly build: string;
  readonly smoke: string;
}

/** Defaults assume the planner's node stack; override per blueprint stack. */
export const DEFAULT_SANDBOX_COMMANDS: SandboxCommands = {
  install: 'npm install --no-audit --no-fund',
  build: 'npm run build',
  smoke: 'npm test',
};

export interface SandboxVerifyOptions {
  readonly runId: string;
  readonly commands?: Partial<SandboxCommands>;
}

export interface SandboxRunner {
  verify(workDir: string, options: SandboxVerifyOptions): Promise<SandboxResult>;
}

/**
 * Write a compiled build to a run-local directory: every generated file plus
 * the deterministic manifest. Pure I/O, no network.
 */
export async function materializeBuild(dir: string, build: CompiledBuild): Promise<void> {
  for (const file of build.files) {
    const target = join(dir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}

/** Subprocess seam — injectable so tests never spawn a container. */
export type SpawnImpl = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string },
) => Promise<{ exitCode: number | null; output: string }>;

/** Real spawn: capture combined stdout+stderr, resolve on exit. */
export const systemSpawn: SpawnImpl = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], cwd: options?.cwd });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, output }));
  });

export interface DockerSandboxOptions {
  /** Container image, e.g. node:22-alpine. */
  readonly image?: string;
  readonly spawnImpl?: SpawnImpl;
}

const STEP_ORDER: readonly SandboxStepName[] = ['install', 'build', 'smoke'];
const LOG_TAIL = 500;

/**
 * Runs each step as `docker run --rm -v <dir>:/work -w /work <image> sh -lc
 * <cmd>`. One throwaway container per step keeps state honest (node_modules
 * persists via the mounted workdir). Network stays enabled because install
 * needs a registry; hardening (egress proxy, read-only mounts) is a
 * deployment concern, noted in ADR 0010 Open Question 3.
 */
export class DockerSandboxRunner implements SandboxRunner {
  private readonly image: string;
  private readonly spawnImpl: SpawnImpl;

  constructor(options: DockerSandboxOptions = {}) {
    this.image = options.image ?? 'node:22-alpine';
    this.spawnImpl = options.spawnImpl ?? systemSpawn;
  }

  async verify(workDir: string, options: SandboxVerifyOptions): Promise<SandboxResult> {
    const commands: SandboxCommands = { ...DEFAULT_SANDBOX_COMMANDS, ...options.commands };
    const steps: SandboxStep[] = [];

    for (const name of STEP_ORDER) {
      const { exitCode, output } = await this.spawnImpl('docker', [
        'run', '--rm',
        '-v', `${workDir}:/work`,
        '-w', '/work',
        '--name', `dam-verify-${options.runId}-${name}`,
        this.image,
        'sh', '-lc', commands[name],
      ]);
      const step: SandboxStep = {
        name,
        ok: exitCode === 0,
        exitCode,
        logTail: output.slice(-LOG_TAIL),
      };
      steps.push(step);
      if (!step.ok) break; // first failure short-circuits
    }

    return { ok: steps.length === STEP_ORDER.length && steps.every((s) => s.ok), steps };
  }
}

export interface LocalSandboxOptions {
  readonly spawnImpl?: SpawnImpl;
}

/**
 * Host-execution runner: same three steps, but run directly on the build
 * host (`sh -lc`, or `cmd /d /s /c` on Windows) inside the materialized
 * workdir. NO isolation — the generated tree's install/build/test scripts
 * execute with the host user's privileges and network. Meant for dev
 * machines without a container runtime; production verification should use
 * DockerSandboxRunner (or a stronger sandbox) per ADR 0010 Open Question 3.
 */
export class LocalSandboxRunner implements SandboxRunner {
  private readonly spawnImpl: SpawnImpl;

  constructor(options: LocalSandboxOptions = {}) {
    this.spawnImpl = options.spawnImpl ?? systemSpawn;
  }

  async verify(workDir: string, options: SandboxVerifyOptions): Promise<SandboxResult> {
    const commands: SandboxCommands = { ...DEFAULT_SANDBOX_COMMANDS, ...options.commands };
    const shell = process.platform === 'win32' ? 'cmd' : 'sh';
    const shellArgs = process.platform === 'win32' ? ['/d', '/s', '/c'] : ['-lc'];
    const steps: SandboxStep[] = [];

    for (const name of STEP_ORDER) {
      const { exitCode, output } = await this.spawnImpl(shell, [...shellArgs, commands[name]], { cwd: workDir });
      const step: SandboxStep = {
        name,
        ok: exitCode === 0,
        exitCode,
        logTail: output.slice(-LOG_TAIL),
      };
      steps.push(step);
      if (!step.ok) break; // first failure short-circuits
    }

    return { ok: steps.length === STEP_ORDER.length && steps.every((s) => s.ok), steps };
  }
}
