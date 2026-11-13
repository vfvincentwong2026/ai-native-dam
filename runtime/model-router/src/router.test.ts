import { describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  ModelRouter,
  RouterTransportError,
  SquillaHttpTransport,
  type ModelTransport,
  type TransportCall,
} from './index.js';

/** Offline transport: fixed token counts, records every call it receives. */
function fakeTransport(result: { text?: string; model?: string; inputTokens?: number; outputTokens?: number } = {}) {
  const calls: TransportCall[] = [];
  const transport: ModelTransport = {
    async complete(call) {
      calls.push(call);
      return {
        text: result.text ?? 'generated',
        model: result.model ?? call.model,
        inputTokens: result.inputTokens ?? 10,
        outputTokens: result.outputTokens ?? 20,
      };
    },
  };
  return { calls, transport };
}

const REQ = { runId: 'run-1', promptSummary: 'generate model order', prompt: '...' };

describe('ModelRouter', () => {
  it('routes each tier to its configured model', async () => {
    const { calls, transport } = fakeTransport();
    const router = new ModelRouter({
      transport,
      tierModels: { C0: 'tiny-local', C3: 'big-reasoner' },
    });

    const c0 = await router.complete({ ...REQ, tier: 'C0' });
    const c3 = await router.complete({ ...REQ, tier: 'C3' });

    expect(calls.map((c) => c.model)).toEqual(['tiny-local', 'big-reasoner']);
    expect(c0.tier).toBe('C0');
    expect(c3.tier).toBe('C3');
    expect(c0.text).toBe('generated');
  });

  it('records every call run-locally for provenance (model / summary / tokens)', async () => {
    const { transport } = fakeTransport({ inputTokens: 7, outputTokens: 13 });
    const router = new ModelRouter({ transport });

    await router.complete({ ...REQ, tier: 'C1', promptSummary: 'route orders' });

    const records = router.getRecords('run-1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      runId: 'run-1',
      tier: 'C1',
      promptSummary: 'route orders',
      inputTokens: 7,
      outputTokens: 13,
      ok: true,
    });
    // the full prompt is NOT stored — only the deterministic summary
    expect(JSON.stringify(records[0])).not.toContain('...');
  });

  it('records transport failures as ok:false and rethrows', async () => {
    const transport: ModelTransport = {
      async complete() {
        throw new RouterTransportError('SquillaRouter answered HTTP 500', 500);
      },
    };
    const router = new ModelRouter({ transport });

    await expect(router.complete({ ...REQ, tier: 'C2' })).rejects.toThrow(RouterTransportError);

    const records = router.getRecords('run-1');
    expect(records).toHaveLength(1);
    expect(records[0].ok).toBe(false);
    expect(records[0].error).toContain('HTTP 500');
    expect(records[0].inputTokens).toBe(0);
  });

  it('costSummary rolls up totals and per-tier breakdown', async () => {
    const { transport } = fakeTransport({ inputTokens: 10, outputTokens: 20 });
    const router = new ModelRouter({ transport });

    await router.complete({ ...REQ, tier: 'C0' });
    await router.complete({ ...REQ, tier: 'C0' });
    await router.complete({ ...REQ, tier: 'C2' });

    const summary = router.costSummary('run-1');
    expect(summary.calls).toBe(3);
    expect(summary.failedCalls).toBe(0);
    expect(summary.totalTokens).toBe(90);
    expect(summary.byTier.C0).toEqual({ calls: 2, inputTokens: 20, outputTokens: 40 });
    expect(summary.byTier.C2).toEqual({ calls: 1, inputTokens: 10, outputTokens: 20 });
  });

  it('maxCalls budget trips the breaker BEFORE the transport is touched', async () => {
    const { calls, transport } = fakeTransport();
    const router = new ModelRouter({ transport, budget: { maxCalls: 2 } });

    await router.complete({ ...REQ, tier: 'C0' });
    await router.complete({ ...REQ, tier: 'C0' });

    try {
      await router.complete({ ...REQ, tier: 'C0' });
      expect.unreachable('budget breaker must trip');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const summary = (err as BudgetExceededError).summary;
      expect(summary.calls).toBe(2);
      expect((err as BudgetExceededError).message).toContain('maxCalls=2');
    }
    expect(calls).toHaveLength(2); // no third call reached the transport
  });

  it('maxTotalTokens budget trips once accumulated tokens reach the limit', async () => {
    const { calls, transport } = fakeTransport({ inputTokens: 50, outputTokens: 50 });
    const router = new ModelRouter({ transport, budget: { maxTotalTokens: 100 } });

    await router.complete({ ...REQ, tier: 'C1' }); // consumes exactly 100
    await expect(router.complete({ ...REQ, tier: 'C1' })).rejects.toThrow(/maxTotalTokens=100/);
    expect(calls).toHaveLength(1);
  });

  it('ledgers are isolated per run', async () => {
    const { transport } = fakeTransport();
    const router = new ModelRouter({ transport, budget: { maxCalls: 1 } });

    await router.complete({ ...REQ, runId: 'run-a', tier: 'C0' });
    // a different run is unaffected by run-a's budget consumption
    await router.complete({ ...REQ, runId: 'run-b', tier: 'C0' });

    expect(router.costSummary('run-a').calls).toBe(1);
    expect(router.costSummary('run-b').calls).toBe(1);
    expect(router.costSummary('run-c').calls).toBe(0);
  });
});

describe('SquillaHttpTransport', () => {
  function fakeFetch(payload: unknown, status = 200) {
    const seen: { url: unknown; init: RequestInit }[] = [];
    const fetchImpl = (async (url: unknown, init: RequestInit) => {
      seen.push({ url: url as string, init });
      return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return { seen, fetchImpl };
  }

  it('posts the completion envelope with auth and maps snake_case usage', async () => {
    const { seen, fetchImpl } = fakeFetch({
      text: 'export class Order {}',
      model: 'served-model',
      usage: { input_tokens: 42, output_tokens: 7 },
    });
    const transport = new SquillaHttpTransport({
      baseUrl: 'http://localhost:4000/',
      apiKey: 'k',
      fetchImpl,
    });

    const result = await transport.complete({ model: 'tiny', tier: 'C1', prompt: 'p', maxTokens: 128 });

    expect(seen[0].url).toBe('http://localhost:4000/v1/completions');
    const init = seen[0].init;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'tiny',
      tier: 'C1',
      prompt: 'p',
      max_tokens: 128,
    });
    expect(result).toEqual({
      text: 'export class Order {}',
      model: 'served-model',
      inputTokens: 42,
      outputTokens: 7,
    });
  });

  it('maps HTTP errors to RouterTransportError with the status', async () => {
    const { fetchImpl } = fakeFetch('upstream overloaded', 503);
    const transport = new SquillaHttpTransport({ baseUrl: 'http://x', fetchImpl });

    await expect(
      transport.complete({ model: 'm', tier: 'C0', prompt: 'p' }),
    ).rejects.toMatchObject({ name: 'RouterTransportError', status: 503 });
  });

  it('rejects payloads without completion text', async () => {
    const { fetchImpl } = fakeFetch({ model: 'm' });
    const transport = new SquillaHttpTransport({ baseUrl: 'http://x', fetchImpl });

    await expect(
      transport.complete({ model: 'm', tier: 'C0', prompt: 'p' }),
    ).rejects.toThrow(/no completion text/);
  });
});
