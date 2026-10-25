import { createHash } from "node:crypto";
import type { PilotStore, PatentRecord, FactName } from "./records.ts";
import { CLASSIFICATION_SCHEMA, CLASSIFICATION_VERSION, classificationPrompt, mockClassification, validateClassification, DOMAINS } from "./classification.ts";
import { CANDIDATES, DATASET_VERSION, FREEFORM_PROMPT_VERSION, GOLD_VERSION, V3_STRUCTURED_PROMPT_VERSION, PRODUCT_CATEGORIES, SIBLING_SOURCES, SUCCESSOR_DATASET_VERSION, SUPPLEMENT_DATASET_VERSION, ensureV3, freezeDataset, freezeSuccessorDataset, freezeSupplementDataset, freeformPrompt, mapFreeform, ruleOnly, selectionPreview, validateGold, type DatasetEntry, type V3Run, type HumanAssessment } from "./value-data.ts";
import { sourceAudit, sourceFailure, supplementSource, supplementFailure, readinessReport, generateGoldCandidates } from "./readiness.ts";
import { budgetStatus, evaluateAll } from "./value-metrics.ts";
import { DEFAULT_MODEL, MODEL_CHOICES, PRICES, costFromUsage, estimateCost } from "./benchmark.ts";
import { buildRequest, readModelText } from "../llm.js";
import { getPatent } from "../retrieval.js";

type Fetch = typeof fetch;
const fail = (message: string): never => { throw new Error(message); };
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const usable = (v: unknown): v is string => typeof v === "string" && Boolean(v.trim());
function promptFor(entry: DatasetEntry, variant: "B" | "C") { return variant === "B" ? freeformPrompt(entry) : classificationPrompt(entry.snapshot); }
function reserveFor(entry: DatasetEntry, variant: "B" | "C", model: string, maxOutputTokens: number) {
  if (!MODEL_CHOICES.includes(model)) fail("模型或价格未配置；请先检查当前账号模型列表");
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 4000) fail("输出上限需在128–4000 Token");
  const estimatedInputTokens = Math.ceil(promptFor(entry, variant).length / 2);
  const estimatedUsd = estimateCost(model, estimatedInputTokens, maxOutputTokens);
  return { estimatedInputTokens, estimatedUsd, reservedUsd: Math.max(0.002, estimatedUsd * 2), maxOutputTokens, risk: "预留按估算的2倍或至少$0.002；请求用量与失败费用仍可能超过预留，不能保证账单硬上限" };
}
function safeError(e: unknown): string { if (e instanceof SyntaxError) return "INVALID_JSON"; const code = (e as { code?: unknown } | null)?.code; if (["MODEL_REFUSAL", "OUTPUT_INCOMPLETE", "MODEL_FAILED", "MODEL_EMPTY_OUTPUT"].includes(String(code))) return String(code); if (e instanceof Error && e.message === "ABORTED") return "ABORTED"; return "REQUEST_FAILED"; }
function markdown(report: ReturnType<typeof buildReport>): string {
  const ds = report.dataset;
  const lines = ["# PatentLens Pilot v0.3 — LLM 增量价值验证", "", "生成时间：" + report.generatedAt, "",
    "## 实验目的", "判断 LLM 是否比官方分类/预定义规则提供准确、可追溯、具有成本效益的额外专利管理信息。", "",
    "## 样本与来源", ds ? `${ds.version}；${ds.entries.length} 条；父版本 ${ds.parentVersion ?? "无"}；${ds.selectionRule}` : "测试集尚未冻结。", "",
    ...(ds?.entries.map(e => `- ${e.publicationNumber}｜${e.theme}｜摘要 ${e.completeness.abstract ? "有" : "缺"}｜独立权利要求 ${e.completeness.independentClaims ? "有" : "缺"}｜CPC ${e.completeness.cpc ? "有" : "缺"}｜IPC ${e.completeness.ipc ? "有" : "缺"}｜获取 ${e.sourceRetrievedAt}｜hash ${e.inputHash}｜${e.sourceUrl ?? "无来源 URL"}`) ?? []), "",
    "## 数据准备度", `原始→当前：摘要 ${report.dataReadiness.before?.coverage.abstract.numerator ?? 0}/${report.dataReadiness.totalDocuments} → ${report.dataReadiness.after?.coverage.abstract.numerator ?? 0}/${report.dataReadiness.totalDocuments}；独立权利要求 ${report.dataReadiness.before?.coverage.independentClaims.numerator ?? 0}/${report.dataReadiness.totalDocuments} → ${report.dataReadiness.after?.coverage.independentClaims.numerator ?? 0}/${report.dataReadiness.totalDocuments}；CPC ${report.dataReadiness.before?.coverage.cpc.numerator ?? 0}/${report.dataReadiness.totalDocuments} → ${report.dataReadiness.after?.coverage.cpc.numerator ?? 0}/${report.dataReadiness.totalDocuments}；IPC ${report.dataReadiness.before?.coverage.ipc.numerator ?? 0}/${report.dataReadiness.totalDocuments} → ${report.dataReadiness.after?.coverage.ipc.numerator ?? 0}/${report.dataReadiness.totalDocuments}。冲突 ${report.dataReadiness.conflictingFields.count}，关键字段缺失 ${report.dataReadiness.missingCriticalFields.count}。逐字段证据见 Data Readiness JSON。`, "",
    "## Gold Set 质量", `人工确认 ${report.goldQuality.humanVerified}/${report.goldQuality.required}；暂定 ${report.goldQuality.provisional}；冻结 ${report.goldQuality.frozen ? "是" : "否"}。未冻结不计算真实性能。`, "",
    "## 分类体系与实验设计", `标签：${DOMAINS.join("、")}。A：可信 CPC/IPC 优先、否则标题摘要规则；B：自由文本后统一映射；C：JSON Schema 与证据；D：对 C 同一响应执行 Validator，不额外调用。`, `Prompt 版本：B ${FREEFORM_PROMPT_VERSION}；C ${V3_STRUCTURED_PROMPT_VERSION}；D 复用 C。`, "",
    "## 指标（探索性，分子/分母）"];
  for (const v of report.evaluation.variants) if (v.available && v.accuracy && v.coverage && v.humanEvidenceSupport && v.falseAcceptance && v.falseRejection) lines.push(`- ${v.variant}${v.model ? " / " + v.model : ""}：准确率 ${v.accuracy.numerator}/${v.accuracy.denominator}${v.accuracy.value === null ? "（不可计算）" : `=${(v.accuracy.value * 100).toFixed(1)}%`}；D保留准确率 ${v.acceptedAccuracy ? `${v.acceptedAccuracy.numerator}/${v.acceptedAccuracy.denominator}` : "不适用"}；覆盖 ${v.coverage.numerator}/${v.coverage.denominator}；拒绝 ${v.rejectedCount ?? "不适用"}；Macro-F1 ${v.macroF1 ?? "不可计算"}；Schema ${v.schemaValidity ? `${v.schemaValidity.numerator}/${v.schemaValidity.denominator}` : "不适用"}；引文可追溯 ${v.machineEvidenceTraceability ? `${v.machineEvidenceTraceability.numerator}/${v.machineEvidenceTraceability.denominator}` : "不适用"}；人工证据支持 ${v.humanEvidenceSupport.numerator}/${v.humanEvidenceSupport.denominator}；功能人工评分 ${v.reviewedFunction?.numerator ?? 0}/${v.reviewedFunction?.denominator ?? 0}；产品类别人工评分 ${v.reviewedProductCategory?.numerator ?? 0}/${v.reviewedProductCategory?.denominator ?? 0}；误接受 ${v.falseAcceptance.numerator}/${v.falseAcceptance.denominator}；误拒绝 ${v.falseRejection.numerator}/${v.falseRejection.denominator}；延迟中位数 ${v.medianLatencyMs ?? "未知"}ms；成本 ${v.totalCostUsd ?? "未知"} USD；每条经人工证实且通过 D 的成本 ${v.costPerValidatedCorrectUsd ?? "不可计算"} USD；错误 ${JSON.stringify(v.errors)}`);
  lines.push("", "D 保留记录准确率另见 JSON acceptedAccuracy；必须与拒绝数及总覆盖率同看。", "", "## 费用与延迟", `预算 $${report.evaluation.budget.capUsd}；已知结算 $${report.evaluation.budget.settledKnownUsd}；未结预留 $${report.evaluation.budget.outstandingReservationsUsd}；未知费用请求 ${report.evaluation.budget.unknownCostRequests}。单次请求可能超出预留。`, "",
    "## 典型成功与错误", report.examples.length ? report.examples.map(e => `- ${e.publicationNumber} / ${e.variant}：${e.status}；${e.note}`).join("\n") : "尚无经人工评分的真实模型样本；不能挑选成功案例。", "",
    "## Validator 收益与误拒绝", "D 不产生额外调用；只有独立人工评分 validatorShouldAccept 后才能判断误接受/误拒绝。拒绝率与覆盖率同时报告。", "",
    "## 增量管理价值", report.incrementalValueConclusion, "",
    "## 尚不能得出的结论", "10 条样本属于探索性小样本；无独立人工评价不能宣称模型准确、成本最优或具备商业化实施证据。", "",
    "## 是否继续开发正式系统", report.nextInvestmentDecision, "");
  if (!report.realModelBenchmarkExecuted) lines.push("**Real model benchmark not executed.**", "");
  return lines.join("\n");
}
function buildReport(state: Awaited<ReturnType<PilotStore["read"]>>, keyConfigured = false) {
  const v3 = ensureV3(state), evaluated = evaluateAll(state), entries = v3.dataset?.entries ?? [];
  const assessments = Object.values(v3.assessments);
  const judged = v3.runs.filter(r => r.mode === "api" && v3.assessments[r.taskId]);
  const examples = [...judged.filter(r => v3.assessments[r.taskId].correctDomain === true).slice(0, 3), ...judged.filter(r => v3.assessments[r.taskId].correctDomain === false || r.errorType || r.mappingError).slice(0, 3)].map(r => ({ publicationNumber: r.publicationNumber, variant: r.variant, status: r.errorType ?? r.validation?.status ?? r.mappingError ?? "mapped", note: v3.assessments[r.taskId].notes }));
  const realModelBenchmarkExecuted = v3.runs.some(r => r.mode === "api");
  const models = [...new Set(v3.runs.filter(r => r.mode === "api").map(r => r.model))];
  const completeComparison = models.some(model => entries.every(entry => ["B", "C"].every(variant => v3.runs.some(r => r.mode === "api" && r.datasetVersion === v3.dataset?.version && r.model === model && r.recordId === entry.recordId && r.variant === variant && v3.assessments[r.taskId]))));
  const valueReady = Boolean(v3.goldFrozenAt && completeComparison && entries.some(e => v3.gold[e.recordId] && !v3.gold[e.recordId].ambiguousOrUncertain));
  return { generatedAt: new Date().toISOString(), purpose: "LLM 相对 CPC/IPC/规则的可信增量管理价值与成本", dataset: v3.dataset, dataReadiness: readinessReport(state, keyConfigured), selectionPreview: selectionPreview(state), taxonomy: DOMAINS, productCategories: PRODUCT_CATEGORIES, promptVersions: { B: FREEFORM_PROMPT_VERSION, C: CLASSIFICATION_VERSION, D: "same_C_output_plus_validator" },
    goldQuality: { required: entries.length, humanVerified: Object.values(v3.gold).filter(g => g.status === "human_verified").length, provisional: Object.values(v3.gold).filter(g => g.status === "provisional").length, frozen: Boolean(v3.goldFrozenAt), frozenAt: v3.goldFrozenAt },
    evaluation: evaluated, realModelBenchmarkExecuted, benchmarkStatus: realModelBenchmarkExecuted ? "At least one real API request recorded; completeness and Gold quality still determine evaluability." : "Real model benchmark not executed.", examples,
    incrementalValue: { humanAssessments: assessments.length, primaryFunction: assessments.filter(a => a.functionCorrect !== null).length, productCategory: assessments.filter(a => a.productCategoryCorrect !== null).length, evidenceSupport: assessments.filter(a => a.evidenceSupports !== null).length },
    incrementalValueConclusion: valueReady ? "已具备人工评分数据，请逐项比较规则与 LLM，并结合错误类型作决策；本报告不自动宣称增量价值为正。" : "尚缺冻结 Gold、真实调用或足量独立人工评分，无法证明增量价值。",
    nextInvestmentDecision: valueReady ? "需要由 IP 团队依据成本、误拒绝与语义收益做进一步决策。" : "暂不建议以本轮数据为依据扩建正式企业管理系统；先完成受控实验。",
    knownLimits: ["原始25条多为索引数据；当前冻结集仍有3个关键字段缺失及2处跨公布版本权利要求差异", "B1/A1 与 A3/A2 是同号不同公布种类，不能说目标文献本身包含补充来源的文本", "人工评分尚非双盲或专家一致性测量", "费用预留不能硬限制已在途请求", "引文子串匹配不等于语义支持", "无独立公开产品证据时实际商业实施为 unknown"] };
}

export function createValueService(store: PilotStore, fetchImpl: Fetch = fetch, retrievalFetchImpl: Fetch = fetch, getKey: () => string | undefined = () => process.env.XAI_API_KEY) {
  let busy = false;
  return { async handle(action: string, body: Record<string, unknown>, signal?: AbortSignal) {
    if (action === "state") { const state = await store.read(), v3 = ensureV3(state); return { dataset: v3.dataset, datasetHistory: v3.datasetHistory ?? [], sourceAudit: v3.sourceAudit ?? {}, goldCandidates: v3.goldCandidates ?? {}, readiness: readinessReport(state, Boolean(getKey())), preview: selectionPreview(state), gold: v3.gold, goldFrozenAt: v3.goldFrozenAt, runs: v3.runs, assessments: v3.assessments, budget: budgetStatus(v3), evaluation: evaluateAll(state), taxonomy: DOMAINS, productCategories: PRODUCT_CATEGORIES, modelChoices: MODEL_CHOICES, recommendedModels: ["grok-4.3", "grok-4.20-0309-non-reasoning"], keyConfigured: Boolean(getKey()) }; }
    if (action === "audit-source") {
      const pub = String(body.publicationNumber ?? ""); if (!CANDIDATES.some(c => c.publicationNumber === pub)) fail("仅允许审计固定10条样本");
      const before = ensureV3(await store.read()); if (!before.dataset || before.dataset.version !== DATASET_VERSION) fail("只能在 v0.3.1 冻结前审计原始10条");
      if (before.goldFrozenAt || Object.keys(before.gold).length || before.runs.some(r => r.mode === "api")) fail("已有 Gold 或真实模型结果；不能自动变更数据版本");
      let patent: Awaited<ReturnType<typeof getPatent>>;
      try { patent = await getPatent({ source: "epo", publicationNumber: pub }, { fetchImpl: retrievalFetchImpl, signal } as any); }
      catch (error) { await store.transaction(state => sourceFailure(state, pub, error)); throw error; }
      return store.transaction(state => sourceAudit(state, pub, patent as unknown as Record<string, unknown>));
    }
    if (action === "freeze-successor") return store.transaction(state => freezeSuccessorDataset(state));
    if (action === "supplement-source") {
      const pub = String(body.publicationNumber ?? ""), sibling = SIBLING_SOURCES[pub];
      if (!sibling) fail("该文献没有预先验证的同号补充公布版本");
      const before = ensureV3(await store.read()); if (before.dataset?.version !== SUCCESSOR_DATASET_VERSION || before.goldFrozenAt || Object.keys(before.gold).length || before.runs.some(r=>r.mode==="api")) fail("只能在 v0.3.2 冻结前且无 Gold/真实模型结果时补取");
      let patent: Awaited<ReturnType<typeof getPatent>>;
      try { patent = await getPatent({ source: "epo", publicationNumber: sibling }, { fetchImpl: retrievalFetchImpl, signal } as any); }
      catch (error) { await store.transaction(state=>supplementFailure(state,pub,sibling,error)); throw error; }
      return store.transaction(state=>supplementSource(state,pub,sibling,patent as unknown as Record<string,unknown>));
    }
    if (action === "freeze-supplement") return store.transaction(state=>freezeSupplementDataset(state));
    if (action === "gold-candidates") return store.transaction(state => generateGoldCandidates(state));
    if (action === "mock-smoke") {
      const ds = ensureV3(await store.read()).dataset ?? fail("先冻结测试集");
      return { mode: "mock", datasetVersion: ds.version, realModelBenchmarkExecuted: false, warning: "离线四组工程自检；所有 B/C 文本均为固定 Mock，不代表模型准确率或真实费用。",
        rows: ds.entries.map(entry => { const a = ruleOnly(entry), bText = "Mock only. No real technical domain classification.", b = mapFreeform(bText), cOutput = mockClassification(entry.snapshot), validation = validateClassification(entry.snapshot, cOutput);
          return { publicationNumber: entry.publicationNumber, inputHash: entry.inputHash, A: { label: a.label, basis: a.basis }, B: { mappedDomain: b.domain, mappingError: b.error }, C: { schemaValid: validation.schemaValid, status: validation.status, output: cOutput }, D: { reusesC: true, validatorStatus: validation.status, accepted: validation.status === "needs_review" } }; }) };
    }
    if (action === "data-report") {
      const report = readinessReport(await store.read(), Boolean(getKey()));
      if (body.format !== "markdown") return { format: "json", report };
      const before = report.before?.coverage, after = report.after?.coverage;
      const keys = ["abstract", "independentClaims", "cpc", "ipc"];
      const lines = ["# PatentLens Data Readiness Report", "", `生成：${report.generatedAt}`, `当前数据集：${report.datasetVersion ?? "未冻结"}；上游版本：${report.parentVersion ?? "无"}`, `文献总数：${report.totalDocuments}`, "", "## 补全前后", ...keys.map(key => `- ${key}: ${before?.[key]?.numerator ?? 0}/${before?.[key]?.denominator ?? 0} → ${after?.[key]?.numerator ?? 0}/${after?.[key]?.denominator ?? 0}`), "", `来源核实字段：${report.sourceVerifiedFields.count}；冲突字段：${report.conflictingFields.count}；关键字段缺失：${report.missingCriticalFields.count}`, "", "## 缺失字段与原因", ...report.missingCriticalFields.records.map(x=>`- ${x.publicationNumber} ${x.field}: ${x.reason} · ${x.sourceUrl ?? "无来源"}`), "", "## 冲突", ...report.conflictingFields.records.map(x=>`- ${x.publicationNumber} ${x.field}: needs_review；两侧来源和原值见 JSON 报告`), "", `Gold：${report.goldReadiness.verified}/${report.goldReadiness.required}，冻结=${report.goldReadiness.frozen}，候选=${report.goldReadiness.candidates}`, `Benchmark：数据冻结=${report.benchmarkReadiness.datasetFrozen}；Gold 冻结=${report.benchmarkReadiness.goldFrozen}；Key 配置=${report.benchmarkReadiness.serverKeyConfigured}；真实调用=${report.benchmarkReadiness.realApiRuns}`, "", report.sourceCrossCheck, "", "原文快照与字段逐条证据、冲突两侧内容见 JSON 导出。未执行的真实模型评测不计入质量指标。"];
      return { format: "markdown", text: lines.join("\n") };
    }
    if (action === "enrich") {
      const pub = String(body.publicationNumber ?? ""); if (!CANDIDATES.some(c => c.publicationNumber === pub)) fail("仅允许补取预定10条的官方来源");
      if (ensureV3(await store.read()).dataset) fail("测试集已冻结；不能修改输入原文");
      const patent = await getPatent({ source: "epo", publicationNumber: pub }, { fetchImpl: retrievalFetchImpl, signal } as any);
      return store.transaction(state => { const record = state.records.find(r => r.publicationNumber === pub) ?? fail("文献不在现有样本中");
        if (ensureV3(state).dataset) fail("测试集已冻结；不能修改输入原文");
        const observedAt = new Date().toISOString(), sourceUrl = patent.sourceUrl ?? record.sourceUrl;
        const set = (key: FactName, value: unknown) => { if (value === null || value === undefined || Array.isArray(value) && !value.length || typeof value === "string" && !value.trim()) return;
          if (record.fields[key]?.status === "manually_reviewed") return;
          (record as unknown as Record<string, unknown>)[key] = value;
          record.fields[key] = { status: "source_verified", sourceUrl, observedAt, reviewedAt: null };
        };
        set("title", patent.title); set("abstract", patent.abstract); set("priorityDate", patent.priorityDate); set("publicationDate", patent.publicationDate);
        set("assignees", patent.assignee ? Array.isArray(patent.assignee) ? patent.assignee : [patent.assignee] : []);
        const claim1 = patent.claims?.filter((c: { number: string }) => /^1$/.test(c.number)).map((c: { text: string }) => c.text) ?? [];
        set("independentClaims", claim1);
        record.sourceUrl = sourceUrl; record.coverage = `epo_xml:abstract=${Boolean(patent.abstract)};claims=${Boolean(claim1.length)};description_available=${Boolean(patent.description)}`;
        return { publicationNumber: pub, abstract: Boolean(record.abstract), independentClaims: record.independentClaims.length, cpc: record.cpc.length, ipc: record.ipc.length, sourceUrl: record.sourceUrl, observedAt }; });
    }
    if (action === "freeze-dataset") return store.transaction(state => freezeDataset(state));
    if (action === "gold") {
      const id = String(body.recordId ?? "");
      return store.transaction(state => { const v3 = ensureV3(state), entry = v3.dataset?.entries.find(e => e.recordId === id) ?? fail("先冻结10条测试集"); if (v3.goldFrozenAt) fail("Gold 已冻结，不允许修改");
        if (v3.runs.some(r => r.recordId === id && r.mode === "api") || state.runs.some(r => r.recordId === id && r.mode === "api")) fail("该文献已有真实模型结果，不能事后建立 Gold");
        const validated = validateGold(entry, body); v3.gold[id] = { ...validated, reviewedAt: new Date().toISOString(), version: GOLD_VERSION }; return v3.gold[id]; });
    }
    if (action === "freeze-gold") return store.transaction(state => { const v3 = ensureV3(state), ds = v3.dataset ?? fail("先冻结测试集"); if (v3.goldFrozenAt) return { frozenAt: v3.goldFrozenAt };
      if (ds.entries.some(e => v3.gold[e.recordId]?.status !== "human_verified")) fail("10条样本均需独立人工确认或明确 uncertain，不能用暂定标签冻结");
      v3.goldFrozenAt = new Date().toISOString(); return { frozenAt: v3.goldFrozenAt, count: ds.entries.length }; });
    if (action === "assess") return store.transaction(state => { const v3 = ensureV3(state), run = v3.runs.find(r => r.taskId === body.taskId && r.mode === "api") ?? fail("只能评分真实模型结果");
      const reviewer = String(body.reviewer ?? "").trim(), notes = String(body.notes ?? "").trim(); if (!reviewer || reviewer.length > 100 || !notes || notes.length > 2000) fail("人工评价需要标注者及依据说明");
      const score = (key: string): boolean | null => body[key] === true ? true : body[key] === false ? false : null;
      const assessment: HumanAssessment = { model: run.model, recordId: run.recordId, variant: run.variant, correctDomain: score("correctDomain"), functionCorrect: score("functionCorrect"), productCategoryCorrect: score("productCategoryCorrect"), evidenceSupports: score("evidenceSupports"), validatorShouldAccept: score("validatorShouldAccept"), reviewer, notes, reviewedAt: new Date().toISOString() };
      v3.assessments[run.taskId] = assessment; return assessment; });
    if (action === "estimate") { const state = await store.read(), ds = ensureV3(state).dataset ?? fail("先冻结测试集"); const model = String(body.model ?? DEFAULT_MODEL), variant = body.variant;
      if (variant !== "B" && variant !== "C") fail("仅 B 和 C 产生模型请求；A 免费，D 复用 C");
      const ids = Array.isArray(body.recordIds) ? body.recordIds.map(String) : ds.entries.map(e => e.recordId);
      const entries = ids.map(id => ds.entries.find(e => e.recordId === id) ?? fail("记录不在冻结测试集中"));
      const forecasts = entries.map(e => ({ recordId: e.recordId, inputHash: e.inputHash, ...reserveFor(e, variant as "B" | "C", model, Number(body.maxOutputTokens ?? 1200)) }));
      return { datasetVersion: ds.version, model, variant, tasks: forecasts.length, forecasts, estimatedUsd: forecasts.reduce((s, f) => s + f.estimatedUsd, 0), reservedUsd: forecasts.reduce((s, f) => s + f.reservedUsd, 0), budget: budgetStatus(ensureV3(state)), formalReady: Boolean(ensureV3(state).goldFrozenAt) };
    }
    if (action === "run") {
      if (busy) fail("已有 v0.3 模型任务在运行；并发上限1"); busy = true;
      try {
        const state = await store.read(), v3 = ensureV3(state), ds = v3.dataset ?? fail("先冻结测试集"), variant = body.variant;
        if (variant !== "B" && variant !== "C") fail("B/C 才能发起模型请求；A 由规则计算，D 复用 C");
        const model = String(body.model ?? DEFAULT_MODEL), entry = ds.entries.find(e => e.recordId === body.recordId) ?? fail("记录不在冻结测试集中"), mock = body.mock === true;
        const maxOutputTokens = Number(body.maxOutputTokens ?? 1200), forecast = reserveFor(entry, variant as "B" | "C", model, maxOutputTokens), prompt = promptFor(entry, variant as "B" | "C");
        const promptVersion = variant === "B" ? FREEFORM_PROMPT_VERSION : V3_STRUCTURED_PROMPT_VERSION;
        const taskId = sha([ds.version, entry.inputHash, variant, model, promptVersion, maxOutputTokens]);
        const prior = [...v3.runs].reverse().find(r => r.taskId === taskId && r.mode === (mock ? "mock" : "api") && !r.errorType);
        if (prior && body.allowRepeat !== true) return { ...prior, cached: true };
        if (!mock) {
          if (body.authorized !== true) fail("真实 API 请求必须在 UI 中明确授权");
          if (!v3.goldFrozenAt) fail("正式真实对照必须先冻结全部10条人工 Gold");
          if (!getKey()) fail("未配置服务端 XAI_API_KEY");
          await store.transaction(latest => { const budget = budgetStatus(ensureV3(latest)); if (budget.unknownCostRequests) fail("已有费用未知的请求；先核实账单再继续"); if (forecast.reservedUsd > budget.availableForNewReservationsUsd) fail("累计预算预留将超过 $5；不发起新请求");
            ensureV3(latest).reservations.push({ taskId, reservedUsd: forecast.reservedUsd, startedAt: new Date().toISOString() }); });
        }
        const start = performance.now(), startedAt = new Date().toISOString();
        let text: string | null = null, output: unknown = null, validation: ReturnType<typeof validateClassification> | null = null, mappedDomain: string | null = null, mappingError: string | null = null, usage: Parameters<typeof costFromUsage>[0] = undefined, retries = 0, errorType: string | null = null;
        if (mock) {
          if (variant === "B") { text = "Mock only. No real technical domain classification."; ({ domain: mappedDomain, error: mappingError } = mapFreeform(text)); }
          else { output = mockClassification(entry.snapshot); validation = validateClassification(entry.snapshot, output); mappedDomain = "Unknown"; text = JSON.stringify(output); }
        } else {
          const request = buildRequest({ protocol: "responses", baseUrl: "https://api.x.ai/v1", model, maxOutputTokens, format: variant === "C" ? "schema" : "prompt", reasoningEffort: "auto" }, prompt, variant === "C" ? { schema: CLASSIFICATION_SCHEMA, name: "patent_portfolio_classification" } : {});
          const call = () => fetchImpl(request.url, { method: "POST", redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000), headers: { Authorization: "Bearer " + getKey(), "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
          try {
            let response = await call();
            if (response.status === 429 || response.status === 503) { retries = 1; await response.body?.cancel(); await new Promise(resolve => setTimeout(resolve, 1000)); response = await call(); }
            if (!response.ok) { errorType = "HTTP_" + response.status; await response.body?.cancel(); }
            else { const raw = await response.json() as { model?: string; usage?: Parameters<typeof costFromUsage>[0] }; usage = raw.usage;
              if (raw.model && raw.model !== model) errorType = "MODEL_MISMATCH";
              else { text = readModelText(raw, "responses");
                if (variant === "B") ({ domain: mappedDomain, error: mappingError } = mapFreeform(text ?? ""));
                else { output = JSON.parse(text ?? ""); validation = validateClassification(entry.snapshot, output);
                  const candidate = (output as { classification?: { technical_domain?: { value?: unknown } } })?.classification?.technical_domain?.value;
                  mappedDomain = typeof candidate === "string" && DOMAINS.includes(candidate as typeof DOMAINS[number]) ? candidate : null;
                }
              }
            }
          } catch (e) { errorType = safeError(e); }
        }
        const cost = mock ? { usd: 0, kind: "mock" as const, input: null, output: null, cached: null, reasoning: null } : costFromUsage(usage, model);
        const run: V3Run = { taskId, datasetVersion: ds.version, recordId: entry.recordId, publicationNumber: entry.publicationNumber, inputHash: entry.inputHash, variant: variant as "B" | "C", mode: mock ? "mock" : "api", model, promptVersion,
          startedAt, latencyMs: Math.round(performance.now() - start), inputTokens: cost.input, outputTokens: cost.output, cachedTokens: cost.cached, reasoningTokens: cost.reasoning,
          apiCostUsd: cost.usd, costKind: cost.kind, retries, errorType, mappingError, rawText: text?.slice(0, 40000) ?? null, mappedDomain, output, validation, cached: false };
        await store.transaction(latest => { const latestV3 = ensureV3(latest); latestV3.reservations = latestV3.reservations.filter(r => r.taskId !== taskId); latestV3.runs.push(run);
          if (!mock && run.apiCostUsd === null) latestV3.reservations.push({ taskId: taskId + ":unknown-cost", reservedUsd: forecast.reservedUsd, startedAt }); });
        return run;
      } finally { busy = false; }
    }
    if (action === "report") { const state = await store.read(), report = buildReport(state, Boolean(getKey())); return body.format === "markdown" ? { format: "markdown", text: markdown(report) } : { format: "json", report }; }
    fail("未知 v0.3 接口");
  } };
}
