import { z } from 'zod';

/** Full semver incl. prerelease/build tags (e.g. 1.0.0-neutral, 2.1.0+build.5). */
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export const SkillStatus = z.enum(['draft', 'pending_approval', 'approved', 'revoked']);
export type SkillStatus = z.infer<typeof SkillStatus>;

export const SkillDomain = z.enum(['ecommerce', 'short_drama', 'retail', 'content', 'operations', 'generic']);
export type SkillDomain = z.infer<typeof SkillDomain>;

export const SkillId = z.string().regex(/^[a-z0-9][a-z0-9:_-]*$/);
export type SkillId = z.infer<typeof SkillId>;

export const Skill = z.object({
  id: SkillId,
  version: z.string().regex(SEMVER_PATTERN),
  name: z.string(),
  description: z.string(),
  domain: SkillDomain,
  sourceSopId: z.string().nullable(),
  status: SkillStatus,
  approvedAt: z.string().datetime().nullable(),
  approvedBy: z.string().nullable(),
  loraArtifactRef: z.string().nullable(),
  createdAt: z.string().datetime(),
  // Provenance: git is the source of truth; the registry governs the pointer.
  sourceRepo: z.string().url().nullable(),
  sourcePath: z.string().nullable(),
  sourceCommit: z.string().nullable(),
});
export type Skill = z.infer<typeof Skill>;

export const SearchSkillsInput = z.object({
  domain: SkillDomain.optional(),
  query: z.string().optional(),
  onlyApproved: z.boolean().default(true),
});
export type SearchSkillsInput = z.infer<typeof SearchSkillsInput>;

export const SearchSkillsOutput = z.object({
  skills: z.array(Skill),
});
export type SearchSkillsOutput = z.infer<typeof SearchSkillsOutput>;

export const ApplySkillInput = z.object({
  skillId: z.string(),
  version: z.string(),
  targetSystemId: z.string(),
  context: z.string(),
});
export type ApplySkillInput = z.infer<typeof ApplySkillInput>;

export const ApplySkillOutput = z.object({
  usageId: z.string(),
  applied: z.boolean(),
  reason: z.string().optional(),
});
export type ApplySkillOutput = z.infer<typeof ApplySkillOutput>;

export const RegisterSkillInput = z.object({
  id: SkillId,
  version: z.string().regex(SEMVER_PATTERN),
  name: z.string().min(1),
  description: z.string().min(10),
  domain: SkillDomain.default('generic'),
  sourceRepo: z.string().url().nullable().default(null),
  sourcePath: z.string().nullable().default(null),
  sourceCommit: z.string().nullable().default(null),
});
export type RegisterSkillInput = z.infer<typeof RegisterSkillInput>;

export const RegisterSkillOutput = z.object({
  skill: Skill,
});
export type RegisterSkillOutput = z.infer<typeof RegisterSkillOutput>;
