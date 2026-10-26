# Human annotation pilot / 人工标注试点

Open `/review-thermal` after starting the local server. The page reads the five frozen first-round publications. It does not fetch EPO or call an LLM. If the private dataset is absent, rebuild it locally using the repository's data reconstruction instructions; no real patent text is shipped with the public repository.

启动本地服务后打开 `/review-thermal`。页面只读取本机冻结数据中的首轮五篇，不自动抓取 EPO，也不调用 LLM。公开仓库不包含真实专利全文；缺少本机数据时请按 README 的数据重建说明操作。

Enter a stable reviewer ID and select **Load my drafts / 加载我的草稿**. Read the original Claim 1, available claims and description. Choose an industry relevance value and labels for the three independent taxonomy dimensions. Select a verbatim passage from the source or enter its section and exact text, then bind it to one or more fields. Record the evidence level, relation, semantic assessment and rationale. Save a Draft before switching pages or closing the browser. The task list keeps unsaved edits while moving between its five documents; a browser reload can discard unsaved edits.

输入稳定的审核者标识并点击「加载我的草稿」。阅读原文后，分别选择行业关联性和三维技术标签；从原文划取连续片段，或输入章节与逐字一致的片段，并绑定支持字段。填写证据等级、支持关系、语义判断和理由。切换五篇任务时页面暂存未保存的编辑，但刷新或关闭浏览器仍可能丢失这些内容，因此请先保存 Draft。

Drafts and audit events are written atomically to `data/thermal-v2-annotations/state.json` by default. That directory is private and Git ignored. A different path can be set with `PATENT_THERMAL_ANNOTATION_STORE` for isolated testing. The reviewer ID separates drafts, but it is not authentication or a team permission system. Back up the private file before moving machines. A changed document hash or taxonomy version blocks silent overwrites.

草稿与审计事件默认原子写入 `data/thermal-v2-annotations/state.json`，该目录不会提交至 Git。审核者标识只用于区分草稿，不是企业多用户身份验证。文档哈希或分类体系版本改变时不能静默覆盖旧记录。

**Reviewed is not Verified Gold.** This pilot cannot create Verified Gold. Exact quotation and source checks do not establish semantic correctness. Independent second review, dispute adjudication and a frozen taxonomy are still needed. The description's full-text completeness is not certified. JSON and Markdown exports contain only annotations, cited spans and metadata; keep exports private when they contain real review work.

**Reviewed 不等于 Verified Gold。** 本阶段不能生成已核实人工标准答案。原文字面与来源验证不能证明语义结论正确；仍须独立第二审核者、争议裁决与分类体系冻结。说明书全文完整性未获确认；包含真实审核内容的导出文件应留在私有环境。
