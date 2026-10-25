# Evidence standard / 原文证据规范

版本：`enterprise-evidence-v2-draft`。一条证据只引用一个公开号版本、一个来源分区中的**连续原文**。专利文本保持原始语言；界面翻译不替代证据。每个分类字段都应能追溯到证据 ID，推断也必须说明从哪些事实推断、不能装作原文陈述。

## 证据等级 `evidenceLevel`

| 枚举 | 定义 | 常见可支持内容 |
|---|---|---|
| `claim` / Claim Evidence | 独立权利要求中可定位的原文 | 主张结构及明确限定的设备；不自动证明商业实施 |
| `embodiment` / Embodiment Evidence | 说明书中的具体实施方式及工作关系 | 明确披露的应用及作用路径；不改变 Claim 1 限定 |
| `general_description` / General Description Evidence | 发明内容、概要或未具体化描述 | 技术意图；不足以自动达到具体实施门槛 |
| `background_mention` / Background Mention | 背景技术、现有技术或通用设备例举 | 研究线索；不能单独支持 claimed 或 explicit application |
| `metadata` / Metadata Evidence | 标题、摘要、CPC/IPC、申请人、日期等 | 检索、身份与辅助语境；不证明实施或技术效果 |
| `analyst_inference` / Analyst Inference | 人员从一个或多个原文事实推断 | 候选用途/调查方向，必须标记为推断 |

证据对象的最小字段：

```json
{
  "evidenceId": "E1",
  "publicationNumber": "SYNTHETIC-EXAMPLE",
  "sourceUrl": "https://example.invalid/synthetic",
  "documentHash": "synthetic-example-hash",
  "section": "claims",
  "locator": "Claim 1",
  "sourceSpan": "synthetic continuous source excerpt",
  "evidenceLevel": "claim",
  "supportsFields": ["technicalSolutions"],
  "supportRelation": "supports",
  "exactMatch": null,
  "semanticSupport": "not_assessed",
  "reviewerRationale": "Synthetic illustration only."
}
```

以上 JSON 仅说明字段形状，**不是**真实样本、Gold 或可提交的证据。真实记录另需 `sourceLanguage`、`retrievedAt`、`sectionHash`、Claim/段落定位及可选 `inputSnapshotHash`。建议 `supportRelation` 取 `supports|contradicts|context_only|unverifiable`；`semanticSupport` 取 `supported|unsupported|disputed|not_assessed`，由具名人工审阅者签署。无法获取对应分区、版本或定位时设 `unverifiable`，不能补造引文。

## 两道独立核验

1. **字面与来源**：核对 `sourceSpan` 是否逐字存在于记录的原文版本及正确章节，`sourceUrl` 与公开号版本是否一致。严格 `exactMatch` 优先；Unicode/空格等规范化匹配另记 `normalizedMatch`，不能冒充 exact。输入被截断时，应以实际发送快照检查模型引文。
2. **语义支持**：人工检查引文是否**真的支持指定字段及强度**，并阅读必要上下文、否定词、比较对象和 Claim/实施方式边界。记录 `supported`、`unsupported`、`disputed` 或 `not_assessed` 及理由。第二人处理争议。仅出现 “smartphone” 但语句讨论既有背景设备，不能支持 `explicit_application`。

现有 `diagnoseThermalEvidence` 返回 `span_exact_match`、`normalized_match`、`source_reference_match`、`input_section_available`、`failure_reason`，并明确 `semantic_support: not_assessed`。现有 D Validator 的 `accepted` 仅表示既有 Schema 与严格来源/字面门槛通过，不表示分类正确、证据语义支持或人工 Gold。

## 操作验收

- 每条已采纳标签至少关联一条明确支持该字段的证据；负面排除记录也要给出范围外系统的正面证据及检索过的目标应用范围。
- `Claim 1` 与 `description [0003]` 分别定位；不能跨段拼接、删编号或把摘要当权利要求。
- 对 `background_mention`、`metadata`、`analyst_inference` 默认不允许单独支持 `core_claimed` 或 `explicit_application`。
- `verifiedCommercialImplementation` 需要独立产品证据、产品型号、证据日期和关联论证；专利原文、申请人及模型输出均不足够。未核实时固定为 `unknown`。

**OPEN_DECISION E1**：将来若 EPO XML 无稳定段落编号，采用页码、XML 路径还是字符偏移作主定位？须在实现前约定并保存来源版本。
