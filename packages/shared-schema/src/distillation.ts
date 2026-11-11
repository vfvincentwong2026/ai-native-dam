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
  requestedAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
});
export type DistillationRequest = z.infer<typeof DistillationRequest>;

export const RequestDistillationInput = z.object({
  sourceSkillId: z.string(),
  reason: z.string().optional(),
});
export type RequestDistillationInput = z.infer<typeof RequestDistillationInput>;

export const RegisterLoraAdapterInput = z.object({
  sourceSkillId: z.string(),
  version: z.string(),
  adapterUri: z.string().url(),
  trainingDataUri: z.string().url(),
  baseModel: z.string(),
  metrics: z.record(z.number()).default({}),
});
export type RegisterLoraAdapterInput = z.infer<typeof RegisterLoraAdapterInput>;

export const RequestDistillationOutput = z.object({
  request: DistillationRequest,
});
export type RequestDistillationOutput = z.infer<typeof RequestDistillationOutput>;

export const LoraArtifact = z.object({
  id: z.string(),
  sourceSkillId: z.string(),
  version: z.string(),
  adapterUri: z.string().url(),
  trainingDataUri: z.string().url(),
  baseModel: z.string(),
  metrics: z.record(z.number()),
  createdAt: z.string().datetime(),
});
export type LoraArtifact = z.infer<typeof LoraArtifact>;

export const RegisterLoraAdapterOutput = z.object({
  artifact: LoraArtifact,
});
export type RegisterLoraAdapterOutput = z.infer<typeof RegisterLoraAdapterOutput>;
