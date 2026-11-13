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
  requirements: z.string(),
  entities: z.array(SystemEntity).min(1),
  workflows: z.array(z.string()).default([]),
  sourceSkillIds: z.array(z.string()).default([]),
  sourceKnowledgeIds: z.array(z.string()).default([]),
  status: SystemSpecStatus,
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  approvedBy: z.string().nullable(),
});
export type SystemSpec = z.infer<typeof SystemSpec>;

export const GenerateSystemSpecInput = z.object({
  title: z.string(),
  businessDomain: z.string(),
  requirements: z.string(),
  /** Caller-supplied draft entities; when omitted the gateway drafts a scaffold entity. */
  entities: z.array(SystemEntity).min(1).optional(),
  workflows: z.array(z.string()).default([]),
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

export const SubmitSystemSpecInput = z.object({
  specId: z.string(),
});
export type SubmitSystemSpecInput = z.infer<typeof SubmitSystemSpecInput>;

export const SubmitSystemSpecOutput = z.object({
  spec: SystemSpec,
});
export type SubmitSystemSpecOutput = z.infer<typeof SubmitSystemSpecOutput>;

export const SearchSpecsInput = z.object({
  status: SystemSpecStatus.optional(),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchSpecsInput = z.infer<typeof SearchSpecsInput>;

export const SearchSpecsOutput = z.object({
  specs: z.array(SystemSpec),
});
export type SearchSpecsOutput = z.infer<typeof SearchSpecsOutput>;

export const GeneratedSystemStatus = z.enum(['registered', 'active', 'deprecated']);
export type GeneratedSystemStatus = z.infer<typeof GeneratedSystemStatus>;

export const GeneratedSystem = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  sourceSpecId: z.string(),
  endpointUri: z.string().url().nullable(),
  status: GeneratedSystemStatus,
  /** Provenance denormalized from the source spec at registration time. */
  sourceSkillIds: z.array(z.string()).default([]),
  sourceKnowledgeIds: z.array(z.string()).default([]),
  registeredBy: z.string(),
  createdAt: z.string().datetime(),
});
export type GeneratedSystem = z.infer<typeof GeneratedSystem>;

export const RegisterGeneratedSystemInput = z.object({
  sourceSpecId: z.string(),
  name: z.string(),
  version: z.string(),
  endpointUri: z.string().url().optional(),
});
export type RegisterGeneratedSystemInput = z.infer<typeof RegisterGeneratedSystemInput>;

export const RegisterGeneratedSystemOutput = z.object({
  system: GeneratedSystem,
  /** The source spec after its transition to `generated`. */
  spec: SystemSpec,
});
export type RegisterGeneratedSystemOutput = z.infer<typeof RegisterGeneratedSystemOutput>;

export const SearchSystemsInput = z.object({
  status: GeneratedSystemStatus.optional(),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchSystemsInput = z.infer<typeof SearchSystemsInput>;

export const SearchSystemsOutput = z.object({
  systems: z.array(GeneratedSystem),
});
export type SearchSystemsOutput = z.infer<typeof SearchSystemsOutput>;
