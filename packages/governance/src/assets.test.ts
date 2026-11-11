import { describe, it, expect } from 'vitest';
import { searchAssets, type AssetWithRights } from './assets.js';
import type { Asset, RightsRecord } from '@ai-native-dam/shared-schema';

function makeAsset(id: string, title: string, tags: string[] = []): Asset {
  return {
    id,
    title,
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    tags,
    renditionUrl: `https://example.com/${id}.jpg`,
    rightsStatus: 'Cleared',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function makeRights(assetId: string, channels: string[] = ['xiaohongshu']): RightsRecord {
  return {
    assetId,
    license: 'internal',
    territories: ['CN'],
    channels: channels as RightsRecord['channels'],
    embargoUntil: null,
    expiresAt: null,
    status: 'Cleared',
  };
}

const pool: AssetWithRights[] = [
  { asset: makeAsset('a1', 'Summer campaign hero', ['summer', 'hero']), rights: makeRights('a1') },
  { asset: makeAsset('a2', 'Summer product video', ['summer', 'video']), rights: makeRights('a2', ['x']) },
  { asset: makeAsset('a3', 'Winter lookbook', ['winter']), rights: null },
];

describe('searchAssets', () => {
  it('matches on title and tags, case-insensitive', () => {
    const out = searchAssets(pool, { query: 'SUMMER', limit: 20 });
    expect(out.total).toBe(2);
    expect(out.assets.map(a => a.id).sort()).toEqual(['a1', 'a2']);
  });

  it('total is the pre-pagination match count', () => {
    const out = searchAssets(pool, { query: 'summer', limit: 1 });
    expect(out.assets.length).toBe(1);
    expect(out.total).toBe(2);
  });

  it('filters by channel rights when a channel is given', () => {
    const out = searchAssets(pool, { query: 'summer', channel: 'xiaohongshu', limit: 20 });
    expect(out.assets.map(a => a.id)).toEqual(['a1']);
    expect(out.total).toBe(1);
  });

  it('excludes assets with no rights record when channel filtering', () => {
    const out = searchAssets(pool, { query: 'winter', channel: 'xiaohongshu', limit: 20 });
    expect(out.total).toBe(0);
  });
});
