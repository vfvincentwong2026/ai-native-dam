import { z } from 'zod';

export const Channel = z.enum([
  'x',
  'youtube',
  'instagram',
  'xiaohongshu',
  'wechat_channels',
]);
export type Channel = z.infer<typeof Channel>;

export const Territory = z.enum(['CN', 'US', 'EU', 'GLOBAL']);
export type Territory = z.infer<typeof Territory>;
