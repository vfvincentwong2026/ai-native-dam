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
  const matched = pool
    .filter(({ asset }) => {
      const haystack = `${asset.title} ${asset.tags.join(' ')}`.toLowerCase();
      return haystack.includes(q);
    })
    .filter(({ asset, rights }) => {
      if (!input.channel) return true;
      return checkUse(rights, {
        assetId: asset.id,
        channel: input.channel,
        territory: 'CN',
      }).allowed;
    });

  return {
    assets: matched.slice(0, input.limit).map(({ asset }) => asset),
    total: matched.length,
  };
}
