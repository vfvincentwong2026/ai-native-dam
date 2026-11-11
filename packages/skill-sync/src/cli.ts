#!/usr/bin/env node
/**
 * skill-sync — scan a skill repository and register every SKILL.md into the
 * AI-Native DAM Skill Registry.
 *
 * Usage:
 *   skill-sync <dir> [--dry-run]
 *   skill-sync <dir> --gateway http://localhost:8080 --token <edit-token>
 */
import { syncSkills } from './sync.js';

function parseArgs(argv: string[]) {
  const args: { dir?: string; gateway?: string; token?: string; dryRun: boolean } = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--gateway') args.gateway = argv[++i];
    else if (a === '--token') args.token = argv[++i];
    else if (!a.startsWith('--')) args.dir = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.dir) {
  console.error('usage: skill-sync <dir> [--dry-run] [--gateway URL --token TOKEN]');
  process.exit(1);
}

const records = await syncSkills(args.dir, {
  gatewayUrl: args.gateway,
  token: args.token ?? process.env.DAM_TOKEN,
  dryRun: args.dryRun,
});

for (const r of records) {
  if (r.ok) {
    const id = r.registration ? `${r.registration.id}@${r.registration.version}` : '';
    console.log(`${r.registered ? '✅ registered' : '🔍 valid    '}  ${id}  (${r.file})`);
  } else {
    console.error(`❌ invalid    ${r.file}: ${r.error}`);
  }
}

const failed = records.filter(r => !r.ok).length;
console.log(`\n${records.length - failed}/${records.length} skills ok${args.dryRun ? ' (dry run)' : ''}`);
process.exit(failed > 0 ? 1 : 0);
