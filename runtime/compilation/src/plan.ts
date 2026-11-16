/**
 * Deterministic Spec → Blueprint planner (ADR 0010 §1, `runtime/compilation`).
 *
 * Everything here is derived from the spec by fixed rules — no LLM, no
 * randomness, no clock. The model router only enters later, executing the
 * prompt plan this blueprint carries. Determinism is the point: the same
 * approved spec must always compile to the same blueprint hash, so a
 * registration can prove what was planned.
 */

import { createHash } from 'node:crypto';
import type { SystemEntity, SystemSpec } from '@ai-native-dam/shared-schema';
import type {
  Blueprint,
  BlueprintFile,
  BlueprintModule,
  PromptPlanItem,
  PromptTier,
  StackChoice,
} from './blueprint.js';

const DEFAULT_STACK: StackChoice = {
  runtime: 'node-22',
  // Plain TypeScript service — the planned file layout (src/models,
  // src/routes, src/workflows, tests) is framework-free, so the stack must
  // be too; a nextjs label used to invite framework deps whose peers
  // conflicted (caught by the executable sandbox).
  framework: 'ts-service',
  storage: 'sqlite',
  rationale: 'default internal-service stack; self-hostable, zero external services',
};

/** Domain-specific stack overrides, matched on businessDomain keywords. */
const STACK_OVERRIDES: ReadonlyArray<{ match: RegExp; stack: StackChoice }> = [
  {
    stack: {
      runtime: 'node-22',
      framework: 'ts-service',
      storage: 'postgres',
      rationale: 'order/transaction domains need relational integrity and concurrent writers',
    },
    match: /ecommerce|retail|order/i,
  },
  {
    stack: {
      runtime: 'node-22',
      framework: 'ts-service',
      storage: 'sqlite',
      rationale: 'content-ops service: read-heavy queries over a local store',
    },
    match: /short_drama|content|drama|media/i,
  },
];

export function kebab(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unnamed';
}

/**
 * Deterministic table name for an entity slug. Generated models/routes/tests
 * are told this exact name, and src/schema.ts creates it — the LLM never
 * picks a table name again (observed drift: route said license_alert while
 * nothing created it → every CRUD call 500'd at runtime).
 */
export function tableName(slug: string): string {
  return slug.replace(/-/g, '_');
}

/**
 * Slugify a list, disambiguating collisions (`unnamed`, `unnamed-2`, …) so
 * CJK or punctuation-only names can never collapse two workflows into one file.
 */
function uniqueSlugs(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = kebab(name);
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    used.add(slug);
    return slug;
  });
}

function chooseStack(spec: SystemSpec): StackChoice {
  const hit = STACK_OVERRIDES.find((o) => o.match.test(spec.businessDomain));
  return hit ? hit.stack : DEFAULT_STACK;
}

/** HTTP verbs a route file must implement, derived from entity permissions. */
function routeVerbs(entity: SystemEntity): string[] {
  const verbs = new Set<string>();
  for (const p of entity.permissions) {
    if (p === 'read') verbs.add('GET');
    if (p === 'write') {
      verbs.add('POST');
      verbs.add('PUT');
      verbs.add('DELETE');
    }
  }
  return verbs.size ? [...verbs].sort() : ['GET'];
}

function planModules(spec: SystemSpec, entitySlugs: string[], workflowSlugs: string[]): BlueprintModule[] {
  const modules: BlueprintModule[] = [
    {
      name: 'core',
      kind: 'core',
      purpose:
        'App shell, dam.manifest.yaml (InstallableUnit L1), standard /health endpoint',
      entityRefs: [],
      workflowRefs: [],
    },
  ];
  spec.entities.forEach((entity, i) => {
    modules.push({
      name: `entity:${entitySlugs[i]}`,
      kind: 'entity',
      purpose: `Model + CRUD surface for ${entity.name} (${entity.fields.length} fields, verbs: ${routeVerbs(entity).join('/')})`,
      entityRefs: [entity.name],
      workflowRefs: [],
    });
  });
  spec.workflows.forEach((workflow, i) => {
    modules.push({
      name: `workflow:${workflowSlugs[i]}`,
      kind: 'workflow',
      purpose: `Workflow automation: ${workflow}`,
      entityRefs: [],
      workflowRefs: [workflow],
    });
  });
  return modules;
}

function planFiles(
  spec: SystemSpec,
  modules: readonly BlueprintModule[],
  entitySlugs: string[],
  workflowSlugs: string[],
): BlueprintFile[] {
  const files: BlueprintFile[] = [
    {
      path: 'dam.manifest.yaml',
      kind: 'manifest',
      module: 'core',
      purpose: 'InstallableUnit L1 manifest: resources, MCP endpoints, health check, data boundary',
      tier: 'C0',
    },
    {
      path: 'package.json',
      kind: 'config',
      module: 'core',
      purpose:
        'Package manifest: scripts build (tsc -p tsconfig.json) and test (vitest run); ' +
        'dependencies declared as caret ranges on well-known existing versions',
      tier: 'C0',
    },
    {
      path: 'tsconfig.json',
      kind: 'config',
      module: 'core',
      purpose: 'TypeScript compiler config: strict, ESNext modules with Bundler resolution, .ts extension imports, noEmit (type-check only)',
      tier: 'C0',
    },
    {
      path: 'src/server.ts',
      kind: 'core',
      module: 'core',
      purpose:
        'Deterministic server entry (never LLM-generated): node:http server mounting /health plus every ' +
        'route module\'s handle() in blueprint order, 404 fallback, PORT env (default 3000)',
      tier: 'C0',
    },
    {
      path: 'src/contract.ts',
      kind: 'contract',
      module: 'core',
      purpose:
        'Deterministic route contract types (never LLM-generated): DamRequest/DamResponse minimal ' +
        'structural shapes + RouteHandle — mocks in tests type-check against these, not node:http classes',
      tier: 'C0',
    },
    {
      path: 'src/schema.ts',
      kind: 'core',
      module: 'core',
      purpose:
        'Deterministic schema (never LLM-generated): ensureSchema(db) creates every entity table ' +
        '(CREATE TABLE IF NOT EXISTS) from the planned entity bindings; server.ts calls it at boot',
      tier: 'C0',
    },
    {
      path: 'console/index.html',
      kind: 'core',
      module: 'core',
      purpose:
        'Deterministic management console SPA (never LLM-generated): sidebar + one generic JSON-table ' +
        'view per entity, fetched from the fixed route path /<table>; served by server.ts at /console/',
      tier: 'C0',
    },
    {
      path: 'README.md',
      kind: 'doc',
      module: 'core',
      purpose: `Generated system README: purpose, spec link (${spec.id}), run instructions`,
      tier: 'C0',
    },
  ];
  spec.entities.forEach((entity, i) => {
    const slug = entitySlugs[i];
    const module = `entity:${slug}`;
    // Same binding on all three files so the compiler can emit src/schema.ts
    // and every prompt can state the exact table the code must use.
    const binding = {
      table: tableName(slug),
      fields: entity.fields.map((f) => ({ name: f.name, type: f.type, required: f.required })),
    };
    files.push(
      {
        path: `src/models/${slug}.ts`,
        kind: 'model',
        module,
        purpose: `${entity.name} schema: ${entity.fields.map((f) => `${f.name}:${f.type}`).join(', ')}`,
        tier: 'C1',
        entity: binding,
      },
      {
        path: `src/routes/${slug}.ts`,
        kind: 'route',
        module,
        purpose: `${entity.name} CRUD routes (${routeVerbs(entity).join(' ')})`,
        tier: 'C1',
        entity: binding,
      },
      {
        path: `tests/${slug}.test.ts`,
        kind: 'test',
        module,
        purpose: `Route-level smoke tests for ${entity.name}`,
        tier: 'C1',
        entity: binding,
      },
    );
  });
  spec.workflows.forEach((workflow, i) => {
    files.push({
      path: `src/workflows/${workflowSlugs[i]}.ts`,
      kind: 'workflow',
      module: `workflow:${workflowSlugs[i]}`,
      purpose: `Workflow logic: ${workflow}`,
      tier: 'C2',
    });
  });
  // Every file's module must exist — a broken reference is a planner bug.
  const moduleNames = new Set(modules.map((m) => m.name));
  for (const f of files) {
    if (!moduleNames.has(f.module)) {
      throw new Error(`planner bug: file ${f.path} references unknown module ${f.module}`);
    }
  }
  return files;
}

function planPrompts(spec: SystemSpec, files: readonly BlueprintFile[]): PromptPlanItem[] {
  const items: PromptPlanItem[] = files.map((f) => ({
    file: f.path,
    tier: f.tier,
    promptSummary: `Generate ${f.path} (${f.kind}) for '${spec.title}': ${f.purpose}`,
  }));
  items.push({
    file: '(review)',
    tier: 'C3',
    promptSummary: `Cross-module consistency review for '${spec.title}': imports resolve, route/model field alignment, manifest matches actual endpoints`,
  });
  return items;
}

/** Stable JSON: object keys sorted recursively so hashing is deterministic. */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Compile an approved spec into a deterministic Blueprint. */
export function planBlueprint(spec: SystemSpec): Blueprint {
  const stack = chooseStack(spec);
  const entitySlugs = uniqueSlugs(spec.entities.map((e) => e.name));
  const workflowSlugs = uniqueSlugs(spec.workflows);
  const modules = planModules(spec, entitySlugs, workflowSlugs);
  const files = planFiles(spec, modules, entitySlugs, workflowSlugs);
  const promptPlan = planPrompts(spec, files);
  const provenance = {
    sourceSkillIds: spec.sourceSkillIds,
    sourceKnowledgeIds: spec.sourceKnowledgeIds,
  };
  const content = { specId: spec.id, stack, modules, files, promptPlan, provenance };
  const hash = createHash('sha256').update(canonicalize(content)).digest('hex');
  return { id: `bp-${hash.slice(0, 12)}`, hash, ...content };
}
