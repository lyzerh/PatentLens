# Enterprise benchmark design / 企业导向评估

版本：`enterprise-benchmark-v2-draft`。所有正式分类指标要求版本、哈希匹配的 `verified_gold`；当前数量为 **0**，故正式准确率、Precision、Recall、F1 均为 `unavailable`。报告必须同时列分母、拒绝数、未知数和置信范围，不用 23 篇小样本宣称总体性能。

记 TP/FP/FN 为预先定义的正类混淆矩阵；零分母返回 `null` 而非 0。多维标签比较采用同一 taxonomy 版本和同一出版版本。A1/A2/A3 与 C/D 只在同一 Gold 子集上对照；D 拒绝的项目计入覆盖与拒绝统计，不能从总体指标中悄悄删除。

| 指标 | 计算与字段 | 纳入、排除及人工条件 | 企业解释 |
|---|---|---|---|
| Core Portfolio Precision | TP/(TP+FP)，正类 `core_claimed`；预测 tier、Gold tier | 已验证 Gold；预测 Core 为分母；争议、缺失排除并列数 | 核心组合中误收比例 |
| Core Portfolio Recall | TP/(TP+FN)，Gold `core_claimed` 为分母 | 同一已验证 Gold 集；须审核漏收样本，不能把未检索文献当 TN | 已标注核心文献的漏收 |
| Industry Relevance Macro-F1 | 五个 relevance 类各自 `2TP/(2TP+FP+FN)` 的宏平均 | 预先锁定标签全集；零支持类报告为不可估，不以 0 掩饰；逐类给支持数 | 边界与少数类的均衡表现 |
| Multi-label Technology F1 | 每文每维以标签集合求 TP/FP/FN，给 micro 与按类别 macro F1；主标签另列准确率 | 三维分别算；Unknown/Other、主次/推断口径事先固定；需 Gold 字段级审核 | 技术路线识别与过度分类 |
| Boundary-case Agreement | 在人工指定边界队列中，预测与 Gold 的确切 relevance 一致数/Gold 边界数；另给 Cohen κ 若双人初审完整 | 分母需独立人工标定；不得把 v1 `boundary_case` 当 v2 Gold | 复杂纳入边界的可靠性 |
| Evidence Exact Match Rate | 严格原文且来源匹配的引文数/所有提交引文数 | 必须有实际输入快照、section 和来源版本；规范化命中另列 | 引文可追溯性 |
| Evidence Semantic Support Rate | 人工判定 `supported` 的字段-引文关系数/已人工判断关系数 | 只计已具名审查，另报 `not_assessed` 数；不以 D accepted 替代 | 证据是否真的支撑结论 |
| Human Review Time | 从开始到提交的有效人工秒数中位数及 P75；复核时间另列 | 记录暂停与返工；同任务/同人员口径对照，排除未记录者 | 人工节省/负担 |
| Review Escalation Rate | 进入二次审核或裁决的文献数/首轮已提交文献数 | 事先定义触发器，边界必审与意外升级分列 | 复杂案件工作量 |

## 不可替代的五条评价线

1. **规则覆盖**：A1 为 CPC 命中、A2 为 CPC 缺失时 IPC 回退、A3 为规则文本分类；报告 `applicable/N`、`classified/N`、冲突数。覆盖率不等于正确率。现有代码的 A3 从标题、摘要、Claim、说明书正则取证，会生成 provisional 结果。
2. **AI 分类**：C 或 B 需与独立 v2 Gold 比较；没有 Gold 即 unavailable。模型对产品的推断与已披露用途分开评分。
3. **Schema 合规**：有效结构化响应数/已尝试 C 响应数；不能说明业务正确。
4. **原文证据匹配**：D 的严格字面与来源检查，需报告输入分区可用性及规范化但非精确的数量。
5. **语义支持**：独立人工逐字段审查；D 当前的 `semanticSupportRate=null`，不能以 `evidenceSupportRate` 字段名误读为语义支持。

未来申请人归一化：以人工核对的企业实体为 Gold，给 pairwise precision/recall、合并与拆分错误。同族归并：以人工核对的优先权/家族关系为 Gold，给链接 precision/recall 及重复计数影响。竞争对手统计：先显示检索覆盖、实体归一化与家族去重率，再报告企业份额和年份趋势；附未解决的申请人变更/共同申请。任何指标需样本框、时间窗、检索式和抽样方法。

**OPEN_DECISION M1**：Macro-F1 对无 Gold 支持的类别选择不纳入平均或判为不可报告；建议正式企业报告只在各重点类达到预设最小支持数后公布总分。

**OPEN_DECISION M2**：以文献还是专利族为核心组合的最终统计单位？试点按公开号，未来二者并列且不得混报。
