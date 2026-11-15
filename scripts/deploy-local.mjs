#!/usr/bin/env node
/**
 * deploy-local — register a locally running generated system as a governed
 * deployment: target → instance → health heartbeat.
 *
 * Usage:
 *   node scripts/deploy-local.mjs --system <system-id> --endpoint <base-url> [--target-name "…"]
 *
 * The script first probes <endpoint>/health and refuses to record a healthy
 * heartbeat for something that does not answer. Idempotent: an existing
 * target (same endpoint) and live instance (same system×target) are reused.
 */
import {
  connectGateway,
  makeCaller,
  gated,
  settleExit,
} from './lib/build-chain.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const log = (...a) => console.log('[deploy]', ...a);

async function main() {
  const systemId = arg('system', null);
  const endpoint = arg('endpoint', null);
  const targetName = arg('target-name', 'owner-laptop (local dev)');
  const retireOthers = process.argv.includes('--retire-others');
  if (!systemId || !endpoint) {
    throw new Error('usage: deploy-local.mjs --system <system-id> --endpoint <base-url> [--target-name "…"]');
  }

  // 1. Prove the unit is actually alive before writing governance records.
  const started = Date.now();
  let health;
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    health = await res.json();
  } catch (err) {
    throw new Error(`endpoint ${endpoint} does not answer /health (${err.message}) — not registering a ghost deployment`);
  }
  const probeMs = Date.now() - started;
  log(`endpoint alive: ${endpoint}/health -> ${JSON.stringify(health)} (${probeMs}ms)`);

  const gw = await connectGateway(log);
  const callTool = makeCaller(gw.base, gw.editorToken);
  try {
    // 2. Target: reuse by endpoint, else register (gated).
    const existing = await callTool('search_deployments', { limit: 50 });
    let target = existing.targets.find((t) => t.endpoint_uri === endpoint || t.endpointUri === endpoint);
    if (target) {
      log(`target reused: ${target.id} (${target.name})`);
    } else {
      const r = await gated(callTool, 'register_deployment_target', {
        name: targetName,
        kind: 'onprem',
        endpoint_uri: endpoint,
        capacity_notes: 'local dev machine; generated system runs under node --experimental type stripping',
      });
      target = r.target;
      log(`target registered: ${target.id} (${target.name}, ${target.kind})`);
    }

    // 3. Instance: reuse live one, else register (gated). With
    // --retire-others, other live instances on the same target are revoked
    // first (one port, one listener — a stale instance would be a lie).
    const isLive = (i) => (i.status ?? '') !== 'revoked';
    const sameTarget = (i) => (i.target_id ?? i.targetId) === target.id;
    let instance = existing.instances.find(
      (i) => (i.system_id ?? i.systemId) === systemId && sameTarget(i) && isLive(i),
    );
    if (retireOthers) {
      for (const i of existing.instances.filter((x) => sameTarget(x) && isLive(x) && (x.system_id ?? x.systemId) !== systemId)) {
        await gated(callTool, 'revoke_instance', {
          instance_id: i.id,
          reason: `superseded: target re-deployed with system ${systemId}`,
        });
        log(`instance revoked: ${i.id} (superseded)`);
      }
    }
    if (instance) {
      log(`instance reused: ${instance.id} (status ${instance.status})`);
    } else {
      const r = await gated(callTool, 'register_deployed_instance', {
        system_id: systemId,
        target_id: target.id,
      });
      instance = r.instance;
      log(`instance registered: ${instance.id} (system ${systemId} on ${target.id})`);
    }

    // 4. Health heartbeat with the measured probe.
    const h = await gated(callTool, 'record_instance_health', {
      instance_id: instance.id,
      status: 'healthy',
      metrics: { health_probe_ms: probeMs },
    });
    log(`health recorded: ${h.instance.id} -> ${h.instance.status} at ${h.instance.last_health_at ?? h.instance.lastHealthAt}`);

    console.log('\n=== deployment chain ===');
    console.log(`system:    ${systemId}`);
    console.log(`target:    ${target.id} (${target.name}, ${endpoint})`);
    console.log(`instance:  ${instance.id} (${h.instance.status})`);
    return 0;
  } finally {
    await gw.close();
  }
}

settleExit(await main());
