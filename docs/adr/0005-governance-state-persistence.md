# ADR 0005: 治理集合持久化（assets / rights / usage / knowledge / skillUsage）

- Status: Accepted
- Date: 2026-11-12

## Context

ADR 0004 只持久化了 Skill Registry；网关其余五个治理集合
（assets、asset_rights、usage_records、knowledge_entries、skill_usage_records）
仍在内存里（`GatewayState` 的 Map / 数组），重启即失。create_asset、
set_rights、record_usage、approve_knowledge、apply_skill 产生的一切
治理证据都无法跨重启存活，与"审批与使用全程可审计"的目标矛盾。

## Decision

1. 抽出 `GovernanceStore` 异步接口（`governance-store.ts`），覆盖五个集合的
   读写；`MemoryGovernanceStore` 继续包 `GatewayState`，老测试与 seed 不变。
2. `PgGovernanceStore` 复用 ADR 0004 的 `PgQueryable`，与 `PgSkillStore`
   **共享同一个后端连接**：`openPgBackend()`（新 `pg-backend.ts`）统一
   `DAM_DATABASE_URL`（pg Pool）与 `DAM_PG_DATA_DIR`（PGlite）两条路径，
   `PgSkillStore.over(db)` / `PgGovernanceStore.over(db)` 只初始化、不持有
   close，由 CLI 统一关停。
3. 幂等自举 DDL 落为五条 `CREATE TABLE IF NOT EXISTS`，参考脚本在
   `migrations/0002_governance_state.sql`；PGlite 的 `query()` 只接受单语句，
   init 时按分号拆条执行。
4. `searchKnowledge` 的 `onlyApproved` 在 store 层默认 **true**（未审批知识
   默认不可见），与工具 schema 的默认值一致；Memory 与 PG 实现语义逐条对齐。
5. 十个工具处理器全部改 `async` 并只面向 `GovernanceStore`；`apply_skill`
   只经 store 落库，不再直写 `state.skillUsage`，避免双写。

## Consequences

- 网关全部治理状态（Skill Registry + 五集合）在 PG 模式下跨重启持久；
  重启生存性由 PGlite 测试（close/reopen + 网关重启全生命周期）锁定。
- approval token（`InMemoryApprovalStore`）仍是内存态：重启后未消费的
  确认令牌失效，属于安全可接受的 fail-closed，持久化留待后续。
- 内存模式（无 `DAM_DATABASE_URL` / `DAM_PG_DATA_DIR`）行为完全不变。
- 审计查询（按资产查 usage、按 skill 查应用记录）可直接走 SQL。
