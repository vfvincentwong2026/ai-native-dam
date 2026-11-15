import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createGateway } from './server.js';
import type { TokenMap } from './auth.js';
import type {
  DeployedInstance,
  DeploymentTarget,
  DistillationRequest,
  Skill,
  SystemSpec,
} from '@ai-native-dam/shared-schema';

const TOKENS: TokenMap = {
  'read-token': { id: 'viewer', scopes: ['Suggest', 'Read'] },
  'build-token': { id: 'builder-runtime', scopes: ['Build'] },
};

const skill = (id: string, status: Skill['status']): Skill => ({
  id,
  version: '1.0.0',
  name: `Skill ${id}`,
  description: `test skill ${id}`,
  domain: 'operations',
  sourceSopId: null,
  status,
  approvedAt: null,
  approvedBy: null,
  loraArtifactRef: null,
  createdAt: '2026-01-01T00:00:00Z',
  sourceRepo: null,
  sourcePath: null,
  sourceCommit: null,
});

const spec: SystemSpec = {
  id: 'spec-0001',
  title: 'TradeFlow order system',
  businessDomain: 'ecommerce',
  requirements: 'manage orders',
  entities: [{ name: 'Order', fields: [{ name: 'total', type: 'number', required: true }], permissions: ['read'] }],
  workflows: [],
  sourceSkillIds: [],
  sourceKnowledgeIds: [],
  status: 'pending_approval',
  createdAt: '2026-01-02T00:00:00Z',
  approvedAt: null,
  approvedBy: null,
};

const distillation: DistillationRequest = {
  id: 'dist-0001',
  sourceSkillId: 'skill:pricing',
  usageCount: 25,
  threshold: 20,
  status: 'awaiting_approval',
  reason: null,
  requestedBy: 'gateway',
  requestedAt: '2026-01-02T00:00:00Z',
  approvedAt: null,
  approvedBy: null,
};

const target: DeploymentTarget = {
  id: 'target-0001',
  name: 'cloud-prod',
  kind: 'cloud',
  endpointUri: 'https://deploy.internal',
  region: 'sg',
  capacityNotes: null,
  status: 'active',
  registeredBy: 'ops',
  createdAt: '2026-01-03T00:00:00Z',
};

const instance: DeployedInstance = {
  id: 'inst-0001',
  systemId: 'sys-0001',
  targetId: 'target-0001',
  version: '0.1.0',
  status: 'degraded',
  lastHealthAt: '2026-01-03T00:00:00Z',
  healthMetrics: {},
  deployedBy: 'ops',
  createdAt: '2026-01-03T00:00:00Z',
  revokedAt: null,
  revokedBy: null,
  revokeReason: null,
};

let baseUrl: string;
let server: ReturnType<typeof createGateway>['server'];

async function getOverview(token?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/overview`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const parsed: any = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  const gateway = createGateway({
    tokens: TOKENS,
    seed: {
      skills: [skill('skill:pricing', 'approved'), skill('skill:listing', 'pending_approval')],
      specs: [spec],
      distillations: [distillation],
      targets: [target],
      instances: [instance],
    },
  });
  server = gateway.server;
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

describe('GET /overview', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await getOverview();
    expect(res.status).toBe(401);
  });

  it('rejects principals without the Read scope', async () => {
    const res = await getOverview('build-token');
    expect(res.status).toBe(401);
  });

  it('returns aggregate counts and operational lists for a Read principal', async () => {
    const res = await getOverview('read-token');
    expect(res.status).toBe(200);
    const o = res.body;

    expect(o.server).toBe('ai-native-dam-gateway');
    expect(typeof o.generated_at).toBe('string');

    expect(o.skills.total).toBe(2);
    expect(o.skills.by_status).toEqual({ approved: 1, pending_approval: 1 });
    expect(o.skills.pending_approval).toEqual([
      expect.objectContaining({ id: 'skill:listing', version: '1.0.0' }),
    ]);

    expect(o.specs.total).toBe(1);
    expect(o.specs.by_status).toEqual({ pending_approval: 1 });
    expect(o.specs.pending_approval[0]).toEqual(
      expect.objectContaining({ id: 'spec-0001', title: 'TradeFlow order system' }),
    );

    expect(o.distillations.total).toBe(1);
    expect(o.distillations.by_status).toEqual({ awaiting_approval: 1 });
    expect(o.distillations.awaiting_approval[0]).toEqual(
      expect.objectContaining({ id: 'dist-0001', source_skill_id: 'skill:pricing' }),
    );

    expect(o.deployments.targets.total).toBe(1);
    expect(o.deployments.targets.by_kind).toEqual({ cloud: 1 });
    expect(o.deployments.instances.total).toBe(1);
    expect(o.deployments.instances.attention).toEqual([
      expect.objectContaining({ id: 'inst-0001', status: 'degraded' }),
    ]);
  });
});
