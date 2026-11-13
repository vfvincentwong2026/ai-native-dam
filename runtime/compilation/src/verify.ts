/**
 * verify-before-register — the deterministic gate of ADR 0010 §4.
 *
 * Runs structural checks on the generated build against its Blueprint and
 * InstallableUnit manifest. A run may only request registration when every
 * check passes; the report itself is deterministic (no clock), so identical
 * inputs always produce the identical verdict.
 */

import type { Blueprint } from './blueprint.js';

export interface VerifyCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface VerifyReport {
  readonly ok: boolean;
  readonly specId: string;
  readonly blueprintRef: string;
  readonly checks: readonly VerifyCheck[];
}

export interface BuildOutput {
  /** Paths of generated files (the code tree), relative to the unit root. */
  readonly files: readonly string[];
  /** Contents of the generated dam.manifest.yaml. */
  readonly manifest: string;
}

const MANIFEST_PATH = 'dam.manifest.yaml';

function field(manifest: string, name: string): string | null {
  const match = manifest.match(new RegExp(`^\\s*${name}:\\s*(.+?)\\s*$`, 'm'));
  if (!match) return null;
  return match[1].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}

export function verifyBuild(blueprint: Blueprint, build: BuildOutput): VerifyReport {
  const checks: VerifyCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const generated = new Set(build.files);
  const planned = blueprint.files.map((f) => f.path);

  check(
    'manifest_present',
    generated.has(MANIFEST_PATH),
    generated.has(MANIFEST_PATH) ? `${MANIFEST_PATH} generated` : `${MANIFEST_PATH} missing from build`,
  );

  check(
    'manifest_kind',
    field(build.manifest, 'kind') === 'InstallableUnit',
    `kind is ${field(build.manifest, 'kind') ?? 'absent'}`,
  );

  const specLink = field(build.manifest, 'sourceSpec');
  check(
    'manifest_spec_link',
    specLink === blueprint.specId,
    specLink === blueprint.specId ? `linked to ${specLink}` : `expected ${blueprint.specId}, got ${specLink ?? 'absent'}`,
  );

  const hash = field(build.manifest, 'blueprintHash');
  check(
    'manifest_blueprint_hash',
    hash === blueprint.hash,
    hash === blueprint.hash ? 'hash matches the planned blueprint' : 'blueprint hash mismatch — manifest not generated from this blueprint',
  );

  check(
    'health_declared',
    field(build.manifest, 'path') === '/health',
    `health path is ${field(build.manifest, 'path') ?? 'absent'}`,
  );

  check(
    'no_secrets',
    /^secrets:\s*\[\]\s*$/m.test(build.manifest),
    'secrets must be declared as an empty list (hardcoded secrets forbidden)',
  );

  const missing = planned.filter((p) => !generated.has(p));
  check(
    'file_manifest_complete',
    missing.length === 0,
    missing.length === 0 ? `all ${planned.length} planned files generated` : `missing: ${missing.join(', ')}`,
  );

  const allowed = new Set([...planned, MANIFEST_PATH]);
  const undeclared = build.files.filter((f) => !allowed.has(f));
  check(
    'no_undeclared_files',
    undeclared.length === 0,
    undeclared.length === 0 ? 'no files outside the blueprint manifest' : `undeclared: ${undeclared.join(', ')}`,
  );

  check(
    'blueprint_self_consistent',
    blueprint.id === `bp-${blueprint.hash.slice(0, 12)}`,
    'blueprint id derives from its content hash',
  );

  return {
    ok: checks.every((c) => c.ok),
    specId: blueprint.specId,
    blueprintRef: blueprint.id,
    checks,
  };
}
