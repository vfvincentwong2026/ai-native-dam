/**
 * InstallableUnit L1 manifest generator (ADR 0009 §2, ADR 0010 §4).
 *
 * `dam.manifest.yaml` is emitted deterministically from the Blueprint:
 * declarative packaging, standard /health, declared data boundary, the
 * skills the unit carries (batch-registered at install, ADR 0009 §4), and
 * an empty secrets list — hardcoded secrets are forbidden by construction.
 */

import type { Blueprint } from './blueprint.js';
import { kebab } from './plan.js';

export interface ManifestOptions {
  /** Unit name; defaults to a deterministic name derived from the blueprint id. */
  readonly name?: string;
}

/** Quote a scalar for YAML when it could parse as something else. */
function yamlScalar(value: string): string {
  return /^[a-z0-9./_-]+$/i.test(value) ? value : `'${value.replace(/'/g, "''")}'`;
}

export function generateManifest(blueprint: Blueprint, options: ManifestOptions = {}): string {
  const name = options.name ?? kebab(`system-${blueprint.id.slice(3)}`);
  const lines: string[] = [
    'apiVersion: dam.ai-native/v1',
    'kind: InstallableUnit',
    'metadata:',
    `  name: ${yamlScalar(name)}`,
    `  sourceSpec: ${yamlScalar(blueprint.specId)}`,
    `  blueprint: ${yamlScalar(blueprint.id)}`,
    `  blueprintHash: ${yamlScalar(blueprint.hash)}`,
    'packaging:',
    '  type: repo',
    'runtime:',
    `  stack: ${yamlScalar(blueprint.stack.runtime)}`,
    `  framework: ${yamlScalar(blueprint.stack.framework)}`,
    'health:',
    '  path: /health',
    'mcp:',
    '  exposes: false',
    'dataBoundary:',
    `  storage: ${yamlScalar(blueprint.stack.storage)}`,
    '  egress: []',
  ];
  if (blueprint.provenance.sourceSkillIds.length === 0) {
    lines.push('skills: []');
  } else {
    lines.push('skills:');
    for (const skillId of blueprint.provenance.sourceSkillIds) {
      lines.push(`  - id: ${yamlScalar(skillId)}`);
    }
  }
  lines.push('secrets: []');
  return `${lines.join('\n')}\n`;
}
