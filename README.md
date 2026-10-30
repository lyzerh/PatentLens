# PatentLens · AI Patent Feature Research Prototype

[![Public CI](https://github.com/lyzerh/PatentLens/actions/workflows/ci.yml/badge.svg)](https://github.com/lyzerh/PatentLens/actions/workflows/ci.yml)

[中文](#中文) | [English](#english)

## 中文

PatentLens 是面向智能终端产业的本机研究原型：将专利 Claim 1 解析为可追溯的技术要素，供知识产权与研发人员检索、比较和整理研究集合。它展示可复核的工程流程，不提供法律结论。

### 五分钟无 Key 演示

需要 **Node.js 24+** 和 npm。在仓库根目录运行：

```bash
npm ci
npm run demo:portfolio
```

打开 [http://127.0.0.1:4323/patent-repository](http://127.0.0.1:4323/patent-repository)，按以下顺序操作：

1. 选择 **EP9000001A1** 与 **EP9000002A1**，点击“预览批量任务”及“运行批量入库”。这一步只执行免费 Rules 提取。
2. 搜索技术要素 `resin`；通过“查看单篇特征”查看 Claim 1、原文定位和 Coverage Review。
3. 将两篇设为 A/B，打开比较页，点击“生成免费比较”；查看候选对应、数值基准差异和双方引文。
4. 返回特征库，创建研究集合，加入两篇记录；刷新页面后重新选择集合，导出 JSON 或 Markdown。

这四篇 **EP9000001A1–EP9000004A1 均为合成/mock 样本**，编号和 EPO 格式链接只是本地 Schema 所需的占位格式，**不是实际专利来源**。演示状态保存在被 Git 忽略的 `data/portfolio-synthetic-demo/`；不需要 EPO 网络、私有全文或 xAI Key。默认端口 4323，可用 `PATENT_DEMO_PORT` 环境变量调整。

### 功能与架构

**Claim 1 → 免费 Rules / 受控 xAI Grok 4.3 → Feature Schema v1 → 确定性 Validator → 特征库与检索 → Coverage Review / 技术比较 → 研究集合与 JSON、Markdown 导出**

- `/patent-features`：要素、限定、关系、未解析片段、证据定位和人工修订。
- `/patent-repository`：免费批量提取、结构化字段与文本候选检索、集合管理。
- `/patent-compare`：保留双方原文证据、候选对应、未匹配要素和待判断问题。
- `/pilot-thermal`：受控单篇工程试运行与历史诊断；本机私有数据才可重放历史记录。

前端为原生 HTML/CSS/JavaScript，分析与验证核心使用 TypeScript，后端为仅监听 `127.0.0.1` 的 Node.js HTTP 服务。无 React、外部数据库或新 Agent。界面支持中文和英文；语言切换不改动原文、证据或存储字段。详见 [Feature Schema](docs/v0.8.0/patent-feature-v1.md)、[特征库说明](docs/v0.8.0/patent-repository-v1.md)和[人工审核说明](docs/v0.7.0/human-annotation-pilot.md)。

### 真实数据与受控 API

`npm start` 启动标准本地服务，默认地址 [http://127.0.0.1:4317/](http://127.0.0.1:4317/)。本机若有冻结数据，可打开上述特征页面；公开克隆不含 23 篇专利全文。要自行建立**新的** EPO 快照，可运行 `node scripts/rebuild-public-thermal.js`，再将 `PATENT_THERMAL_DATA` 指向生成的 `data/thermal-public-rebuild.json`。网络可用性、EPO 版本及服务条款会影响重建；新快照不能代替历史冻结版本。

xAI Key 可经本机网页表单提交到服务端内存，或由服务端环境变量提供；页面不回显已保存的 Key，也不将其写入浏览器持久存储或 Git。Grok 4.3 提取需独立免费预检、费用确认、一次性授权和执行；可能产生费用，预算预留不是服务商账单硬上限。公开演示默认无 Key，付费执行不可用。私有响应、费用和审计记录留在本机 `data/`、`reports/` 中。

### 验证与边界

```bash
npm run typecheck
npm run test:public
npm run test:local
```

公开测试使用合成 fixtures 与 Mock Provider，无 Key、无私有全文、无付费网络请求；`test:local`（等同 `npm test`）另检查本机冻结数据与历史记录，在干净克隆中不要求通过。CI 只运行公开测试和 TypeScript 检查。

原文精确匹配和 Schema 通过**不证明语义分类正确**；候选对齐**不证明技术等同**。D Validator 检查证据及来源，不能独立证明结论。系统不提供自动侵权判断、FTO 意见或商业价值评估。23 篇专题文献为有限研究样本，不代表全球检索覆盖。三次历史真实 xAI 工程试运行不能用于计算分类准确率；独立核实的 Verified Gold 仍为 **0**。本项目是研究原型，尚非生产级企业服务。

### 来源、许可与后续工作

公开清单 [samples/thermal-23-manifest.json](samples/thermal-23-manifest.json) 只含 EP 公开号及 EPO 链接。真实全文、原始输入、Grok 响应及私有修订不随源码发布。重建或再利用时请核对 [EPO Linked open EP data](https://www.epo.org/en/searching-for-patents/data/linked-open-data)、[公平使用政策](https://www.epo.org/en/service-support/ordering/fair-use)及[网站条款](https://www.epo.org/en/terms-of-use/terms-and-conditions-use-website-european-patent-office)。

本项目有权授权的原创源码采用 [MIT License](LICENSE)，Copyright (c) 2026 Jannam Ng；MIT **不覆盖** EPO 专利全文、第三方数据或依赖。后续重点是独立人工 Gold、证据语义审核与跨样本误差分析。

## English

PatentLens is a local research prototype for smart-device patent work. It turns Claim 1 into traceable technical features so IP and engineering teams can search, compare, and collect candidate solutions. It demonstrates a reviewable workflow and does not give legal conclusions.

### Five-minute demo without an API key

Requires **Node.js 24+** and npm. From the repository root:

```bash
npm ci
npm run demo:portfolio
```

Open [http://127.0.0.1:4323/patent-repository](http://127.0.0.1:4323/patent-repository):

1. Select **EP9000001A1** and **EP9000002A1**, preview, then run the free Rules batch.
2. Search for the element `resin`; open either feature record to inspect Claim 1, source locations, and Coverage Review.
3. Assign the two records to A/B, open Comparison, generate a free comparison, and inspect candidate alignments, numeric reference bases, and quotations.
4. Return to the repository, create a research collection, add both records, reload it, and export JSON or Markdown.

All four **EP9000001A1–EP9000004A1 records are synthetic/mock**. Their numbers and EPO-shaped URLs are Schema placeholders, **not real patent sources**. Demo data stays in ignored `data/portfolio-synthetic-demo/`. It needs no EPO connection, private text, or xAI key. The default port is 4323; `PATENT_DEMO_PORT` may override it.

### Features and architecture

**Claim 1 → free Rules / controlled xAI Grok 4.3 → Feature Schema v1 → deterministic Validator → feature repository and search → Coverage Review / comparison → research collections and JSON/Markdown export**

- `/patent-features`: elements, limitations, relationships, unresolved spans, source locations, and separate human revisions.
- `/patent-repository`: free batch extraction, structured and text-candidate search, research collections.
- `/patent-compare`: both source quotations, candidate alignments, unmatched elements, and open questions.
- `/pilot-thermal`: controlled single-patent engineering runs and historical diagnostics when local private data is present.

The UI uses native HTML/CSS/JavaScript; the analysis and validation core uses TypeScript; a Node.js HTTP server binds to `127.0.0.1`. There is no React, remote database, or agent framework. The UI switches between English and Simplified Chinese without translating source text or changing stored fields. See [Feature Schema](docs/v0.8.0/patent-feature-v1.md), [repository guide](docs/v0.8.0/patent-repository-v1.md), and [annotation guide](docs/v0.7.0/human-annotation-pilot.md).

### Real sources and controlled API use

`npm start` runs the standard local server at [http://127.0.0.1:4317/](http://127.0.0.1:4317/) by default. A public clone does not include the 23 full-text patents. To build a **new** local EPO snapshot, run `node scripts/rebuild-public-thermal.js`, then point `PATENT_THERMAL_DATA` to `data/thermal-public-rebuild.json`. EPO availability, revisions, and terms may affect the result; a new snapshot cannot replay the frozen historical experiments.

An xAI key may be submitted through the local web form into server memory or provided through a server-side environment variable. The page does not echo a saved key or persist it in browser storage or Git. Grok 4.3 extraction requires a separate free preflight, explicit cost confirmation, one-use authorization, and execution. It may incur charges; the reservation is not a provider billing cap. The public demo has no key and cannot execute a paid request by default. Private responses, usage, and audits stay in ignored `data/` and `reports/`.

### Tests and limits

```bash
npm run typecheck
npm run test:public
npm run test:local
```

Public Tests use synthetic fixtures and Mock providers without a key, private text, or paid network calls. `test:local` (also `npm test`) additionally checks local frozen data and history; it is not expected to pass in a clean clone. CI runs only Public Tests and TypeScript checks.

Exact quotations and valid Schema do **not** establish semantic correctness; candidate alignment does **not** establish technical equivalence. The D Validator checks source evidence, not the full meaning of a classification. PatentLens offers no automatic infringement finding, freedom-to-operate opinion, or valuation. The 23-document thermal set is limited and does not represent global patent coverage. Three historical real xAI engineering runs do not yield a credible accuracy rate; independently verified Gold labels remain **0**. This is a research prototype, not a production enterprise service.

### Sources, license, and next steps

The public [23-publication manifest](samples/thermal-23-manifest.json) contains EP numbers and EPO links only. Full text, submitted inputs, Grok responses, and private revisions are excluded. Check [EPO Linked open EP data](https://www.epo.org/en/searching-for-patents/data/linked-open-data), its [fair use policy](https://www.epo.org/en/service-support/ordering/fair-use), and [website terms](https://www.epo.org/en/terms-of-use/terms-and-conditions-use-website-european-patent-office) before reconstruction or redistribution.

Original source code this project may license is under the [MIT License](LICENSE), Copyright (c) 2026 Jannam Ng. MIT does **not** cover EPO full text, third-party data, or dependencies. Next steps are independent human Gold labels, semantic evidence review, and cross-sample error analysis.
