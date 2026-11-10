import { z } from 'zod';

export const SkillStatus = z.enum(['draft', 'pending_approval', 'approved', 'revoked']);
export type SkillStatus = z.infer<typeof SkillStatus>;

export const SkillDomain = z.enum(['ecommerce', 'short_drama', 'retail', 'content', 'generic']);
export type SkillDomain = z.infer<typeof SkillDomain>;

export const Skill = z.object({
  id: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string(),
  description: z.string(),
  domain: SkillDomain,
  sourceSopId: z.string().nullable(),
  status: SkillStatus,
  approvedAt: z.string().datetime().nullable(),
  approvedBy: z.string().nullable(),
  loraArtifactRef: z.string().nullable(),
  createdAt: z.string().datetime(),
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
