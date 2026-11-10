import { z } from 'zod';

export const SystemSpecStatus = z.enum([
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'generated',
]);
export type SystemSpecStatus = z.infer<typeof SystemSpecStatus>;

export const SystemEntity = z.object({
  name: z.string(),
  fields: z.array(z.object({
    name: z.string(),
    type: z.enum(['string', 'number', 'boolean', 'datetime', 'json']),
    required: z.boolean(),
    description: z.string().optional(),
  })),
  permissions: z.array(z.string()).default(['read']),
});
export type SystemEntity = z.infer<typeof SystemEntity>;

export const SystemSpec = z.object({
  id: z.string(),
  title: z.string(),
  businessDomain: z.string(),
  entities: z.array(SystemEntity).min(1),
  workflows: z.array(z.string()).default([]),
  sourceSkillIds: z.array(z.string()).default([]),
  sourceKnowledgeIds: z.array(z.string()).default([]),
  status: SystemSpecStatus,
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
});
export type SystemSpec = z.infer<typeof SystemSpec>;

export const GenerateSystemSpecInput = z.object({
  title: z.string(),
  businessDomain: z.string(),
  requirements: z.string(),
  sourceSkillIds: z.array(z.string()).default([]),
  sourceKnowledgeIds: z.array(z.string()).default([]),
});
export type GenerateSystemSpecInput = z.infer<typeof GenerateSystemSpecInput>;

export const GenerateSystemSpecOutput = z.object({
  specId: z.string(),
  status: SystemSpecStatus,
  spec: SystemSpec,
});
export type GenerateSystemSpecOutput = z.infer<typeof GenerateSystemSpecOutput>;
