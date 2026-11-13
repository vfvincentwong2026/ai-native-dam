import { describe, expect, it } from 'vitest';
import { generateManifest, type Blueprint } from '@ai-native-dam/runtime-compilation';
import {
  HttpMcpClient,
  InvalidTransitionError,
  McpError,
  Orchestrator,
  RunStore,
  ToolRejectedError,
  VerificationFailedError,
} from './index.js';

interface RecordedCall {
  name: string;
  arguments: Record<string, unknown>;
}

type Handler = (call: RecordedCall) => Record<string, unknown>;

interface HandlerWithCalls {
  calls: RecordedCall[];
  fetchImpl: typeof fetch;
}

function fakeGateway(handler: Handler): HandlerWithCalls {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (_url: unknown, init: { body: string }) => {
    const body = JSON.parse(init.body) as {
      id: number;
      params: { name: string; arguments: Record<string, unknown> };
    };
    const call: RecordedCall = { name: body.params.name, arguments: body.params.arguments };
    calls.push(call);
    const payload = handler(call);
    const isError = payload.__isError === true;
    delete payload.__isError;
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          ...(isError ? { isError: true } : {}),
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const SPEC = {
  id: 'spec-1',
  title: 'Order Admin',
  business_domain: 'retail',
  requirements: 'Ops need an order admin console.',
  entities: [
    { name: 'order', fields: [{ name: 'id', type: 'string', required: true }], permissions: ['read'] },
  ],
  workflows: ['fulfill order'],
  source_skill_ids: ['operations:project-context'],
  source_knowledge_ids: [],
  status: 'approved',
  created_at: '2026-01-01T00:00:00.000Z',
  approved_at: '2026-01-01T01:00:00.000Z',
  approved_by: 'editor',
};

function happyPathHandler(calls: RecordedCall[]): Handler {
  return (call) => {
    if (call.name === 'search_specs') {
      return { specs: [SPEC] };
    }
    if (call.name === 'register_generated_system') {
      if (!call.arguments._confirmation) {
        return { approval_required: true, confirmation_token: 'tok-1', risk_level: 'high' };
      }
      return { system: { id: 'sys-1' }, spec: { id: SPEC.id, status: 'generated' } };
    }
    throw new Error(`unexpected tool ${call.name}`);
  };
}

/** A build that passes the verify gate: exactly the planned files + manifest. */
function passingBuild(blueprint: Blueprint) {
  return { files: blueprint.files.map((f) => f.path), manifest: generateManifest(blueprint) };
}

describe('HttpMcpClient', () => {
  it('enforces the ADR 0010 tool whitelist before any network call', async () => {
    const gw = fakeGateway(() => ({}));
    const client = new HttpMcpClient({ baseUrl: 'http://gw.test', token: 't', fetchImpl: gw.fetchImpl });
    await expect(client.call('set_rights' as never, {})).rejects.toThrow(/whitelist/);
    expect(gw.calls).toHaveLength(0);
  });

  it('maps gateway rejections (isError) to ToolRejectedError with the reason', async () => {
    const gw = fakeGateway(() => ({ __isError: true, rejected: true, reason: 'invalid_status_transition' }));
    const client = new HttpMcpClient({ baseUrl: 'http://gw.test', token: 't', fetchImpl: gw.fetchImpl });
    await expect(client.call('search_specs', {})).rejects.toMatchObject({
      name: 'ToolRejectedError',
      reason: 'invalid_status_transition',
    });
  });

  it('maps JSON-RPC errors to McpError with the code', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32003, message: 'forbidden scope' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
    const client = new HttpMcpClient({ baseUrl: 'http://gw.test', token: 't', fetchImpl });
    await expect(client.call('search_specs', {})).rejects.toMatchObject({ name: 'McpError', code: -32003 });
  });

  it('beginGated returns the challenge; confirmGated quotes the token back', async () => {
    const gw = fakeGateway(happyPathHandler([]));
    const client = new HttpMcpClient({ baseUrl: 'http://gw.test', token: 't', fetchImpl: gw.fetchImpl });
    const args = { source_spec_id: 'spec-1', name: 'Order Admin', version: '0.1.0' };

    const begin = await client.beginGated('register_generated_system', args);
    expect(begin.executed).toBe(false);
    if (begin.executed) throw new Error('expected challenge');
    expect(begin.challenge.confirmationToken).toBe('tok-1');
    expect(begin.challenge.riskLevel).toBe('high');

    const result = (await client.confirmGated('register_generated_system', args, 'tok-1')) as {
      system: { id: string };
    };
    expect(result.system.id).toBe('sys-1');
    expect(gw.calls[1].arguments._confirmation).toBe('tok-1');
  });
});

describe('RunStore', () => {
  it('rejects illegal transitions', () => {
    const store = new RunStore();
    const run = store.create('run-1', 'spec-1');
    expect(() => store.advance(run.id, 'verifying')).toThrow(InvalidTransitionError);
    expect(store.get(run.id)?.state).toBe('queued');
  });

  it('terminal states accept no further transitions', () => {
    const store = new RunStore();
    const run = store.create('run-1', 'spec-1');
    store.advance(run.id, 'compiling');
    store.advance(run.id, 'failed', { error: 'boom' });
    expect(() => store.advance(run.id, 'compiling')).toThrow(InvalidTransitionError);
  });
});

describe('Orchestrator', () => {
  it('drives approved spec → awaiting_registration → registered (human gate in between)', async () => {
    const gw = fakeGateway(happyPathHandler([]));
    const client = new HttpMcpClient({ baseUrl: 'http://gw.test', token: 't', fetchImpl: gw.fetchImpl });
    const orch = new Orchestrator(client);

    const work = await orch.discoverWork();
    expect(work).toEqual([{ id: 'spec-1', title: 'Order Admin', businessDomain: 'retail' }]);

    const run = await orch.startRun('spec-1');
    expect(run.state).toBe('compiling');
    // startRun plans the deterministic Blueprint immediately
    expect(run.blueprintRef).toMatch(/^bp-[a-f0-9]{12}$/);
    const bp = orch.getBlueprint(run.id);
    expect(bp?.specId).toBe('spec-1');
    expect(bp?.stack.storage).toBe('postgres'); // retail domain override
    expect(bp?.files.map((f) => f.path)).toContain('dam.manifest.yaml');

    // an active run removes the spec from discovery and blocks duplicate runs
    expect(await orch.discoverWork()).toEqual([]);
    await expect(orch.startRun('spec-1')).rejects.toThrow(/already has an active run/);

    orch.completeCompilation(run.id, 'build://run-local/spec-1#tree');
    expect(orch.runStore.get(run.id)?.state).toBe('verifying');
    expect(orch.runStore.get(run.id)?.buildRef).toBe('build://run-local/spec-1#tree');

    if (!bp) throw new Error('blueprint missing');
    const awaiting = await orch.requestRegistration(run.id, {
      name: 'Order Admin',
      version: '0.1.0',
      build: passingBuild(bp),
    });
    expect(awaiting.state).toBe('awaiting_registration');
    expect(awaiting.pendingConfirmation).toBe('tok-1');
    expect(awaiting.verifyReportRef).toBe(`verify://${run.id}`);
    // the deterministic gate report is inspectable and passed all checks
    const report = orch.getVerifyReport(run.id);
    expect(report?.ok).toBe(true);
    expect(report?.checks.every((c) => c.ok)).toBe(true);

    // the first register call must NOT carry a confirmation token
    const registerCalls = gw.calls.filter((c) => c.name === 'register_generated_system');
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0].arguments._confirmation).toBeUndefined();

    const done = await orch.confirmRegistration(run.id);
    expect(done.state).toBe('registered');
    expect(done.systemId).toBe('sys-1');
    expect(done.pendingConfirmation).toBeNull();
    expect(gw.calls.filter((c) => c.name === 'register_generated_system')).toHaveLength(2);
  });

  it('verify-before-register: a bad build fails the run and never touches the gateway', async () => {
    const gw = fakeGateway(happyPathHandler([]));
    const client = new HttpMcpClient({ baseUrl: 'http://gw.test', token: 't', fetchImpl: gw.fetchImpl });
    const orch = new Orchestrator(client);

    const run = await orch.startRun('spec-1');
    orch.completeCompilation(run.id, 'build://run-local/spec-1#tree');
    const bp = orch.getBlueprint(run.id);
    if (!bp) throw new Error('blueprint missing');

    // drop one planned file → file_manifest_complete must fail
    const badBuild = { files: bp.files.map((f) => f.path).slice(1), manifest: generateManifest(bp) };
    try {
      await orch.requestRegistration(run.id, { name: 'X', version: '0.0.1', build: badBuild });
      expect.unreachable('the verify gate must reject an incomplete build');
    } catch (err) {
      expect(err).toBeInstanceOf(VerificationFailedError);
      const failedChecks = (err as VerificationFailedError).report.checks
        .filter((c) => !c.ok)
        .map((c) => c.name);
      expect(failedChecks).toContain('file_manifest_complete');
    }

    const failed = orch.runStore.get(run.id);
    expect(failed?.state).toBe('failed');
    expect(failed?.error).toContain('file_manifest_complete');
    // the gateway was never asked to register
    expect(gw.calls.filter((c) => c.name === 'register_generated_system')).toHaveLength(0);
  });

  it('validates state before any gateway call (no side effects from illegal states)', async () => {
    const gw = fakeGateway(happyPathHandler([]));
    const client = new HttpMcpClient({ baseUrl: 'http://gw.test', token: 't', fetchImpl: gw.fetchImpl });
    const orch = new Orchestrator(client);
    const run = await orch.startRun('spec-1');

    await expect(
      orch.requestRegistration(run.id, { name: 'X', version: '0.0.1', build: { files: [], manifest: '' } }),
    ).rejects.toThrow(InvalidTransitionError);
    await expect(orch.confirmRegistration(run.id)).rejects.toThrow(InvalidTransitionError);
    expect(gw.calls.filter((c) => c.name === 'register_generated_system')).toHaveLength(0);
  });

  it('rejects specs that are missing or not approved before planning anything', async () => {
    const gw = fakeGateway((call) => {
      if (call.name === 'search_specs') {
        return { specs: [{ ...SPEC, status: 'draft' }] };
      }
      throw new Error(`unexpected tool ${call.name}`);
    });
    const client = new HttpMcpClient({ baseUrl: 'http://gw.test', token: 't', fetchImpl: gw.fetchImpl });
    const orch = new Orchestrator(client);

    await expect(orch.startRun('spec-1')).rejects.toThrow(/only approved specs/);
    await expect(orch.startRun('spec-ghost')).rejects.toThrow(/not found/);
    // no run was created for either attempt
    expect(orch.runStore.list()).toHaveLength(0);
  });

  it('a rejected confirmation closes the run as failed with the reason', async () => {
    const gw = fakeGateway((call) => {
      if (call.name === 'register_generated_system') {
        if (!call.arguments._confirmation) {
          return { approval_required: true, confirmation_token: 'tok-x', risk_level: 'high' };
        }
        return { __isError: true, rejected: true, reason: 'invalid_status_transition' };
      }
      return { specs: [SPEC] };
    });
    const client = new HttpMcpClient({ baseUrl: 'http://gw.test', token: 't', fetchImpl: gw.fetchImpl });
    const orch = new Orchestrator(client);

    const run = await orch.startRun('spec-1');
    orch.completeCompilation(run.id, 'blueprint://x');
    const bp = orch.getBlueprint(run.id);
    if (!bp) throw new Error('blueprint missing');
    await orch.requestRegistration(run.id, { name: 'X', version: '0.0.1', build: passingBuild(bp) });

    await expect(orch.confirmRegistration(run.id)).rejects.toThrow(ToolRejectedError);
    const failed = orch.runStore.get(run.id);
    expect(failed?.state).toBe('failed');
    expect(failed?.error).toContain('invalid_status_transition');
    expect(failed?.pendingConfirmation).toBeNull();
  });
});
