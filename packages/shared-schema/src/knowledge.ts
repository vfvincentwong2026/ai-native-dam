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

/**
 * Native brief-pack request from an execution plane (e.g. Nexus-Ecom-Matrix).
 * Lands as a pending_approval knowledge entry of type dam_brief_pack_request;
 * approval moves it into the DAM content pipeline. Previously emulated by
 * callers via write_knowledge — this tool keeps the semantics explicit.
 */
export const TriggerDamBriefPackInput = z.object({
  campaignId: z.string().min(1),
  skuId: z.string().min(1),
  creatorIds: z.array(z.string()).default([]),
});
export type TriggerDamBriefPackInput = z.infer<typeof TriggerDamBriefPackInput>;

export const WriteKnowledgeOutput = z.object({
  entry: KnowledgeEntry,
});
export type WriteKnowledgeOutput = z.infer<typeof WriteKnowledgeOutput>;

export const ApproveKnowledgeInput = z.object({
  id: z.string().min(1),
});
export type ApproveKnowledgeInput = z.infer<typeof ApproveKnowledgeInput>;

export const ApproveKnowledgeOutput = z.object({
  entry: KnowledgeEntry,
});
export type ApproveKnowledgeOutput = z.infer<typeof ApproveKnowledgeOutput>;
