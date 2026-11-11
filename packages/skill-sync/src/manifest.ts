import { z } from 'zod';
import { SkillDomain, SEMVER_PATTERN } from '@ai-native-dam/shared-schema';

/**
 * Industrial SKILL.md frontmatter spec. `name` and `description` follow the
 * cross-vendor Agent Skills convention (Kimi / Claude / Codex); the rest are
 * AI-Native DAM governance extensions. See docs/skill-format.md.
 */
export const SkillManifest = z.object({
  /** Lowercase slug, unique inside its domain, e.g. "script-split". */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  /** Must state the trigger conditions ("Use when ..."). */
  description: z.string().min(10),
  version: z.string().regex(SEMVER_PATTERN).default('0.1.0'),
  domain: SkillDomain.default('generic'),
  risk: z.enum(['low', 'medium', 'high']).default('low'),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type SkillManifest = z.infer<typeof SkillManifest>;

export interface ParsedSkillFile {
  /** Raw frontmatter data (unvalidated). */
  data: Record<string, unknown>;
  /** Markdown body after the frontmatter block. */
  body: string;
}
