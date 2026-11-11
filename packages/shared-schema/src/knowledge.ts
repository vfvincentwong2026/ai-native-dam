import { z } from 'zod';

export const KnowledgeLayer = z.enum(['raw', 'topic', 'manual', 'rule', 'qa']);
export type KnowledgeLayer = z.infer<typeof KnowledgeLayer>;

export const KnowledgeStatus = z.enum(['draft', 'pending_approval', 'approved', 'revoked']);
export type KnowledgeStatus = z.infer<typeof KnowledgeStatus>;

export const KnowledgeEntry = z.object({
  id: z.string(),
  title: z.string(),
  layer: KnowledgeLayer,
  content: z.string(),
  sourceAssetIds: z.array(z.string()).default([]),
  status: KnowledgeStatus,
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntry>;

export const SearchKnowledgeInput = z.object({
  query: z.string().min(1),
  layer: KnowledgeLayer.optional(),
  onlyApproved: z.boolean().default(true),
  limit: z.number().int().min(1).max(50).default(10),
});
export type SearchKnowledgeInput = z.infer<typeof SearchKnowledgeInput>;

export const SearchKnowledgeOutput = z.object({
  entries: z.array(KnowledgeEntry),
});
export type SearchKnowledgeOutput = z.infer<typeof SearchKnowledgeOutput>;

export const WriteKnowledgeInput = z.object({
  title: z.string(),
  layer: KnowledgeLayer,
  content: z.string(),
  sourceAssetIds: z.array(z.string()).default([]),
});
export type WriteKnowledgeInput = z.infer<typeof WriteKnowledgeInput>;

export const WriteKnowledgeOutput = z.object({
  entry: KnowledgeEntry,
});
export type WriteKnowledgeOutput = z.infer<typeof WriteKnowledgeOutput>;
