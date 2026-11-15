#!/usr/bin/env node
/**
 * install-lexnusa-units — 把 LexNusa 的两个部署单元作为 ADR 0009 InstallableUnit
 * 挂籍进 DAM 治理平面：spec → system → target → instance → health heartbeat。
 *
 * 与 install-distiller-unit.mjs 同型：LexNusa 是「自带 manifest 的主权项目」，
 * 非 DAM builder 链产物，blueprint/verify 引用诚实留空；provenance 指向
 * 仓库内 dam.manifest.yaml（commit 固定）。
 *
 * 单元清单（生产实测 /health 均 200）：
 *   - lexnusa-web  https://lexnusa-web.vfvincentwong-881.workers.dev  主平台（OpenNext on Workers）
 *   - lexnusa-mcp  https://lexnusa-mcp.vfvincentwong-881.workers.dev  MCP 图谱端点（8 工具）
 *
 * Usage（仓库根目录，先 pnpm build）:
 *   node scripts/install-lexnusa-units.mjs
 *
 * 幂等：已存在的 spec/system/target/instance 全部复用；重复运行只补 heartbeat。
 */
import { execSync } from 'node:child_process';
import { connectGateway, makeCaller, gated } from './lib/build-chain.mjs';

const log = (...a) => console.log('[install]', ...a);

const LEXNUSA_REPO = process.env.LEXNUSA_REPO ?? '../LexNusa';
const COMMIT = execSync('git rev-parse --short HEAD', { cwd: LEXNUSA_REPO }).toString().trim();
const TARGET_ENDPOINT = 'https://vfvincentwong-881.workers.dev';

const UNITS = [
  {
    name: 'lexnusa-web',
    version: '0.1.0',
    endpoint: 'https://lexnusa-web.vfvincentwong-881.workers.dev',
    specTitle: 'LexNusa Web · 印尼中小企业 AI 财务部门主平台（InstallableUnit L1）',
    domain: 'fintech-compliance',
    requirements: [
      'AI 原生四件套：确定性规则层 / 依据锚定 / 风险分级人工门控 / 全程留痕审计',
      '双 Provider 模型路由：OpenRouter 免费池优先 + Workers AI 自动回退（lib/llm.ts）',
      '6,466 条款印尼法规知识图谱（D1 + Vectorize bge-m3），引用强制锚定法条',
      '部署形态：L1 Registerable，repo+wrangler 包装，标准 /health（生产 200 实测）',
      `数据边界：D1/Vectorize 共享绑定，egress 仅 openrouter.ai；dam.manifest.yaml@${COMMIT}`,
    ].join('\n'),
    workflows: ['专家问答', '票据提取台账', '报税日历生成', '申报预填与复核三态流'],
  },
  {
    name: 'lexnusa-mcp',
    version: '1.0.0',
    endpoint: 'https://lexnusa-mcp.vfvincentwong-881.workers.dev',
    specTitle: 'LexNusa MCP · 印尼法规图谱 MCP 端点（InstallableUnit L1, MCP-exposing）',
    domain: 'fintech-compliance',
    requirements: [
      'MCP Streamable HTTP（无状态 JSON 模式），8 个图谱工具，中英双语契约',
      '多伙伴密钥：label:key 列表，按伙伴分发/吊销，调用日志伙伴归因',
      '部署形态：L1 Registerable，repo+wrangler 包装，标准 /health（生产 200 实测）',
      `数据边界：D1/Vectorize 只读查询，egress 空；dam.manifest.yaml@${COMMIT}`,
    ].join('\n'),
    workflows: ['法规检索', '语义搜索', '上下位法遍历', '伙伴系统嵌入'],
  },
];

async function probeHealth(endpoint) {
  const started = Date.now();
  const res = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${endpoint}/health HTTP ${res.status}——不登记幽灵部署`);
  const body = await res.json();
  return { body, ms: Date.now() - started };
}

async function installUnit(callTool, target, unit) {
  // 0) 活体检查
  const probe = await probeHealth(unit.endpoint);
  log(`unit alive: ${unit.endpoint}/health -> ok=${probe.body.ok} (${probe.ms}ms)`);

  // 1) spec
  const found = await callTool('search_specs', { query: unit.specTitle, limit: 10 });
  let spec = found.specs.find((s) => s.title === unit.specTitle && (s.status === 'draft' || s.status === 'approved'));
  if (!spec) {
    const drafted = await gated(callTool, 'generate_system_spec', {
      title: unit.specTitle,
      business_domain: unit.domain,
      requirements: unit.requirements,
      workflows: unit.workflows,
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

  // 2) system
  const pre = await callTool('search_systems', { query: unit.name });
  let system = pre.systems.find((s) => s.name === unit.name && s.version === unit.version);
  if (system) {
    log(`system reused: ${system.id} (${system.name}@${system.version})`);
  } else {
    const r = await gated(callTool, 'register_generated_system', {
      source_spec_id: spec.id,
      name: unit.name,
      version: unit.version,
      endpoint_uri: unit.endpoint,
      // 非 builder 链产物：blueprint_hash/verify_report_ref 诚实留空
    });
    system = r.system;
    log(`system registered: ${system.id}`);
  }

  // 3) instance（system×target 复用在世的）
  const deps = await callTool('search_deployments', { limit: 50 });
  let instance = deps.instances.find(
    (i) => (i.system_id ?? i.systemId) === system.id &&
      (i.target_id ?? i.targetId) === target.id &&
      (i.status ?? '') !== 'revoked',
  );
  if (instance) {
    log(`instance reused: ${instance.id} (status ${instance.status})`);
  } else {
    const r = await gated(callTool, 'register_deployed_instance', {
      system_id: system.id,
      target_id: target.id,
    });
    instance = r.instance;
    log(`instance registered: ${instance.id}`);
  }

  // 4) heartbeat
  const h = await gated(callTool, 'record_instance_health', {
    instance_id: instance.id,
    status: 'healthy',
    metrics: { health_probe_ms: probe.ms },
  });
  log(`health recorded: ${h.instance.id} -> ${h.instance.status}`);

  return { spec, system, instance: h.instance };
}

async function main() {
  log(`LexNusa repo commit: ${COMMIT}`);
  const gw = await connectGateway(log);
  const callTool = makeCaller(gw.base, gw.editorToken);
  try {
    // target：Cloudflare 账户级，一个即可
    const deps = await callTool('search_deployments', { limit: 50 });
    let target = deps.targets.find((t) => (t.endpoint_uri ?? t.endpointUri) === TARGET_ENDPOINT);
    if (target) {
      log(`target reused: ${target.id} (${target.name})`);
    } else {
      const r = await gated(callTool, 'register_deployment_target', {
        name: 'Cloudflare Workers 账户 (vfvincentwong-881)',
        kind: 'cloud',
        endpoint_uri: TARGET_ENDPOINT,
        region: 'global (CF edge, SIN 实测)',
        capacity_notes: `serverless Workers + D1 + Vectorize + Workers AI；两单元 manifest@${COMMIT}`,
      });
      target = r.target;
      log(`target registered: ${target.id} (${target.name})`);
    }

    const results = [];
    for (const unit of UNITS) {
      results.push({ unit: unit.name, ...(await installUnit(callTool, target, unit)) });
    }

    console.log('\n=== LexNusa InstallableUnit 挂籍链 ===');
    console.log(`target:    ${target.id} (${target.name})`);
    for (const r of results) {
      console.log(`--- ${r.unit}`);
      console.log(`  spec:      ${r.spec.id}`);
      console.log(`  system:    ${r.system.id} (${r.system.name}@${r.system.version})`);
      console.log(`  instance:  ${r.instance.id} (${r.instance.status})`);
    }
    return 0;
  } finally {
    await gw.close();
  }
}

main().then((code) => process.exit(code ?? 0)).catch((err) => { console.error('[install] FAIL:', err.message); process.exit(1); });
