import { describe, it, expect } from 'vitest';
import { ApprovalGate, InMemoryApprovalStore, approvalKey } from './approval.js';

const ARGS = { asset_id: 'a1', channel: 'x' };

describe('ApprovalGate', () => {
  it('requires a confirmation token on the first call', async () => {
    const gate = new ApprovalGate();
    const check = await gate.require('record_usage', 'alice', ARGS);
    expect(check.status).toBe('confirmation_required');
    if (check.status === 'confirmation_required') {
      expect(check.confirmationToken).toBeTruthy();
      expect(Date.parse(check.expiresAt)).toBeGreaterThan(Date.now());
    }
  });

  it('approves when the same arguments quote the token back', async () => {
    const gate = new ApprovalGate();
    const first = await gate.require('record_usage', 'alice', ARGS);
    if (first.status !== 'confirmation_required') throw new Error('expected token');
    const second = await gate.require('record_usage', 'alice', ARGS, first.confirmationToken);
    expect(second.status).toBe('approved');
  });

  it('rejects a wrong token', async () => {
    const gate = new ApprovalGate();
    await gate.require('record_usage', 'alice', ARGS);
    const check = await gate.require('record_usage', 'alice', ARGS, 'wrong-token');
    expect(check.status).toBe('invalid_token');
  });

  it('tokens are single-use', async () => {
    const gate = new ApprovalGate();
    const first = await gate.require('record_usage', 'alice', ARGS);
    if (first.status !== 'confirmation_required') throw new Error('expected token');
    await gate.require('record_usage', 'alice', ARGS, first.confirmationToken);
    const third = await gate.require('record_usage', 'alice', ARGS, first.confirmationToken);
    expect(third.status).toBe('invalid_token');
  });

  it('rejects an expired token', async () => {
    let now = 1_000_000;
    const gate = new ApprovalGate(new InMemoryApprovalStore(), 1000, () => now);
    const first = await gate.require('record_usage', 'alice', ARGS);
    if (first.status !== 'confirmation_required') throw new Error('expected token');
    now += 2000; // past the 1000ms TTL
    const check = await gate.require('record_usage', 'alice', ARGS, first.confirmationToken);
    expect(check.status).toBe('invalid_token');
  });

  it('binds tokens to the exact arguments — key order does not matter, values do', () => {
    const keyA = approvalKey('record_usage', 'alice', { a: 1, b: { c: [1, 2], d: 'x' } });
    const keyB = approvalKey('record_usage', 'alice', { b: { d: 'x', c: [1, 2] }, a: 1 });
    const keyC = approvalKey('record_usage', 'alice', { a: 1, b: { c: [1, 2], d: 'y' } });
    expect(keyA).toBe(keyB);
    expect(keyA).not.toBe(keyC);
  });

  it('different principals get different tokens for identical calls', async () => {
    const gate = new ApprovalGate();
    const first = await gate.require('record_usage', 'alice', ARGS);
    if (first.status !== 'confirmation_required') throw new Error('expected token');
    // Bob cannot spend Alice's token on the same call.
    const asBob = await gate.require('record_usage', 'bob', ARGS, first.confirmationToken);
    expect(asBob.status).toBe('invalid_token');
  });
});
