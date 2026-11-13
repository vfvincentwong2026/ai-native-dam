import { z } from 'zod';

export const DistillationStatus = z.enum([
  'queued',
  'awaiting_approval',
  'training',
  'completed',
  'failed',
  'rejected',
]);
export type DistillationStatus = z.infer<typeof DistillationStatus>;

export const DistillationRequest = z.object({
  id: z.string(),
  sourceSkillId: z.string(),
  usageCount: z.number().int().nonnegative(),
  threshold: z.number().int().positive(),
  status: DistillationStatus,
  reason: z.string().nullable(),
  requestedBy: z.string(),
  requestedAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  approvedBy: z.string().nullable(),
});
export type DistillationRequest = z.infer<typeof DistillationRequest>;

export const RequestDistillationInput = z.object({
  sourceSkillId: z.string(),
  reason: z.string().optional(),
});
export type RequestDistillationInput = z.infer<typeof RequestDistillationInput>;

export const RequestDistillationOutput = z.object({
  request: DistillationRequest,
});
export type RequestDistillationOutput = z.infer<typeof RequestDistillationOutput>;

export const ApproveDistillationInput = z.object({
  requestId: z.string(),
  decision: z.enum(['approve', 'reject']),
});
export type ApproveDistillationInput = z.infer<typeof ApproveDistillationInput>;

export const ApproveDistillationOutput = z.object({
  request: DistillationRequest,
});
export type ApproveDistillationOutput = z.infer<typeof ApproveDistillationOutput>;

export const SearchDistillationsInput = z.object({
  status: DistillationStatus.optional(),
  sourceSkillId: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchDistillationsInput = z.infer<typeof SearchDistillationsInput>;

export const SearchDistillationsOutput = z.object({
  requests: z.array(DistillationRequest),
});
export type SearchDistillationsOutput = z.infer<typeof SearchDistillationsOutput>;

export const RegisterLoraAdapterInput = z.object({
  sourceSkillId: z.string(),
  version: z.string(),
  adapterUri: z.string().url(),
  trainingDataUri: z.string().url(),
  baseModel: z.string(),
  metrics: z.record(z.number()).default({}),
});
export type RegisterLoraAdapterInput = z.infer<typeof RegisterLoraAdapterInput>;

export const LoraArtifact = z.object({
  id: z.string(),
  sourceSkillId: z.string(),
  version: z.string(),
  adapterUri: z.string().url(),
  trainingDataUri: z.string().url(),
  baseModel: z.string(),
  metrics: z.record(z.number()),
  registeredBy: z.string(),
  createdAt: z.string().datetime(),
});
export type LoraArtifact = z.infer<typeof LoraArtifact>;

export const RegisterLoraAdapterOutput = z.object({
  artifact: LoraArtifact,
});
export type RegisterLoraAdapterOutput = z.infer<typeof RegisterLoraAdapterOutput>;
