# Compatibility and migration plan / 兼容与迁移

本轮只读审计：`src/pilot/thermal.ts`、`thermal-benchmark.ts`、`thermal-experiment.ts`、`thermal-service.ts`、`thermal-smoke.ts`、`classification.ts`、`value-metrics.ts`，以及 `public/pilot-thermal.*`、`public/i18n/*`、测试、冻结 v1.3 的 23 篇数据及本机三次 Smoke Test **元数据**。未以 Grok 输出反推 v2 标注；未编辑私有文件。公开仓库仅有公开号来源清单，没有冻结全文或真实响应。

## 现有事实与可复用模块

| 模块 | 已实现 | v2 差距 |
|---|---|---|
| 冻结数据 | 23 个 EP 出版版本；`contentHash`、`datasetHash` 与分类哈希核验；`fieldProvenance` | v2 标注须独立 `documentHash`、分区定位、来源快照与 taxonomy 版本；不能改 v1 哈希 |
| Schema / Grok | `THERMAL_SCHEMA` 是 `additionalProperties:false` 的 v1 结构；`thermalPrompt` 写明 `thermal-two-axis-v1`；C 单次请求 | 直接塞入 v2 字段会破坏旧记录；设计新版本 Prompt/Schema，仅在未来获批后启用 |
| D Validator | `validateThermalOutput` 严格引文与来源；诊断列出规范化差异；语义支持未评估 | 新建人工语义支持审核，保留 D 的原有严格条件和离线复用 C |
| A1/A2/A3 | A1 CPC、A2 IPC 回退、A3 规则文本；可统计覆盖与 v1 技术对比 | 旧技术码到 v2 三维仅作候选；须重建 Gold 对照与分母 |
| Portfolio Analytics | v1 `in_scope` 过滤的技术、产品、申请人、年份、法域计数 | 按 v2 tier 与证据等级筛选；申请人/家族归一化仍缺 |
| Gold Review UI | v1 单人可保存 `verified_gold`、可冻结；审阅理由与精确引文 | 需要双人独立工作区、字段级证据、争议/裁决、时间与不可覆盖事件；不能沿用单人状态直接命名 v2 Gold |
| Benchmark | 有 v1 verified 条件、A1–A3 覆盖；v0.3 另有 A/B/C/D 评估 | 分层 relevance、多标签 F1、边界及人工耗时需独立口径 |
| JSON / Markdown | 专题报告会输出 v1 数据、运行记录、D 诊断 | 未来增加带 schemaVersion 的 v2 报告视图；保留旧导出字节/字段含义 |
| EN/ZH i18n | `public/i18n/index.js` 共用 `t()`，`zh-CN.js`/`en.js` 有热专题词条 | 新标签及争议状态添加稳定 key，不翻译原文或 JSON 枚举 |
| Public Tests / CI | `npm run test:public` 106 项，使用合成 fixture、Mock；CI 只读权限与外网拦截 | 增加合成 v2 规则、迁移、双人审阅与导出测试；本地私有重放仍隔离 |

本机审计时 `smart-device-thermal-v1.3-2026-10-24` 的 `datasetHash=59b22b37b2b7a44bd79940e9df83e3b1972a322906359597ee2949193d6ebf37`，`classificationHash=42b7303406a6389a0a2b92da0185cd1a2047ba2cf4a2b85663239fe9ca410c2e`。试验记录有 3 条；未找到独立 `data/smart-device-thermal-reviews.json`，按服务逻辑当前专题 verified Gold 为 0。三次工程试运行不是 v2 训练或 Gold。

## 分阶段实施（本轮不执行迁移）

1. **锁定规范**：用五篇任务做盲法双人试标注；讨论 OPEN_DECISION，发布 `enterprise-thermal-taxonomy-v2.0` 与字典版本。记录起草/复核时间。
2. **旁路存储**：新 `gold-record-v2` 文件或表，键为公开号+文档哈希+taxonomy 版本；追加事件、权限和不可覆盖审计；保留 v1 审阅及 Smoke 数据。
3. **人工 UI**：先只读显示原文，隐藏规则候选及 Grok；逐字段证据、双人盲审、争议与裁决；在完成时才解盲。产品用途与商业实施分开。
4. **验证与导出**：独立 v2 Schema 校验、哈希/来源/精确引文检查及人工语义复核。JSON/Markdown 显示来源、版本、分母、Unknown 和审核链。
5. **基线与模型适配**：建立旧→新候选交叉表，测映射错误；另版本 C Prompt/Schema，绝不重解释三次旧响应。A1/A2/A3 和未来模型在同一 v2 Gold 子集对照。
6. **企业分析**：申请人实体、专利族、日期和覆盖指标加入后，再开放竞争格局与趋势统计。保留可回滚的 v1 展示入口。

## 迁移风险与验收

- v1 `boundary_case` 不是 v2 的单一类；v1 `in_scope` 也不能无证据地升级为 `core_claimed`。v1 `primaryTechnologyCategory` 保留原值，映射列只标 `candidate_unreviewed`。
- `sourceUrl` 必须是完整 EPO URL；不同出版版本/截断输入不能互换。历史请求的 inputHash 与 Prompt hash 不变。
- 现有 UI 的单人 `verified_gold` 选项不能自动成为 v2 Gold；未来迁移只读显示其历史身份。
- 验收门槛：公开合成测试通过，TypeScript 不降级；历史 23 篇哈希及三次用量/响应逐字不变；没有 Key、全文或真实日志进入 Git；v2 无人工双审时正式分类指标仍 unavailable。

粗略复杂度：规范校准中等（主要取决于争议）；旁路存储及双人 UI 较高；三维基线/指标中等；实体归一化与专利族较高。第一阶段应先完成盲法标注与边界裁决，再估算工程排期。

**OPEN_DECISION I1**：私有 v2 Gold 放在单用户本机文件还是带权限的团队存储？多审阅者并发、审计不可变性与备份要求决定方案。
