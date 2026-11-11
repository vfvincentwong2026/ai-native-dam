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

export const CheckUsageRightsInput = z.object({
  assetId: z.string(),
  channel: Channel,
  territory: Territory.default('CN'),
  at: z.string().datetime().optional(),
});
export type CheckUsageRightsInput = z.infer<typeof CheckUsageRightsInput>;

export const CheckUsageRightsOutput = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  replacementId: z.string().nullable(),
});
export type CheckUsageRightsOutput = z.infer<typeof CheckUsageRightsOutput>;

/**
 * @deprecated Use {@link CheckUsageRightsInput}. The `check_use` tool was
 * renamed to `check_usage_rights`; the gateway still maps the old name.
 */
export const CheckUseInput = CheckUsageRightsInput;
/** @deprecated Use {@link CheckUsageRightsInput}. */
export type CheckUseInput = CheckUsageRightsInput;
/**
 * @deprecated Use {@link CheckUsageRightsOutput}.
 */
export const CheckUseOutput = CheckUsageRightsOutput;
/** @deprecated Use {@link CheckUsageRightsOutput}. */
export type CheckUseOutput = CheckUsageRightsOutput;

export const CreateAssetInput = z.object({
  title: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().default(0),
  renditionUrl: z.string().url(),
  tags: z.array(z.string()).default([]),
  license: z.string().min(1),
});
export type CreateAssetInput = z.infer<typeof CreateAssetInput>;

export const CreateAssetOutput = z.object({
  asset: Asset,
});
export type CreateAssetOutput = z.infer<typeof CreateAssetOutput>;

export const SetRightsInput = z.object({
  assetId: z.string().min(1),
  license: z.string().min(1),
  territories: z.array(Territory).min(1),
  channels: z.array(Channel).min(1),
  embargoUntil: z.string().datetime().nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null),
  status: RightsStatus.default('Pending'),
});
export type SetRightsInput = z.infer<typeof SetRightsInput>;

export const SetRightsOutput = z.object({
  rights: RightsRecord,
});
export type SetRightsOutput = z.infer<typeof SetRightsOutput>;

export const UsageRecord = z.object({
  id: z.string(),
  assetId: z.string(),
  channel: Channel,
  territory: Territory.optional(),
  context: z.string().optional(),
  recordedAt: z.string().datetime(),
  recordedBy: z.string(),
});
export type UsageRecord = z.infer<typeof UsageRecord>;

export const RecordUsageInput = z.object({
  assetId: z.string().min(1),
  channel: Channel,
  territory: Territory.optional(),
  context: z.string().optional(),
});
export type RecordUsageInput = z.infer<typeof RecordUsageInput>;

export const RecordUsageOutput = z.object({
  usageId: z.string(),
  recorded: z.literal(true),
});
export type RecordUsageOutput = z.infer<typeof RecordUsageOutput>;
