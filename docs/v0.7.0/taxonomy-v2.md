# Enterprise thermal taxonomy v2 / 企业热管理分类规范

版本：`enterprise-thermal-taxonomy-v2-draft`。稳定字段名用英文；中文仅用于界面。此设计不替换冻结 `thermal-two-axis-v1`、`THERMAL_SCHEMA` 或历史结果。

## Industry Relevance：`industryRelevance`

分类对象是**该公开号版本中披露的技术与目标智能终端的关联程度**，不是商业实施、侵权或权利要求法律解释。审阅者先读独立权利要求，再读具体实施方式，最后读背景与元数据。

| 枚举值 | 必要证据与可操作判定 | 不足以成立的证据 | 研究组合 |
|---|---|---|---|
| `core_claimed` | 可用的独立权利要求逐字限定目标终端，或明确归属于该终端的部件，并且所主张的热管理方案与之相连 | 仅标题、CPC、申请人或说明书提手机；笼统的 “electronic device” | Core Portfolio |
| `explicit_application` | 权利要求未明确限定目标终端；说明书具体实施方式明确把**该技术方案**应用到目标终端，能定位实施段落与作用路径 | 背景技术罗列 “phone/tablet/computer”、泛化的 “may be used in”、无技术连接的清单 | Extended Portfolio |
| `potential_application` | 热管理方案可核实；目标应用只有分析推断、背景举例或泛称设备，缺少可定位的具体实施披露；记录推断理由 | 把可移植性写成已披露用途 | Candidate Pool |
| `out_of_scope` | 可用原文把方案明确锚定在范围外系统，且复查后没有足以纳入的目标实施证据 | 仅没有检出 “phone” 一词、只有缺失文本 | Excluded |
| `insufficient_evidence` | Claim 1 或关键说明书缺失、版本冲突、翻译歧义或相互矛盾的证据使上述判断不可靠 | 用 `out_of_scope` 代替数据缺失 | Needs Review |

以上研究组合是筛选优先级，**不是**专利法律保护范围。组合字段 `portfolioTier` 与枚举一一对应，人工保留覆盖理由，不允许模型分数直接升级。

### 决策顺序与排他性

1. 锁定 `publicationNumber`、`sourceUrl`、`documentHash`、语言与证据范围。若关键文本缺失或版本冲突足以改变结论，先选 `insufficient_evidence`。
2. 判断是否有可辨认的热管理技术方案。仅有目标产品名称而没有专题相关方案，选 `out_of_scope`；若文本不足，回第 1 步。
3. 在 Claim 1 中找目标设备或明确终端部件及其与方案的连接。成立则 `core_claimed`。
4. 否则查看**具体实施方式**是否同时说明目标设备、该方案如何在其中工作及可定位位置。成立则 `explicit_application`。
5. 否则若证据明确锚定汽车、工业设施等范围外系统，且无目标实施披露，选 `out_of_scope`。
6. 其余有热技术但目标场景未直接披露的，选 `potential_application`。若目标场景的冲突证据无法消歧，选 `insufficient_evidence` 并升级。

每篇仅一个 `industryRelevance`；产品用途可多标签，各产品分别记录 `claimed`、`embodiment`、`background`、`inferred` 或 `unknown`。多个产品共同出现不自动提升等级；“phone、tablet、computer” 的列表若没有实施连接，只是背景提及。通用均热板即使可能用于手机，仍须经过 Claim 或实施方式证据门槛。汽车散热文献不能因为热交换原理可迁移而进入核心组合。

**OPEN_DECISION T1**：在说明书中仅写 “may be used in a mobile phone” 且无结构/工作方式连接时，是否始终视为背景/潜在？草案按 `potential_application`；正式版本需双人样例校准。

**OPEN_DECISION T2**：`out_of_scope` 与 `potential_application` 在明确汽车权利要求、同时泛称 “electronic device” 的混合文献中如何裁决？先升级争议，不能凭关键词自动覆盖。

## 三维技术字典

三个维度相互独立，`Unknown` 是各维度的合法值，表示证据不足；`Other` 仅在技术可辨而字典未覆盖时使用。每个维度允许多标签：`primary` 最多一个、`secondary` 去重且不得重复主标签。主标签优先描述 Claim 1 的必要技术特征；仅说明书披露的标签标注 `claimRole: ancillary`，不得伪装成主张核心。

| 维度 / 字段 | 一级类别 → 示例细分代码 | 判定焦点 |
|---|---|---|
| Technology Principle / `technologyPrinciples` | `Heat Transfer` → `Phase-change Heat Transfer`, `Thermal Conduction`, `Forced Convection`; `Control` → `Temperature Feedback Control`; `Unknown`, `Other` | 热量或控制作用的物理/逻辑机理 |
| Technical Solution / `technicalSolutions` | `Passive Structure` → `Vapor Chamber`, `Heat Pipe`; `Material & Interface` → `Thermal Interface Material`; `Active Hardware` → `Cooling Fan`; `Sensing` → `Temperature Sensor`; `Control Software` → `Thermal Control Algorithm`; `Unknown`, `Other` | 具体主张的结构、材料、器件或算法 |
| Functional Objective / `functionalObjectives` | `Thermal Outcome` → `Hotspot Reduction`, `Temperature Uniformity`, `Heat Dissipation Efficiency`; `System Outcome` → `Energy Consumption Control`, `Device Performance Stability`; `Unknown`, `Other` | 原文说明要改善的效果；不能从结构自行推定性能收益 |

字典以版本化条目存放：`code`、`parentCode`、中英文显示名、定义、包含/排除规则、典型证据、`deprecatedBy`。标签记录包含 `code`、`role: primary|secondary`、`claimRole: claimed|ancillary|unknown`、`basis: explicit|inferred|unknown`、`evidenceIds`。关键词命中只形成候选，CPC/IPC 只是辅助元数据；两者都不能单独证明技术方案或功能效果。

例：Claim 1 若逐字限定均热板，`Vapor Chamber` 可作为方案候选；`Phase-change Heat Transfer` 仍须原文说明相变机制；`Hotspot Reduction` 仍须原文陈述或人工标为推断，不能从 “vapor chamber” 自动推出。Claim 1 若限定风扇而背景列出均热板，风扇可为主方案，背景均热板不进入已主张标签。

## 旧版兼容映射：只生成候选

| v1 `primaryTechnologyCategory` | v2 候选方向 | 不可自动推断 |
|---|---|---|
| Passive Cooling Structure | Passive Structure；视证据选 Vapor Chamber / Heat Pipe | 相变机理、具体产品、功能效果 |
| Thermal Materials & Interfaces | Material & Interface；视证据选 Thermal Interface Material | 材料配方机理与实施产品 |
| Temperature Sensing & Monitoring | Sensing；视证据选 Temperature Sensor | 反馈控制算法 |
| Active Cooling | Active Hardware；视证据选 Cooling Fan 等 | 仅凭 CPC 判定主张为风扇 |
| Software / Dynamic Thermal Control | Control Software | 具体传感器、节能效果 |
| Power-Thermal Coordination | Control Software 或跨域 `Other`，人工定夺 | 必然属于温度反馈控制 |
| Other / Uncertain | Other / Unknown 候选，人工重审 | 任一具体 v2 子类 |

`in_scope` 可能对应 `core_claimed` 或 `explicit_application`；`boundary_case` 可能对应 `explicit_application`、`potential_application` 或 `insufficient_evidence`；`uncertain` 不能机械等同新标签。保留旧字段与旧评估口径，新增旁路版本和人工交叉表。
