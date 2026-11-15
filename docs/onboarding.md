# 接入 AI-Native DAM:L1 登记指南(给各项目的维护 Agent)

> 你要把你的项目登记进 AI-Native DAM 治理平面。本文档是唯一权威来源。
> 原则:**各自的仓库各自改**——DAM 不会替你改代码;DAM 只裁决、登记、审计。
> 契约依据:`docs/adr/0009-installable-unit-contract.md`。

## 0. 运行中的 DAM 实例

- 网关(MCP,Streamable HTTP):`http://127.0.0.1:8080/mcp`
- 健康检查:`http://127.0.0.1:8080/health`
- 治理大屏(只读公开):https://ai-native-dam.pages.dev/governance/
- 令牌:向 DAM 管理员索取( Bearer token,分 Read / Edit scope)。**不要把令牌写进仓库、代码或文档。**

### 红线(违反即拒绝接入)

1. **不要自己启动第二个 DAM 网关。** 常驻网关已在 8080 端口运行,数据落在它的 PGlite。自己 `spawn` 一个网关、写 `data/pg`,等于开了第二个登记处——注册记录大屏上看不到,接入无效。
2. 不要改 DAM 仓库的任何文件;你的全部改动发生在**你自己的仓库**里。
3. 不要硬编码任何密钥/令牌;DAM 侧密钥由 manifest 的 `injectedSecrets` 声明、部署时注入。
4. SQL DDL 字符串的注释里**不要含分号**(PGlite 初始化按 `;` 切语句)。

## 1. L1 登记级清单(四件事)

| # | 要求 | 验证方式 |
|---|---|---|
| 1 | 可声明打包:OCI 镜像,或 git 仓库 + commit tag | Dockerfile / compose / wrangler.toml 任一即可 |
| 2 | 仓库根目录有 `dam.manifest.yaml`(模板见 §2) | 文件存在且字段完整 |
| 3 | 标准健康端点 `/health`(或 `/healthz`),返回 200 | `curl localhost:<port>/health` |
| 4 | 零硬编码密钥 | 密钥只从环境变量读 |

缺哪项补哪项,全部在你自己的仓库完成、提交、推送。

## 2. `dam.manifest.yaml` 模板

```yaml
apiVersion: dam.ai-native/v1
kind: InstallableUnit
metadata:
  name: <项目名>            # 小写,与仓库名一致
  version: <semver>
  maintainer: vfvincentwong2026
spec:
  runtime:
    # 二选一:镜像,或 仓库+启动命令
    image: ghcr.io/<org>/<repo>:<tag>        # 有 Docker 的话
    repo: https://github.com/vfvincentwong2026/<repo>
    entrypoint: ["<启动命令>"]
  resources:
    min: { cpu: 1, mem: 1Gi, gpu: none, storage: 5Gi }
  mcp:
    role: server              # 你能被 DAM 探活/下发指令(有 /mcp 端点才写 server)
    endpoint: /mcp
    tools: [<你暴露的工具名>]
  governance:
    requires: [check_usage_rights, record_usage, register_skill]   # 你会调 DAM 的哪些工具
    injectedSecrets: [<你需要注入的环境变量名>]
  health:
    liveness: /health
  dataBoundary:
    localOnly: [<不出本机的数据>]
    cloudSync: [<可上云的数据>]
    redacted:  [<必须脱敏的字段>]
  offline:
    mode: degraded            # 断网时的降级行为
  skills:                     # 你携带的 SKILL 清单(没有就写空数组)
    - { name: <skill-id>, version: <semver>, purpose: <一句话>, risk: low|medium|high }
```

## 3. 登记流程(全部走 MCP,带审批闸门)

网关的写工具是 **gated 两段调用**:第一次调用返回
`approval_required: true` + `confirmation_token`;**用完全相同的参数**加上
`_confirmation: <token>` 重放,才算完成。令牌一次性、有过期时间。

顺序(JSON-RPC `tools/call`,POST 到 `http://127.0.0.1:8080/mcp`):

```
1. generate_system_spec        起草 System Spec(声明你的实体/工作流)
2. submit_system_spec          提交 Spec 进入审批(gated)
3. approve_spec                由持 Edit 令牌的审批人批准(gated)
4. register_generated_system   注册系统资产(gated)
5. register_deployment_target  登记部署目标(云/边缘/本地)(gated)
6. register_deployed_instance  登记运行实例(gated)
7. record_instance_health      打第一次健康心跳
```

幂等要求:重复跑你的接入脚本不得产生重复注册——先查(`search_specs` /
`search_deployments`)再注册。

完成后自检:打开 https://ai-native-dam.pages.dev/governance/ ,
下次快照刷新后你的系统应出现在「生成的系统」和「部署平面」里;
或直接 `GET http://127.0.0.1:8080/overview`(带 Read 令牌)确认计数。

## 4. 各项目当前差距(2026-11-15 体检)

| 项目 | 缺什么 |
|---|---|
| nexus-dam-agent | manifest 已合规。只需确认接入脚本指向 8080 常驻网关,然后走 §3 |
| TradeFlow | ① 写 `dam.manifest.yaml`;② **把 `scripts/dam-onboard.mjs` 改为打向 `http://127.0.0.1:8080/mcp` 常驻网关**,删掉自启动 8081 网关和写 `data/pg` 的逻辑,令牌改为向管理员索取 |
| Video Batch ID | 写 `dam.manifest.yaml`(mcp.role: server,12 个工具列进 `mcp.tools`) |
| nexus-ecom-matrix | ① 写 `dam.manifest.yaml`;② 接入时把 `DAM_MODE=http`、`AI_NATIVE_DAM_URL=http://127.0.0.1:8080`;③ 9 个 SKILL.md 填进 manifest `skills:` |
| LexNusa | ① 给 `backend/mcp` Worker 加 `GET /health`;② 写 `dam.manifest.yaml`(runtime 用 repo+wrangler 形态) |

## 5. 有问题去哪看

- 工具全量契约:`docs/mcp-tools.md`(权威来源 `packages/shared-schema`)
- 接入契约:`docs/adr/0009-installable-unit-contract.md`
- 网关源码:`packages/mcp-gateway`
