# PatentLens — 企业专利管理与技术研究辅助系统

[![Public CI](https://github.com/lyzerh/PatentLens/actions/workflows/ci.yml/badge.svg)](https://github.com/lyzerh/PatentLens/actions/workflows/ci.yml)

[中文](#中文) | [English](#english)

## 中文

PatentLens 是面向企业知识产权专员和研发协作者的**本机研究原型**。它帮助团队登记收到的文献，保留来源及更正履历，整理技术标签、逐字引文和研究备注；需要时可选用免费规则或受控付费模型生成技术特征候选。**基本管理与人工研究无需 AI。**

**[图文用户指南：按企业场景操作](docs/user-guide/README.md)** · [能力与限制](docs/user-guide/capabilities.md)

### 解决什么问题

研发提出“找出已有散热方案并说明区别”时，IP 专员需要核对公开号、整理来源、阅读权利要求、保存差异和证据，并在下次讨论时恢复研究。PatentLens 集中这些小规模专题资料，减少重复整理；技术解释仍需人员核验。它不等于完整企业 IPMS 或全球检索系统。

| 企业场景 | 实际产出 | 入口 |
| --- | --- | --- |
| 收到一批专利资料 | 去重登记、当前元数据、原值与更正履历 | `/pilot` |
| 整理散热等专题 | 登记记录筛选；已有解析记录的技术字段检索 | `/pilot`、`/patent-repository` |
| 了解一项技术方案 | Claim 1 原文、可选机器候选要素／限定／关系及证据 | `/patent-features` |
| 向研发说明两篇专利区别 | 人工差异与双方逐字引文；可选机器候选对应 | `/patent-compare` |
| 持续研究与分享 | 保存文献、备注、所选版本，导出 Markdown／JSON | 研究集合 |

### 已支持的工作与边界

- **登记：** CSV／JSON 导入提交的字段，EPO XML 可在线读取。按公开号去重；标题、申请人、日期等允许字段可带原因更正，保留原值与履历。可添加自填人工标签。
- **检索：** `/patent-search` 用于原始在线检索和粘贴文本测试，**粘贴不等于登记**；`/pilot` 查已登记记录；特征库只查已有解析记录，区分原文候选命中与结构化字段命中。
- **研究：** 无技术特征记录仍能人工比较已登记文献、保存双侧原文引文。免费 Rules 和可选 Grok 生成的是机器候选，证据定位通过不证明技术解释正确。
- **集合：** 保存人工研究或选定版本的特征记录，刷新后继续编辑并导出。集合不是企业权属资产台账。
- **统计与高级实验：** `/pilot` 按明确口径统计文献、年份、申请人和法域；技术领域分布只计已确认分类。AI 分类、模型对照和价值验证属于旧版高级实验，未成为主研究流程的审核结论。

### 无 Key 快速演示

需要 Node.js 24+ 和 npm。在干净克隆运行：

```bash
npm ci
npm run demo:portfolio
```

打开[工作台](http://127.0.0.1:4323/workspace)。在 [`/pilot`](http://127.0.0.1:4323/pilot) 导入[三篇合成登记样本](docs/user-guide/demo-registry.json)，可按[指南](docs/user-guide/README.md)完成人工研究。要体验免费解析，在[特征库](http://127.0.0.1:4323/patent-repository)选择 EP9000001A1，预览并运行 Rules 批量入库，再查看技术特征。**EP9000001A1–EP9000004A1 及 EPO 格式链接均为 Synthetic／mock 占位，不是真实专利来源。**不要把样本导入私人登记册。演示无需 EPO 网络或 xAI Key。

### 产品边界

机器候选的格式与引文位置检查不证明语义正确；候选对齐不证明技术等同。系统不提供侵权、FTO、有效性或商业价值结论。23 篇真实文献是有限实验样本；三次历史 xAI 工程试运行不构成准确率，独立核实的 Verified Gold 仍为 **0**。正式多人权限、完整法律状态管理和生产级安全／可靠性尚未验证。

### 技术、数据、测试与许可

流程：登记／原文 → 可选 Rules 或受控 Grok → 技术特征候选与证据 → 检索／比较 → 研究集合。前端为原生 HTML/CSS/JavaScript，后端为本机 Node.js，分析与验证核心使用 TypeScript；中英文切换不改变原文和存储字段。详见 [Feature Schema](docs/v0.8.0/patent-feature-v1.md)、[特征库](docs/v0.8.0/patent-repository-v1.md)和[人工审核](docs/v0.7.0/human-annotation-pilot.md)。

`npm start` 默认使用 `http://127.0.0.1:4317/`。公开仓库不含真实全文、Grok 响应或私有修订。可用 `node scripts/rebuild-public-thermal.js` 建立**新的** EPO 快照；接口、版本及使用条款会影响结果，新快照不能替代冻结历史。公开[来源清单](samples/thermal-23-manifest.json)只含公开号与链接。

```bash
npm run typecheck
npm run test:public
npm run test:local
```

公开测试用合成 fixtures 和 Mock Provider，无密钥与付费请求；本机完整测试另检查私有冻结数据，干净克隆不要求通过。CI 只运行公开测试及类型检查。xAI Grok 4.3 真实请求需要本机服务端密钥、免费预检、费用确认和一次性授权，可能收费；预算预留不是服务商账单上限。

原创源码采用 [MIT License](LICENSE)，Copyright (c) 2026 Jannam Ng；MIT 不覆盖 EPO 全文、第三方数据或依赖。再利用真实资料请查阅 [EPO 数据说明](https://www.epo.org/en/searching-for-patents/data/linked-open-data)、[公平使用政策](https://www.epo.org/en/service-support/ordering/fair-use)和[网站条款](https://www.epo.org/en/terms-of-use/terms-and-conditions-use-website-european-patent-office)。

## English

**PatentLens — Enterprise Patent Management and Technical Research Assistant** is a local prototype for IP staff and engineering collaborators. It registers patent materials, preserves source and correction history, supports human tags, exact quotations and research notes, and optionally generates feature candidates with free rules or a controlled paid model. **Basic registry and manual research work without AI.** See the [illustrated scenario guide (Chinese)](docs/user-guide/README.md) and [capabilities and limits](docs/user-guide/capabilities.md).

### Five enterprise scenarios

| Task | Supported outcome | Entry |
| --- | --- | --- |
| Receive documents | Deduplicated registry, current metadata and correction history | `/pilot` |
| Build a technical topic set | Filter registered documents; search structured fields in already extracted records | `/pilot`, `/patent-repository` |
| Understand a claim | Read Claim 1; optionally inspect candidate elements, limitations, relations and quotations | `/patent-features` |
| Explain two solutions to R&D | Manual differences with both exact quotations; optional machine candidate alignments | `/patent-compare` |
| Continue and share work | Save documents, notes and selected versions; export Markdown or JSON | Research collections |

CSV/JSON import stores submitted registry fields; online EPO XML import fetches source fields. The separate `/patent-search` page searches external sources and accepts pasted text **for testing, not registry import**. The feature repository searches existing extraction records, not every registered patent; text candidate and structured field hits differ. `/pilot` provides counts and distributions under stated rules. Its AI classification, model comparison and value tools are legacy advanced experiments, not accepted business findings. Collections organize research, not ownership.

### Quick demo without an API key

Requires Node.js 24+ and npm. In a clean clone run `npm ci` and `npm run demo:portfolio`, then open [Workspace](http://127.0.0.1:4323/workspace). Import the [three synthetic registry entries](docs/user-guide/demo-registry.json) at `/pilot` for the manual workflow. For free feature extraction, select EP9000001A1 in `/patent-repository`, preview and run the Rules batch, then inspect `/patent-features`. EP9000001A1–EP9000004A1 and EPO-shaped URLs are **synthetic/mock placeholders, not real sources**. Keep them out of private registries.

### Product limits

Schema validity and exact quotations do **not** establish technical meaning; candidate alignment does **not** establish equivalence. PatentLens gives no infringement, freedom-to-operate, validity or valuation conclusion. The 23-document real topic set is limited. Three historical xAI engineering runs support no accuracy claim; independently verified Gold remains **0**. Multi-user permissions, full legal-status management and production security/reliability are not established.

### Technology, data, tests and licensing

Flow: registry/source → optional free Rules or controlled Grok → feature candidates with evidence → search/comparison → collections. Native HTML/CSS/JavaScript, a local Node.js server and TypeScript analysis/validation power the UI; switching languages does not change source text or stored fields. `npm start` defaults to `http://127.0.0.1:4317/`. Public source omits full patent text and private Grok records. A new snapshot can be reconstructed with `node scripts/rebuild-public-thermal.js`, subject to EPO availability, revisions and terms; it cannot replace frozen historical inputs. See the [publication manifest](samples/thermal-23-manifest.json), [Feature Schema](docs/v0.8.0/patent-feature-v1.md) and [repository notes](docs/v0.8.0/patent-repository-v1.md).

Run `npm run typecheck` and `npm run test:public` in a clean clone. `npm run test:local` additionally needs private local data; CI runs public tests and type checking. Real xAI Grok 4.3 use requires a server-side key, free preflight, explicit cost confirmation and one-use authorization; it may incur charges, and budget reservations are not a provider billing cap.

Original code is under the [MIT License](LICENSE), Copyright (c) 2026 Jannam Ng. MIT does not license EPO full text, third-party data or dependencies. Consult [EPO data information](https://www.epo.org/en/searching-for-patents/data/linked-open-data), [fair use policy](https://www.epo.org/en/service-support/ordering/fair-use) and [website terms](https://www.epo.org/en/terms-of-use/terms-and-conditions-use-website-european-patent-office) before redistributing source material.
