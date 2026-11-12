# ADR 0006: 审批确认令牌持久化

- Status: Accepted
- Date: 2026-11-12

## Context

ADR 0005 把五个治理集合迁入 Postgres 后，网关只剩一处内存态：
两段式审批（ADR 见 0003 门控语义）的确认令牌由 `InMemoryApprovalStore`
持有。重启（部署、崩溃、教室机器关机）后，已签发未消费的令牌丢失，
客户端只能收到 `invalid_token`，必须重走第一步——审批链在重启处断裂。
ADR 0005 当时将此记录为 fail-closed 的可接受遗留，但实际运营中
"重启后审批链必须能续上"是治理闭环的一部分。

## Decision

1. `ApprovalStore` 接口改异步（`get`/`put` 返回 Promise），与
   `SkillStore` / `GovernanceStore` 同一模式；`ApprovalGate.require`
   随之改 `async`，server 分发处 `await`。
2. 新增 `PgApprovalStore`（`pg-approval-store.ts`），表 `approval_tokens`
   （key / token / created_at / expires_at / consumed），与
   `PgSkillStore`、`PgGovernanceStore` 共享 `openPgBackend()` 的同一后端；
   参考 DDL 在 `migrations/0003_approval_tokens.sql`。
3. 安全语义不变：令牌仍一次性（consumed 落库，重启后不可重放）、仍有
   TTL（expires_at 由门检查，与后端无关）、仍绑定
   (principal, tool, 精确参数) 的 sha256 key。
4. CLI 三个 store 同一线缆；内存模式（无持久化环境变量）行为不变。

## Consequences

- 重启前签发的令牌在重启后仍可完成第二段调用；已消费令牌跨重启不可重放。
  两者由 PGlite 网关级测试锁定。
- 过期令牌永久留在表里（gate 拒绝但不清理）；如需清理可加
  `DELETE WHERE expires_at < now()` 的周期任务，暂不必要。
- 内存模式仍是 dev/test 默认，零行为变化。
