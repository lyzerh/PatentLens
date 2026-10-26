# PatentLens v0.6.0 · AI Patent Intelligence Prototype

[![Public CI](https://github.com/lyzerh/PatentLens/actions/workflows/ci.yml/badge.svg)](https://github.com/lyzerh/PatentLens/actions/workflows/ci.yml)

[中文](#中文) | [English](#english)

## 中文

PatentLens 是本机运行的专利情报研究原型，用于检索公开专利、建立可追溯的专利组合，并验证结构化 LLM 输出及原文证据。分类建议、潜在用途与证据匹配不构成法律意见、商业实施证明或专利估值。

### 功能

- 四个入口：检索工作台（/）、组合分析（/pilot）、价值验证（/pilot-v3）、智能终端热管理实验（/pilot-thermal）。
- 人工盲审试点：`/review-thermal`。使用本机冻结原文和私有草稿；操作说明见 [人工标注试点](docs/v0.7.0/human-annotation-pilot.md)。本阶段不能创建 Verified Gold。
- 简体中文和英语即时切换；浏览器只保存语言偏好，不保存 API Key。
- EPO 来源追踪、组合统计、人工复核、规则基线、Mock 模式及 JSON/Markdown 导出。
- 单篇工程试运行将 C 的结构化响应交给离线 D Validator；原文精确匹配、来源链接匹配与语义支持分别记录。
- xAI Key 可暂存在本机服务内存，或由服务端环境变量提供。付费单篇实验经过独立预检、页面费用确认、服务端一次性授权、单篇去重和预算预留。单次预留上限 USD 0.10，实验累计上限 USD 5；预留不是服务商账单硬上限。

当前独立核实的人工 Gold 为 **0**。三次历史真实试运行只证明特定输入上的请求、Schema 和 Validator 流程能够运行，**不能据此计算分类准确率或宣称模型可靠性**。原始响应、用量和费用只保存在本机，不随公开源码提供。

### 架构与环境要求

浏览器原生 HTML/CSS/JavaScript → 本机 Node.js HTTP 服务 → EPO 等检索适配器；另一路经费用预检与一次性授权到 xAI Provider。TypeScript 实现组合分析和确定性验证；D 重用 C 的输出，不再调用模型。Node.js >=24，依赖见 package.json；不使用 React 或远端数据库。默认只监听 127.0.0.1。

### 快速开始

1. 安装 Node.js 24 或更新版本，运行 npm ci。
2. 运行 npm start，打开 http://127.0.0.1:4317/。Windows 的 start-patentlens.cmd 使用 4321 起始端口并打开 /pilot-thermal；实际端口以窗口显示为准。
3. 运行 npm run typecheck 和 npm run test:public；本机拥有未公开冻结数据时，再运行 npm run test:local（npm test 为同一完整测试的别名）。测试使用 Mock Provider，不调用付费生成接口。
4. 无 Key 可使用检索和 Mock。真实 xAI 调用须由用户主动操作并完成授权；不要将 Key 写入仓库、URL 或公开截图。

### 数据重建

公开副本不含真实全文和实验日志，故 /pilot-thermal 原冻结版无法开箱即用，依赖私有快照的历史回归测试也无法在空白克隆中完整重放。建立**新的本地研究快照**：运行 node scripts/rebuild-public-thermal.js。脚本从 samples/thermal-23-manifest.json 的 23 个公开号及 EPO 链接重新取得原文，写入被 Git 忽略的 data/thermal-public-rebuild.json；不覆盖已有文件，不调用 xAI。启动前将 PATENT_THERMAL_DATA 设置为该文件的绝对路径。EPO 内容或网络状态变化可能使重建失败或哈希不同；新快照**不是**历史 v1.3 冻结数据，不能重放三次旧结果。本机检索代理可在 config/network.json 配置；公开仓库只提供 config/network.example.json，缺省直连。

### 数据来源、已知局限与路线

公开清单仅含 EP 公开号和 EPO Publication Server 原文链接。EPO 对 Linked open EP 数据标注 CC BY 4.0；Publication Server 全文另受其公平使用政策约束。源码不分发抓取的批量全文、输入快照、模型响应或本地审核记录。使用者须核对最新条款并标注来源。

来源：[EPO Linked open EP data](https://www.epo.org/en/searching-for-patents/data/linked-open-data) · [EPO fair use charter](https://www.epo.org/en/service-support/ordering/fair-use) · [EPO website terms](https://www.epo.org/en/terms-of-use/terms-and-conditions-use-website-european-patent-office)

小规模、非随机样本不能代表行业总体；严格字符串匹配只证明引文存在，不证明结论获得语义支持。下一步由独立审查者建立并冻结 Gold，补充语义证据审核、人工耗时与跨样本误差，再评估增量价值。公开前仍须检查暂存文件与未来 Git 历史。

### 公开测试、本机完整测试与 API Key 安全

公开测试不需要真实 Key、私有原文、历史响应或付费服务；使用标为 synthetic/mock 的公开 fixtures，覆盖检索解析、双语 UI、组合逻辑、费用预检及一次性授权等行为。本机完整测试另重放冻结数据与历史诊断并核对哈希；这些数据不会提交。公开副本中，专题页面会明确提示先重建本地数据。网页配置的 xAI Key 仅保存在本机 Node 进程内存，重启失效；服务端环境变量是可选回退。真实 API 调用必须由用户主动确认，可能产生费用。

### 许可

本项目是**研究原型，不是生产级企业服务**。本项目有权授权的原创源码按 [MIT License](LICENSE) 发布，版权署名为 Copyright (c) 2026 Jannam Ng。该许可**不覆盖** EPO 专利全文、第三方数据、依赖包或各自的许可条款；请分别核对其来源与授权。

## English

PatentLens is a local AI patent intelligence research prototype for retrieving public patents, examining a traceable portfolio, and testing structured LLM extraction against source evidence. Classifications and potential applications are research suggestions, not legal advice, proof of commercial use, or patent valuation.

### Features

- Four pages: search workbench (/), portfolio (/pilot), value validation (/pilot-v3), and smart-device thermal pilot (/pilot-thermal).
- Blind human annotation pilot: `/review-thermal`. It uses local frozen sources and private drafts; see the [annotation guide](docs/v0.7.0/human-annotation-pilot.md). This phase cannot create Verified Gold.
- Instant Simplified Chinese and English switching. Only language preference is stored in the browser; API keys are not.
- Source provenance, portfolio statistics, human review, rule baselines, Mock mode, and JSON/Markdown export.
- One structured C response feeds deterministic offline D. Exact quotation matching, source URL matching, and semantic support remain separate outcomes.
- xAI keys reside in server memory or a server-side environment variable. Paid single-patent runs require separate preflight, visible cost confirmation, one-use server authorization, deduplication, and budget reservation. The per-run reservation limit is USD 0.10 and the experiment budget limit is USD 5. Reservation is not a provider billing cap.

There are **zero independently verified Gold labels**. Three historical real runs show that the request, Schema, and Validator pipeline operated for those inputs. They do **not** establish classification accuracy or model reliability. Original responses, usage, and charges remain local and are not published.

### Architecture and Requirements

Native HTML/CSS/JavaScript → local Node.js HTTP server → patent retrieval adapters; a separately authorized route reaches the xAI provider. TypeScript implements portfolio analysis and deterministic validation. D reuses C output without another model call. Node.js 24+; dependencies are listed in package.json. No React or remote database. The server binds to 127.0.0.1 by default.

### Quick Start

1. Install Node.js 24+ and run npm ci.
2. Run npm start and open http://127.0.0.1:4317/. On Windows, start-patentlens.cmd starts at port 4321 and opens /pilot-thermal; use the port shown in the launcher.
3. Run npm run typecheck and npm run test:public. With the unpublished frozen data available locally, also run npm run test:local (npm test is an alias for this full suite). Tests use Mock providers and make no paid generation calls.
4. Search and Mock work without an API key. Real xAI generation requires explicit user action and server authorization. Never commit keys or expose them in URLs or screenshots.

### Data Reconstruction

The public tree excludes original patent full text and experiment logs. The original frozen /pilot-thermal view and tests that replay private history therefore cannot run from a clean clone alone. For a **new local snapshot**, run node scripts/rebuild-public-thermal.js. It retrieves the 23 EPO publications in samples/thermal-23-manifest.json, writes ignored data/thermal-public-rebuild.json without overwriting existing files, and never calls xAI. Set PATENT_THERMAL_DATA to that file's absolute path before starting. EPO availability or revised content can change the hash. This is **not** the historical frozen v1.3 dataset and cannot replay the three original runs. Local proxy settings may be placed in config/network.json; the public template is config/network.example.json, and the default without local config is direct access.

### Provenance, Known Limitations, Roadmap

The public manifest contains only publication numbers and links to the EPO Publication Server. EPO identifies Linked open EP data as CC BY 4.0; full text access follows the Publication Server fair use policy. Bulk patent text, input snapshots, model responses, and private review files are excluded. Check current EPO terms and attribute sources in research outputs.

Sources: [EPO Linked open EP data](https://www.epo.org/en/searching-for-patents/data/linked-open-data) · [EPO fair use charter](https://www.epo.org/en/service-support/ordering/fair-use) · [EPO website terms](https://www.epo.org/en/terms-of-use/terms-and-conditions-use-website-european-patent-office)

This small, non-random sample cannot establish population-wide performance. Exact string matching proves only that a quotation occurs in the submitted text, not semantic support. Planned work: independent frozen Gold labels, separate semantic evidence review, human review-time measurement, and cross-sample error analysis. Inspect staged files and any future Git history before publication.

### Public Tests, Local Full Tests, API Key Security

Public Tests require no real Key, private patent text, historical responses, or paid service. Clearly labeled synthetic/mock fixtures cover retrieval parsing, bilingual UI, portfolio logic, cost preflight, and one-use authorization. Local Full Tests additionally replay frozen data and historical diagnostics and verify hashes; those files are not committed. Without local thermal data, the pilot page gives a reconstruction prompt. A web-configured xAI Key remains only in the local Node process memory and disappears on restart; a server environment variable is an optional fallback. Real API calls require explicit user confirmation and may cost money.

### Licensing

This is a **research prototype, not a production enterprise service**. Original source code that this project may license is released under the [MIT License](LICENSE), Copyright (c) 2026 Jannam Ng. This license does **not** cover EPO patent full text, third-party data, dependencies, or their separate terms; review each source and license separately.
