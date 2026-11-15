# 资本市场对标与定位:AI 治理层

> 版本:v1.0(2026-11-15)· 用途:客户沟通 / 投资人材料 / 内部战略对齐
> 维护:数据会过时,引用前请复核来源

## 一句话定位

**AI-Native DAM 是 AI 原生软件的"发证机关":Skill、生成系统、蒸馏模型、部署实例的登记、审批、权利、审计,在运行时由 MCP 网关强制执行——不是纸面合规,是机器可验证的信任供应链。**

## 市场规模(第三方口径)

| 来源 | 基年规模 | 预测 | CAGR |
|---|---|---|---|
| Global Market Insights(2026-09) | 2025 年 $839M | 2035 年 $13.07B | 31.4% |
| Mordor Intelligence(2026-08) | 2025 年 $340M | 2031 年 $1.51B | 28.15% |
| Data Bridge(2026-07) | 2025 年 $3.82B | 2033 年 $174.98B | 61.3% |

各家基数口径差异大(治理范围定义不同),但**所有机构的增速预测均为 28%+,方向一致:AI 治理正从"可选项"变成"合规刚需"**。

关键驱动:
- **EU AI Act** 2025 年 2 月起执行,违规罚款最高为全球营收 7% 或 €35M(Mordor);
- **保险业挂钩**:保险公司开始对具备治理认证的企业给保费折扣(Mordor);
- 北美占 46.8% 市场,亚太增速最快(GMI)。

来源:
- https://www.gminsights.com/industry-analysis/ai-governance-market
- https://www.mordorintelligence.com/industry-reports/ai-governance-market
- https://www.databridgemarketresearch.com/reports/global-ai-governance-market

## 直接对标(创业公司,资本市场已定价)

| 公司 | 融资 | 总部 | 产品 | 与 DAM 重合点 |
|---|---|---|---|---|
| **ModelOp** | ~$21M(B 轮 $10M,2024-08,Baird Capital 领投) | 芝加哥 | AI 生命周期治理控制面;Gartner Agent 治理并列最高分;客户含 Fidelity、Prudential、P&G | ★★★★★ 最接近:管 agent/模型生成物的治理平面 |
| **Credo AI** | $41.3M(2024-07 加投 $21M) | Palo Alto | AI Registry(系统/agent 登记、风险分级、审批工作流、审计);客户含 Mastercard、Northrop Grumman;Forrester Wave Q3 2025 领导者 | ★★★★ Registry ≈ 我们的注册表+审批门 |
| **Holistic AI** | $35M(2024-05) | 伦敦 | 运行时治理、100+ 模型测试、policy-as-code;Gartner 风险与合规第一 | ★★★ |
| **Airia** | $100M 创始人资本 | 美国 | 编排+安全+治理一体,500+ 企业客户,Gartner Visionary | ★★★ |
| Relyance AI | $32.1M B 轮 | 美国 | 数据安全+治理 | ★★ |
| Monitaur | $6M A 轮 | 美国 | 受监管行业模型治理,Gartner Visionary | ★★ |

来源:
- https://pitchbook.com/profiles/company/226045-99
- https://aicompliancevendors.com/vendors/credo-ai
- https://newmarketpitch.com/blogs/news/ai-governance-top-startups
- https://www.aimagicx.com/blog/ai-governance-platforms-enterprise-buyers-guide-2026

## 定价参考(企业版年费)

| 档 | 区间 |
|---|---|
| 中小客户(≤25 个模型/用例) | $25K–$60K / 年 |
| 中型(25–100) | $50K–$200K / 年 |
| 企业(100–500) | $150K–$500K / 年 |
| 大型(500+) | $500K–$1M+ / 年 |

来源:aimagicx 买家指南(2026-03,Q1 公开报价与客户报告汇总)。

## "登记处"模式的资本先例

- **JFrog**——软件二进制制品登记处,纳斯达克上市。证明"单一事实源 + 制品治理"可以是上市公司级生意;
- **Hugging Face**——模型登记处,估值数十亿美元。证明"注册表 + 生态"是平台级位置;
- **历史类比**:证券交易所不撮合生产,只裁决"谁能上市、谁退市";App Store 不写 App,审核分发抽成 30%。**生产泛滥时,认证层最贵。**

## DAM 的差异化位置(与上述所有玩家的区别)

| 维度 | Credo / ModelOp 等 | AI-Native DAM |
|---|---|---|
| 治理对象 | 企业**内部**用了哪些 AI 模型(向内看) | AI **生产出来的东西**:Skill、生成系统、蒸馏模型、部署实例(供应链视角) |
| 驱动 | 合规压力(EU AI Act 等) | 生产关系:生成能力泛滥后的信任稀缺 |
| 执行方式 | 工作流+问卷+集成监控信号 | **运行时强制**:MCP 网关,每次调用过审批门,吊销即时生效 |
| 组织形态 | 单企业 SaaS/私有化 | **多项目联邦**:分布式持有、集中裁决,各项目自带 Skill 库,登记处唯一 |
| 资产闭环 | 登记→监控 | 登记→审批→部署→用量→蒸馏→再登记(资产会"长大") |

**关键证据:Credo AI 的 Agent Registry 2025-09-24 才进入公开预览**——说明"治理 agent 生成物"这个方向,头部玩家也刚起步。窗口期是真实的。

## 诚实的差距(对内)

- 对标公司有 $10M–$100M 融资、 Mastercard / Fidelity 级客户、数年营收;DAM 目前有的是:架构完整的三平面 + 29 个在线工具 + 五个排队接入的自有项目。
- 差距不在认知和架构,在**流水**:接入项目数、审计记录量、被治理资产规模,是这个位置的唯一估值语言。
- 近期唯一优先级:把 Nexus-DAM-Agent / TradeFlow / Video Batch ID / Nexus-Ecom-Matrix / LexNusa 五项目完成 L1 登记(见 `docs/onboarding.md`),让大屏上的实例数从 0 变成 5。
