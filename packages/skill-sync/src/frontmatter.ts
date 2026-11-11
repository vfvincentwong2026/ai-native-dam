import { parse as parseYaml } from 'yaml';
import type { ParsedSkillFile } from './manifest.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Parse a SKILL.md into frontmatter data + markdown body. */
export function parseSkillMd(content: string): ParsedSkillFile | null {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return null;
  const data = parseYaml(match[1]) as unknown;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  return { data: data as Record<string, unknown>, body: content.slice(match[0].length) };
}
