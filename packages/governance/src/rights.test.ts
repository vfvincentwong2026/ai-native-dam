import { describe, it, expect } from 'vitest';
import { checkUse } from './rights.js';
import type { RightsRecord } from '@ai-native-dam/shared-schema';

const base: RightsRecord = {
  assetId: 'a1',
  license: 'internal',
  territories: ['CN'],
  channels: ['xiaohongshu'],
  embargoUntil: null,
  expiresAt: null,
  status: 'Cleared',
};

describe('checkUse', () => {
  it('allows a cleared asset on a licensed channel and territory', () => {
    expect(
      checkUse(base, { assetId: 'a1', channel: 'xiaohongshu', territory: 'CN' }).allowed,
    ).toBe(true);
  });

  it('denies when channel is not licensed', () => {
    const out = checkUse(base, { assetId: 'a1', channel: 'x', territory: 'CN' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('channel_not_licensed');
  });

  it('denies when territory is not licensed', () => {
    const out = checkUse(base, { assetId: 'a1', channel: 'xiaohongshu', territory: 'US' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('territory_not_licensed');
  });

  it('denies when embargo is still active', () => {
    const r = { ...base, embargoUntil: '2099-01-01T00:00:00Z' };
    const out = checkUse(r, { assetId: 'a1', channel: 'xiaohongshu', territory: 'CN' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('embargo_active');
  });

  it('denies when rights have expired', () => {
    const r = { ...base, expiresAt: '2000-01-01T00:00:00Z' };
    const out = checkUse(r, { assetId: 'a1', channel: 'xiaohongshu', territory: 'CN' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('rights_expired');
  });

  it('denies when there is no rights record', () => {
    const out = checkUse(null, { assetId: 'a1', channel: 'xiaohongshu', territory: 'CN' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe('no_rights_record');
  });
});
