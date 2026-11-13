# ADR 0010: Builder Runtime — Spec → System 编译执行平面

- Status: **Accepted**（2026-11-13）
- Deciders: governance plane maintainers

## Context

Phase 2 治理闭环已完整落地（`generate_system_spec` → `submit_system_spec` →
`register_generated_system` / `search_systems`，见 0dff09f）。但从
**approved Spec** 到 **可注册的系统** 之间仍靠人肉桥接：得有人读 Spec、写代码、
再回来调用注册工具。Builder Runtime 要把这一段自动化，同时不破坏既有决策：

- **ADR 0007**：网关不含 LLM；一切非确定性生成属于执行平面。
- **边界规则**：执行平面只能通过 MCP 读写治理平面，不得自建审批/权限逻辑，
  不持有私有状态。
- **ADR 0009**：产物要满足 InstallableUnit 分层契约（至少 L1）才有部署资格。
- **README 技术栈**：模型路由走 OpenSquilla SquillaRouter，C0–C3 分层。

## Decision

### 1. 三个组件，各自是独立部署单元

| 组件 | 职责 | 关键约束 |
|---|---|---|
| `runtime/orchestrator` | 任务驱动器，状态机：`approved spec → compile → verify → register` | **唯一**与 DAM 网关对话的组件（MCP client） |
| `runtime/model-router` | OpenSquilla 适配层，全部 LLM 调用的唯一出口 | 每次调用落 run-local 记录（model / prompt 摘要 / tokens），供 provenance 与成本核算 |
| `runtime/compilation` | Spec → Blueprint → System 编译管线 | 纯函数式管线，不直接触网；LLM 需求经 model-router，治理需求经 orchestrator |

orchestrator 是协调者：它向网关读工作、向 compilation 派工、在验证通过后
向网关申请注册。compilation 与 model-router 都不知道网关存在。

### 2. Blueprint 是一等中间制品，但不进治理平面

Blueprint（技术栈选择、模块划分、文件清单、prompt plan）是**过程产物**，
存于执行平面的 run 工作区；其摘要（内容 hash + 关键决策列表）随注册调用
进入 System 的 provenance。治理平面只治理两个端点：Spec（输入）与
System（输出）。

*已排除的备选*：Blueprint 作为第八类治理资产。拒绝理由：它不承载
rights/approval 语义，进治理平面只会稀释"资产"的含义。若未来需要跨团队复用
Blueprint 模板，那是 Phase 5（meta-generation）的 Spec 模板问题，不是资产问题。

### 3. 人机门位置：编译前不拦，注册前必拦

- Spec 已被人工审批（`submit_system_spec`）→ 编译**不再**加审批门，避免双重审批疲劳。
- `register_generated_system` 本身是 high/gated → orchestrator 发起调用后，
  仍由人通过 confirmation token / elicitation 放行。自动化到"待人工放行"为止。
- 编译或验证失败：Spec 停留 `approved`，执行平面只产生 run-local 文件与日志，
  **对治理平面零写操作**。

### 4. 注册前的确定性验证门（verify-before-register）

orchestrator 仅在全部通过后才有资格调用 `register_generated_system`：

1. **结构**：文件清单完整；`dam.manifest.yaml` 存在且合法（ADR 0009 L1 的
   声明式打包、无硬编码秘密、标准 `/health`）。
2. **可执行**：沙箱内依赖安装 + 构建 + 冒烟测试通过。
3. **溯源**：每个生成文件可回溯到 Blueprint 条目，再回溯到 Spec entity；
   溯源断链 = 验证失败。

验证报告作为 run artifact 留存，摘要在注册时随附。

### 5. orchestrator → 网关的 MCP 调用面（只允许这些）

| 方向 | 工具 | 用途 |
|---|---|---|
| 读 | `search_specs(status=approved)` | 发现可编译工作 |
| 读 | `search_skills` / `search_knowledge` | 取 Spec 声明的 provenance 内容作为生成上下文 |
| 写（gated） | `register_generated_system` | 验证通过后申请注册 |
| 写（gated） | `apply_skill` | 每调用一个 skill 辅助生成就留 usage record —— 喂养蒸馏阈值（ADR 0003/0008） |

明确**不**调用：任何直接改 Spec 状态的途径（spec 状态机只有网关能动；
`register_generated_system` 会自动流转 `approved → generated`）。

### 6. 模型分层与成本护栏

- C3：仅用于 Blueprint 规划与编译失败后的修复推理。
- C2：复杂工作流逻辑、跨模块一致性检查。
- C1：常规 CRUD / 页面 / 测试样例。
- C0：文件骨架、样板代码、格式化。
- model-router 对每个 run 输出成本汇总；超出 run 级预算阈值即熔断为
  `failed`，等待人工调整 Spec 或预算。

### 7. Run 生命周期

```text
queued → compiling → verifying → awaiting_registration → registered
                              └──→ failed（可重入；同一 spec 可反复 compile，幂等）
```

Run 是执行平面的本地实体，不是治理资产；但 run id 与验证摘要进入注册上下文，
保证 System → Run → Blueprint → Spec 四级回溯链完整。

## Consequences

- Phase 2 闭环从"人肉桥接"变为"自动编译到待放行"；人工决策集中在两个既有
  审批点（submit、register），没有新增门。
- 每次生成都经 `apply_skill` 留痕 → 蒸馏管线持续获得真实用量信号。
- 验证门把注册质量前置为确定性检查，人工放行只看摘要不看代码。
- 风险：orchestrator 持有 Edit scope 凭证 → 需要专用窄权限 principal
  （见 Open Questions）；LLM 成本集中在 model-router，需要预算护栏落地。

## Open Questions（评审要点）

1. `register_generated_system` 是否需要演进 schema 以携带 `blueprint_hash` /
   `verify_report_ref`？（当前契约未含，需 shared-schema 小版本演进）
2. orchestrator 的 principal 形态：独立 token + 窄 scope？是否引入
   第四 scope（如 `Build`）与现有 Suggest/Read/Edit 并列？
3. 验证沙箱形态：本地 `docker run` 一次性容器？devcontainer？还是先做
   纯静态检查 + 构建，冒烟测试后置？
4. Mangaba AI（README 既定 agent runtime）现在引入，还是先用最小
   ReAct loop 跑通、Phase 3 再替换？

## Deferred

- Mangaba AI 深度集成、A2A 入口（Phase 3）、并行编译队列、Blueprint 模板库（Phase 5）。
