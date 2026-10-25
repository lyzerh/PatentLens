# Gold annotation protocol / 人工标准答案协议

版本：`gold-record-v2-draft`。本轮只设计协议和试标注任务，**没有创建 Verified Gold**。标注员先看原文与 taxonomy，不看 Grok 输出或旧模型解释；冻结的 v1 规则候选也先遮蔽，待独立判断完成后再比较。现有 EP4761489A1 人工草稿形成于模型调用后、阅读输出前，不能写成调用前预注册 Gold。

## Gold Record Schema（设计契约，尚未接入生产 API）

| 字段 | 类型 / 规则 |
|---|---|
| `publicationNumber`, `sourceUrl`, `documentHash`, `taxonomyVersion` | 必填；指定同一出版版本及哈希，`taxonomyVersion=enterprise-thermal-taxonomy-v2-draft`；不接受仅专利族号 |
| `industryRelevance` | taxonomy-v2.md 的五值单选 |
| `portfolioTier` | Core Portfolio / Extended Portfolio / Candidate Pool / Excluded / Needs Review；与 relevance 对应，例外需争议记录 |
| `technologyPrinciples`, `technicalSolutions`, `functionalObjectives` | 各维度的标签数组；每项 `code, role, claimRole, basis, evidenceIds`；若不能判断填明确的 `Unknown` |
| `primaryTechnologyCategory` | 保留 v1 兼容字段，记录 `legacyTaxonomyVersion` 和映射状态；不强行由 v2 三维自动回填 |
| `evidence` | evidence-standard.md 的对象数组；每个被采纳结论具字段级支持关系 |
| `annotationRationale` | 逐项说明 Claim、实施语境、排除候选、冲突及不确定性 |
| `reviewer`, `reviewedAt` | 首位人类审阅者标识与 ISO 8601 时间；保留每次修订事件 |
| `reviewStatus` | `draft|reviewed|verified_gold|disputed|insufficient_evidence` |
| `adjudicationStatus` | `not_required|pending|resolved|unresolved`；另存第二审核人、时间、意见差异与裁决理由 |

另建议 `schemaVersion`、`datasetVersion`、`sourceLanguage`、`annotationStartedAt`、`modelOutputSeenBeforeAnnotation`、`reviewDurationSeconds`、`supersedesRecordId`、产品用途的逐项证据等级及独立商业证据状态。所有产品都需各自证据，不把泛称设备自动拆成 Smartphone/Tablet/Laptop。历史数据和 v2 记录采用不同命名空间。

拟定的机器校验骨架如下。细分标签须属于同版本字典，`evidence` 条目还须通过 evidence-standard.md 的来源、定位、精确引文及人工支持检查；单靠 JSON 类型校验不得升级状态。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "GoldRecordV2Draft",
  "type": "object",
  "additionalProperties": false,
  "required": ["publicationNumber", "sourceUrl", "documentHash", "taxonomyVersion", "industryRelevance", "portfolioTier", "technologyPrinciples", "technicalSolutions", "functionalObjectives", "primaryTechnologyCategory", "evidence", "annotationRationale", "reviewer", "reviewStatus", "reviewedAt", "adjudicationStatus"],
  "properties": {
    "publicationNumber": {"type": "string", "pattern": "^EP[0-9]+[A-Z][0-9]+$"},
    "sourceUrl": {"type": "string", "format": "uri"},
    "documentHash": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
    "taxonomyVersion": {"const": "enterprise-thermal-taxonomy-v2-draft"},
    "industryRelevance": {"enum": ["core_claimed", "explicit_application", "potential_application", "out_of_scope", "insufficient_evidence"]},
    "portfolioTier": {"enum": ["Core Portfolio", "Extended Portfolio", "Candidate Pool", "Excluded", "Needs Review"]},
    "technologyPrinciples": {"type": "array", "items": {"$ref": "#/$defs/label"}},
    "technicalSolutions": {"type": "array", "items": {"$ref": "#/$defs/label"}},
    "functionalObjectives": {"type": "array", "items": {"$ref": "#/$defs/label"}},
    "primaryTechnologyCategory": {"type": ["string", "null"]},
    "evidence": {"type": "array", "items": {"$ref": "#/$defs/evidence"}},
    "annotationRationale": {"type": "string", "minLength": 1},
    "reviewer": {"type": "string", "minLength": 1},
    "reviewStatus": {"enum": ["draft", "reviewed", "verified_gold", "disputed", "insufficient_evidence"]},
    "reviewedAt": {"type": ["string", "null"], "format": "date-time"},
    "adjudicationStatus": {"enum": ["not_required", "pending", "resolved", "unresolved"]}
  },
  "$defs": {
    "label": {
      "type": "object",
      "additionalProperties": false,
      "required": ["code", "role", "claimRole", "basis", "evidenceIds"],
      "properties": {
        "code": {"type": "string"},
        "role": {"enum": ["primary", "secondary"]},
        "claimRole": {"enum": ["claimed", "ancillary", "unknown"]},
        "basis": {"enum": ["explicit", "inferred", "unknown"]},
        "evidenceIds": {"type": "array", "items": {"type": "string"}}
      }
    },
    "evidence": {
      "type": "object",
      "required": ["evidenceId", "publicationNumber", "sourceUrl", "documentHash", "section", "locator", "sourceSpan", "evidenceLevel", "supportsFields", "supportRelation", "semanticSupport"],
      "properties": {
        "evidenceId": {"type": "string"},
        "publicationNumber": {"type": "string"},
        "sourceUrl": {"type": "string"},
        "documentHash": {"type": "string"},
        "section": {"enum": ["title", "abstract", "claims", "description", "metadata"]},
        "locator": {"type": "string"},
        "sourceSpan": {"type": "string"},
        "evidenceLevel": {"enum": ["claim", "embodiment", "general_description", "background_mention", "metadata", "analyst_inference"]},
        "supportsFields": {"type": "array", "items": {"type": "string"}},
        "supportRelation": {"enum": ["supports", "contradicts", "context_only", "unverifiable"]},
        "semanticSupport": {"enum": ["supported", "unsupported", "disputed", "not_assessed"]}
      }
    }
  }
}
```

## 状态机及确认门槛

`draft` 为第一位标注员未提交；`reviewed` 表示已提交、来源与字段检查完成，但尚未达到 Gold 条件。`insufficient_evidence` 是证据不可用或冲突待补；`disputed` 是有实质性分类分歧。二者不得计入正式准确率。

`verified_gold` 仅在原文版本与哈希锁定、必填项完整、字段证据及语义支持人工检查、独立复核意见一致（或具名裁决解决差异）后生成。边界、跨行业排除、`explicit_application` 与任一两人不一致的记录**必须**第二人独立复核。其他记录在试点阶段也全部双人复核，之后是否抽样由企业事先批准。任何审阅者均不得由 Grok 输出充当。若只有一人，结果最多 `reviewed` 临时参考。

裁决不得删除初始意见：保留 reviewer A/B 的原始记录、证据、时间、模型输出是否已见、冲突字段与裁决事件。原文变化或 taxonomy 版本变化时，旧 Gold 留档，新建重审任务；不原地改写。只有 `reviewStatus=verified_gold`、`adjudicationStatus=resolved|not_required` 且版本/哈希匹配者可计入 v2 指标。试点阶段 `not_required` 不能绕过双人门槛。

## 五篇试标注任务（尚无 v2 判定）

任务按指定出版版本建立，仅显示数据可用性及待回答问题。下列 v1 候选标签不作为答案；首轮标注界面须隐藏旧参考、历史 Grok 和 A3 输出。哈希来自本机冻结 v1.3 数据，只用于定位同一原文；公开文档不复制第三方全文。

| 公开号与文档哈希 | 当前可用性 | 独立审核问题 |
|---|---|---|
| [EP3149425B1](https://data.epo.org/publication-server/rest/v1.2/patents/EP3149425NWB1/document.xml) · `40714c950db7c8788baefa0eedae9a66911e7dbce05e5f7de797aa5a6e4bff5d` | Claim 1、说明书有；摘要缺 | 终端限定是否在 Claim 1；分别审查具体产品标签及均热结构 |
| [EP4498205A1](https://data.epo.org/publication-server/rest/v1.2/patents/EP4498205NWA1/document.xml) · `bfcf9c30332e28b45cbe75231d0f82ab39d97a7cab30936e44db1529f1c63ab6` | Claim 1、摘要、说明书有 | 主动散热方案的主张特征、设备归属、CPC/IPC 是否仅辅助 |
| [EP4761489A1](https://data.epo.org/publication-server/rest/v1.2/patents/EP4761489NWA1/document.xml) · `2aff6af35e80a495915c96f43f717239c25c5e57b314ad4997cd8792ff6dd0ef` | Claim 1、摘要、说明书有 | 均热板 Claim 与说明书产品语境的强度；背景举例还是具体实施 |
| [EP4015272B1](https://data.epo.org/publication-server/rest/v1.2/patents/EP4015272NWB1/document.xml) · `3cc2e3550480f60d248067c54574e84dabc6d1751a24f59165a0a98e1c5d3dae` | Claim 1、说明书有；摘要缺 | 范围外系统是否清楚、是否存在独立的目标设备实施披露 |
| [EP4476289B1](https://data.epo.org/publication-server/rest/v1.2/patents/EP4476289NWB1/document.xml) · `162e7ab834ee147fcbdd7229284d746c0b287882af8fb363c4cfdafcc5bceb79` | Claim 1、说明书有；摘要缺 | 材料方案与产品用途是否有直接证据；何处只能标为潜在 |

以上五篇均为 `draft_task_pending`，未提交任何 v2 Gold。数据源及 Claim/说明书均须在审核当天再次核对。三篇缺摘要不必然等于整体 `insufficient_evidence`；是否影响判断要逐篇说明。

**OPEN_DECISION G1**：正式 Gold 的裁决人是否允许同时担任任一初审人？建议独立第三人处理持续分歧。

**OPEN_DECISION G2**：公开项目如何展示审阅者身份而不泄露企业人员资料？建议内部使用稳定假名，公开仅汇总。
