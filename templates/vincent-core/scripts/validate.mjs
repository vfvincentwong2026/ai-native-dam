#!/usr/bin/env node
/**
 * Dependency-free SKILL.md sanity validator for the vincent-core repo.
 * The authoritative schema validation happens in ai-native-dam's skill-sync;
 * this script catches format mistakes before a PR is opened.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOMAINS = ['ecommerce', 'short_drama', 'retail', 'content', 'generic'];
const errors = [];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry === 'SKILL.md') yield full;
  }
}

function field(content, name) {
  const m = content.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

let count = 0;
for (const file of walk(join(ROOT, 'skills'))) {
  count++;
  const content = readFileSync(file, 'utf8');
  const rel = file.slice(ROOT.length);
  if (!content.startsWith('---')) { errors.push(`${rel}: missing frontmatter`); continue; }
  const name = field(content, 'name');
  const description = field(content, 'description');
  const version = field(content, 'version') ?? '0.1.0';
  const domain = field(content, 'domain') ?? 'generic';
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) errors.push(`${rel}: bad or missing name`);
  if (!description || description.length < 10) errors.push(`${rel}: description missing or too short`);
  if (!/^\d+\.\d+\.\d+$/.test(version)) errors.push(`${rel}: version must be semver`);
  if (!DOMAINS.includes(domain)) errors.push(`${rel}: unknown domain "${domain}"`);
}

for (const e of errors) console.error('❌', e);
console.log(errors.length === 0 ? `✅ ${count} skills valid` : `${errors.length} problem(s) in ${count} skills`);
process.exit(errors.length ? 1 : 0);
