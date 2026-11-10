import type {
  Asset,
  RightsRecord,
  SearchAssetsInput,
  SearchAssetsOutput,
} from '@ai-native-dam/shared-schema';
import { checkUse } from './rights.js';

export interface AssetWithRights {
  asset: Asset;
  rights: RightsRecord | null;
}

export function searchAssets(
  pool: AssetWithRights[],
  input: SearchAssetsInput,
): SearchAssetsOutput {
  const q = input.query.toLowerCase();
  const filtered = pool
    .filter(({ asset }) => {
      const haystack = `${asset.title} ${asset.tags.join(' ')}`.toLowerCase();
      return haystack.includes(q);
    })
    .filter(({ rights }) => {
      if (!input.channel) return true;
      return checkUse(rights, {
        assetId: '',
        channel: input.channel,
        territory: 'CN',
      }).allowed;
    })
    .slice(0, input.limit)
    .map(({ asset }) => asset);

  return { assets: filtered, total: filtered.length };
}
