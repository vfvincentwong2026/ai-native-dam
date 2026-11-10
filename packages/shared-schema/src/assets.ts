import { z } from 'zod';
import { Channel, Territory } from './channels.js';

export const RightsStatus = z.enum(['Cleared', 'Restricted', 'Expired', 'Pending']);
export type RightsStatus = z.infer<typeof RightsStatus>;

export const Asset = z.object({
  id: z.string(),
  title: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  tags: z.array(z.string()).default([]),
  renditionUrl: z.string().url(),
  rightsStatus: RightsStatus,
  createdAt: z.string().datetime(),
});
export type Asset = z.infer<typeof Asset>;

export const RightsRecord = z.object({
  assetId: z.string(),
  license: z.string(),
  territories: z.array(Territory).min(1),
  channels: z.array(Channel).min(1),
  embargoUntil: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  status: RightsStatus,
});
export type RightsRecord = z.infer<typeof RightsRecord>;

export const SearchAssetsInput = z.object({
  query: z.string().min(1),
  channel: Channel.optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type SearchAssetsInput = z.infer<typeof SearchAssetsInput>;

export const SearchAssetsOutput = z.object({
  assets: z.array(Asset),
  total: z.number().int().nonnegative(),
});
export type SearchAssetsOutput = z.infer<typeof SearchAssetsOutput>;

export const CheckUseInput = z.object({
  assetId: z.string(),
  channel: Channel,
  territory: Territory.default('CN'),
  at: z.string().datetime().optional(),
});
export type CheckUseInput = z.infer<typeof CheckUseInput>;

export const CheckUseOutput = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  replacementId: z.string().nullable(),
});
export type CheckUseOutput = z.infer<typeof CheckUseOutput>;
