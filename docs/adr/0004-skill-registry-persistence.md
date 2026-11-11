# ADR 0004: Skill Registry 持久化（Postgres 双后端）

- Status: Accepted
- Date: 2026-11-12

## Context

Phase 1 的网关把 Skill Registry 放在内存 `Map` 里（`state.skills`），重启即失。
这堵住了真实流程：`skill-sync` 把上游仓库（如 vincent-core）的 SKILL.md
灌入注册表后，服务一重启登记就消失，"注册 → 审批 → 全生态可见"无从谈起。
同时部署环境（docker compose 已有 `postgres` 服务）和本地/教室环境
（无 Docker、无 Postgres 安装）都需要可用方案。

## Decision

1. 抽出 `SkillStore` 异步接口（`get` / `put` / `search` / 可选 `close`），
   工具处理器只面向接口；`MemorySkillStore` 继续包住 `state.skills` 的 Map，
   老测试和 seed 行为不变。
2. `PgSkillStore` 面向一个最小 `PgQueryable` 接口（`query(text, params)`），
   同一份 SQL 同时服务两个后端：
   - `DAM_DATABASE_URL` → `pg` Pool（部署，对应 compose 的 postgres:16）；
   - `DAM_PG_DATA_DIR` → PGlite 嵌入式 Postgres（本地/教室，零安装，文件持久）。
3. 建表幂等自举（`CREATE TABLE IF NOT EXISTS`），参考 DDL 落在
   `migrations/0001_skill_registry.sql` 供 DBA 托管场景审计。
4. 本次只持久化 skills 集合；assets / rights / usage / knowledge 沿用同一
   模式后续迁移，不在本 ADR 范围。
5. 网关分发逻辑改为 `await handler(...)`，同步 handler 不受影响。

## Consequences

- 注册记录跨重启保留（已有测试：PGlite 关闭/重开 + 网关重启后 RPC 可查）。
- 重复注册同一 `id@version` 在数据库主键和应用层双重兜底。
- 本地持久化新增约 9MB 的 PGlite 依赖；不需要持久化的用户零成本（默认内存）。
- `state.skills` 仍由 `MemorySkillStore` 共享，属过渡形态；其他集合迁移到
  各自 Store 后，`GatewayState` 应收敛。

## Verification

- `pg-skill-store.test.ts`：5 个用例全绿，含关闭/重开持久性与网关重启后
  RPC 检索、重复注册拒绝。
- 首次实灌（vincent-core @ 0028da1，13 个 SKILL.md）经两call审批门写入，
  重启后 13/13 以 `pending_approval` 完整保留。
