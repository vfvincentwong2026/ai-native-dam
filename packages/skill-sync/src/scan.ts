import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** Recursively find every SKILL.md under root. Returns absolute paths, sorted. */
export async function scanSkillFiles(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        found.push(full);
      }
    }
  }

  await walk(root);
  return found.sort();
}

/** Path of a skill inside its repo, forward slashes, no leading "./". */
export function skillRelativePath(root: string, file: string): string {
  return relative(root, file).split('\\').join('/');
}
