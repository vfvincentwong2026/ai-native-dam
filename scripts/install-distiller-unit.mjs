#!/usr/bin/env node
/**
 * install-distiller-unit — 把 Video Batch ID 作为 ADR 0009 InstallableUnit
 * 挂籍进 DAM 治理平面：spec → system → target → instance → health heartbeat。
 *
 * 与 deploy-local.mjs 的区别：deploy-local 服务 builder 链产物（system 已存在）；
 * 本脚本面向「自带 manifest 的主权项目」——VBID 不是 DAM 生成的系统，
 * 但 register_deployed_instance 要求 system 存在，故先按契约注册 spec/system
 * （provenance 留空：VBID 的谱系在自己的 SQLite，入境靠 manifest + 后续 skill 登记）。
 *
 * Usage:
 *   node scripts/install-distiller-unit.mjs [--endpoint http://localhost:8000] [--name video-batch-id] [--version 0.9.0]
 *
 * 幂等：已存在的 spec/system/target/instance 全部复用；重复运行只补 heartbeat。
 */
import { connectGateway, makeCaller, gated } from './lib/build-chain.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const log = (...a) => console.log('[install]', ...a);

const ENDPOINT = (arg('endpoint', 'http://localhost:8000')).replace(/\/$/, '');
const NAME = arg('name', 'video-batch-id');
const VERSION = arg('version', '0.9.0');
const SPEC_TITLE = 'Video Batch ID · 印尼短视频二创执行体（InstallableUnit L2）';
const SPEC_REQUIREMENTS = [
  '参考素材二创：VLM 解析 → 六维变量矩阵 → 批量生成 → 保真/去重双守卫',
  'MCP-first：15 个工具契约，两段式审批门（-32042 + approval_token）',
  'A2A 只读委派（Agent Card + message/send，零副作用红线）',
  '五层知识沉淀（raw/topic/rule/manual/qa）+ Skill 注册门槛',
  '部署形态：L2 Hostable，repo 包装，node 运行时，标准 /health',
  '数据边界：本地 SQLite 执行状态 + assets/ 素材盘，egress 仅 openrouter.ai',
].join('\n');

async function main() {
  // 0) 证明单元活着（deploy-local 同款拒幽灵原则）
  const started = Date.now();
  let health;
  try {
    const res = await fetch(`${ENDPOINT}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    health = await res.json();
  } catch (err) {
    throw new Error(`endpoint ${ENDPOINT} 不响应 /health（${err.message}）——不登记幽灵部署`);
  }
  const probeMs = Date.now() - started;
  log(`unit alive: ${ENDPOINT}/health -> ${JSON.stringify(health)} (${probeMs}ms)`);

  const gw = await connectGateway(log);
  const callTool = makeCaller(gw.base, gw.editorToken);
  try {
    // 1) spec：复用草稿/approved，否则新建并提交审批
    const found = await callTool('search_specs', { query: SPEC_TITLE, limit: 10 });
    let spec = found.specs.find((s) => s.title === SPEC_TITLE && (s.status === 'draft' || s.status === 'approved'));
    if (!spec) {
      const drafted = await gated(callTool, 'generate_system_spec', {
        title: SPEC_TITLE,
        business_domain: 'short-video-ecommerce',
        requirements: SPEC_REQUIREMENTS,
        workflows: ['参考二创工作流A', '变量矩阵控制', '双守卫审核入库', 'Skill 蒸馏复用'],
      });
      spec = { id: drafted.spec_id, status: 'draft' };
      log(`spec drafted: ${spec.id}`);
    } else {
      log(`spec reused: ${spec.id} (${spec.status})`);
    }
    if (spec.status === 'draft') {
      await gated(callTool, 'submit_system_spec', { spec_id: spec.id });
      log('spec submitted → approved');
    }

    // 2) system：幂等复用，否则注册（high risk，gated）
    const pre = await callTool('search_systems', { query: NAME });
    let system = pre.systems.find((s) => s.name === NAME && s.version === VERSION);
    if (system) {
      log(`system reused: ${system.id} (${system.name}@${system.version}, ${system.status})`);
    } else {
      const r = await gated(callTool, 'register_generated_system', {
        source_spec_id: spec.id,
        name: NAME,
        version: VERSION,
        endpoint_uri: ENDPOINT,
        // 非 builder 链产物：无 blueprint/verify 引用，诚实留空
      });
      system = r.system;
      log(`system registered: ${system.id} (${system.name}@${system.version})`);
    }

    // 3) target：按 endpoint 幂等复用
    const deps = await callTool('search_deployments', { limit: 50 });
    let target = deps.targets.find((t) => (t.endpoint_uri ?? t.endpointUri) === ENDPOINT);
    if (target) {
      log(`target reused: ${target.id} (${target.name})`);
    } else {
      const r = await gated(callTool, 'register_deployment_target', {
        name: 'owner-laptop (Video Batch ID unit)',
        kind: 'onprem',
        endpoint_uri: ENDPOINT,
        capacity_notes: 'InstallableUnit L2；dam.manifest.yaml@fc08fc6；node>=20 + ffmpeg/ffprobe 注入',
      });
      target = r.target;
      log(`target registered: ${target.id} (${target.name}, ${target.kind})`);
    }

    // 4) instance：system×target 复用在世的
    const instanceId = system.id;
    let instance = deps.instances.find(
      (i) => (i.system_id ?? i.systemId) === instanceId &&
        (i.target_id ?? i.targetId) === target.id &&
        (i.status ?? '') !== 'revoked',
    );
    if (instance) {
      log(`instance reused: ${instance.id} (status ${instance.status})`);
    } else {
      const r = await gated(callTool, 'register_deployed_instance', {
        system_id: instanceId,
        target_id: target.id,
      });
      instance = r.instance;
      log(`instance registered: ${instance.id}`);
    }

    // 5) heartbeat
    const h = await gated(callTool, 'record_instance_health', {
      instance_id: instance.id,
      status: 'healthy',
      metrics: { health_probe_ms: probeMs },
    });
    log(`health recorded: ${h.instance.id} -> ${h.instance.status}`);

    console.log('\n=== InstallableUnit 挂籍链 ===');
    console.log(`spec:      ${spec.id}`);
    console.log(`system:    ${system.id} (${system.name}@${system.version})`);
    console.log(`target:    ${target.id} (${target.name}, ${ENDPOINT})`);
    console.log(`instance:  ${instance.id} (${h.instance.status})`);
    return 0;
  } finally {
    await gw.close();
  }
}

main().then((code) => process.exit(code ?? 0)).catch((err) => { console.error('[install] FAIL:', err.message); process.exit(1); });
