# ADR 0007: Spec-first 生成（generate / submit_system_spec）

- Status: Accepted
- Date: 2026-11-12

## Context

Roadmap Phase 2 要求"一份 SOP → 一份已审批 Spec"：系统规格必须先落成
可审计的草稿，经审批后才允许进入代码生成（Builder Runtime，后续阶段）。
此前 `generate_system_spec` 只在 shared-schema 有类型、网关没有实现，
`submit_system_spec` 连类型都没有。规格放在哪里、审批语义是什么、
provenance 如何约束，都需要定案。

## Decision

1. System Spec 是第六个治理集合：`GovernanceStore` 增加
   `getSpec/putSpec/listSpecs`，PG 侧表 `system_specs`（entities 用 jsonb，
   迁移参考 `migrations/0004_system_specs.sql`），内存侧 `state.specs`。
2. `generate_system_spec`（medium，两段门）：只做**确定性草稿**——校验
   provenance（每个 source_skill_id 必须有已审批版本、每个
   source_knowledge_id 必须已审批，否则 ToolRejection），调用方给 entities
   就用之，否则生成确定性骨架实体（`{domain}_record`: id/title/status/
   created_at）。网关不含 LLM；真正的智能起草是 Builder Runtime 的职责。
3. `submit_system_spec`（high，两段门）：在本网关里**确认令牌即审批**——
   通过后 draft → approved，approvedBy 取 authenticated principal，
   approvedAt 落时戳。只有 draft 可提交；approved/rejected/generated 态
   拒绝（invalid_status_transition）。审批后内容冻结，改动须另起草稿。
4. SystemSpec 增加 `requirements` 与 `approvedBy` 字段，与 Skill 的
   approvedBy/approvedAt 审计模式对齐。

## Consequences

- "one SOP → one approved Spec" 闭环可跑通：草稿、provenance、审批人、
  审批时间全部持久化并跨重启存活。
- spec 的 rejected/generated 状态留给 Builder Runtime 阶段使用；
  `register_generated_system` 仍 planned。
- LLM 起草（从对话/知识自动写 entities）不在网关内，避免治理平面引入
  非确定性；未来由 orchestration 层调用本工具落草稿。
