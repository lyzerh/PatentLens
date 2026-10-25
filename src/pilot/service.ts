import { resolve } from "node:path";
import { PilotStore, normalizePatent, parseImport, portfolio, type FactName, type PatentRecord } from "./records.ts";
import { DOMAINS, RULE_BASELINE_VERSION, ruleBaseline, taskId } from "./classification.ts";
import { DEFAULT_MODEL, MODEL_CHOICES, PRICES, PilotBenchmark, preflight, summarizeBenchmark } from "./benchmark.ts";
import { getPatent, searchPatents } from "../retrieval.js";
import { createValueService } from "./value-service.ts";

const error = (message: string): never => { throw new Error(message); };
export function createPilotService({ path = resolve(process.env.PATENT_PILOT_DATA || "data/pilot.json"), fetchImpl = fetch, retrievalFetchImpl = fetch, getKey = () => process.env.XAI_API_KEY }: { path?: string; fetchImpl?: typeof fetch; retrievalFetchImpl?: typeof fetch; getKey?: () => string | undefined } = {}) {
  const store = new PilotStore(path), benchmark = new PilotBenchmark(store, fetchImpl, getKey);
  const valueService = createValueService(store, fetchImpl, retrievalFetchImpl, getKey);
  return {
    store,
    async handle(action: string, body: Record<string, unknown>, signal?: AbortSignal) {
      if (action.startsWith("v3-")) return valueService.handle(action.slice(3), body, signal);
      if (action === "state") { const state = await store.read(); return { ...state, summary: portfolio(state.records), benchmark: summarizeBenchmark(state), ruleBaselines: state.records.map(ruleBaseline), modelChoices: MODEL_CHOICES, defaultModel: DEFAULT_MODEL, prices: PRICES, keyConfigured: Boolean(getKey()) }; }
      if (action === "import") {
        const rows = parseImport(body.format as "csv" | "json", body.text as string);
        const parsed = rows.map(row => normalizePatent(row));
        if (new Set(parsed.map(r => r.id)).size !== parsed.length) error("导入文件存在重复公开文献号");
        return store.transaction(state => { const known = new Set(state.records.map(r => r.id)); const added = parsed.filter(r => !known.has(r.id)); state.records.push(...added); return { added: added.length, duplicates: parsed.length - added.length, ids: added.map(r => r.id) }; });
      }
      if (action === "import-source") {
        if (body.source !== "epo" || typeof body.publicationNumber !== "string") error("官方原文导入目前仅支持 EPO EP 编号");
        const patent = await getPatent({ source: "epo", publicationNumber: body.publicationNumber }, { fetchImpl: retrievalFetchImpl, signal } as any);
        const record = normalizePatent({ ...patent, assignees: patent.assignee, independentClaims: patent.claims?.filter((c: { number: string }) => /^1$/.test(c.number)).map((c: { text: string }) => c.text) ?? [], jurisdiction: "EP" }, { sourceVerified: true, sourceKind: "epo_publication_xml" });
        return store.transaction(state => { if (state.records.some(r => r.id === record.id)) return { added: 0, recordId: record.id, duplicate: true }; state.records.push(record); return { added: 1, recordId: record.id, duplicate: false }; });
      }
      if (action === "collect-sample") {
        const existing = (await store.read()).records.filter(r => r.sampleSetVersion === "epo-smart-terminal-v1");
        if (existing.length >= 20) return { added: 0, selected: existing.length, total: (await store.read()).records.length, errors: [], sampleSetVersion: "epo-smart-terminal-v1", frozen: true, selectionRule: "此版本已固定；不再重新检索或增补。" };
        const terms = ["battery", "inductive", "thermal", "display", "communication"];
        const collected: PatentRecord[] = [], errors: { query: string; message: string }[] = [];
        for (const query of terms) {
          try {
            const result = await searchPatents({ source: "epo", query, page: 0 }, { fetchImpl: retrievalFetchImpl, signal } as any);
            for (const hit of result.records.slice(0, 5)) {
              const excerpt = typeof hit.snippet === "string" && !hit.snippet.startsWith("来源未提供") ? hit.snippet : null;
              collected.push(normalizePatent({ publicationNumber: hit.publicationNumber, title: hit.title, abstract: excerpt, assignees: hit.assignee,
                publicationDate: hit.publicationDate, jurisdiction: "EP", sourceUrl: hit.sourceUrl, coverage: "search_metadata_abstract_excerpt", sampleSetVersion: "epo-smart-terminal-v1" },
              { sourceVerified: true, sourceKind: "epo_index_metadata" }));
            }
          } catch (e) { errors.push({ query, message: e instanceof Error ? e.message : "来源失败" }); break; }
        }
        return store.transaction(state => { const known = new Set(state.records.map(r => r.id)); let added = 0; for (const r of collected) if (!known.has(r.id)) { state.records.push(r); known.add(r.id); added++; }
          return { added, selected: collected.length, total: state.records.length, errors, sampleSetVersion: "epo-smart-terminal-v1", selectionRule: "EPO 英文标题/摘要检索：battery、inductive、thermal、display、communication；各取第一页最多前五条，按公开文献去重。检索日期由记录 importedAt 保留。检索词不是人工 Gold Set。" }; });
      }
      if (action === "dashboard") { const state = await store.read(); const filters = (body.filters ?? {}) as Record<string, string>; return portfolio(state.records, filters); }
      if (action === "review-field") {
        const id = String(body.recordId ?? ""), field = String(body.field ?? "") as FactName;
        return store.transaction(state => { const record = state.records.find(r => r.id === id) ?? error("记录不存在"); const fact = record.fields[field] ?? error("此字段没有事实值，不能核验");
          if (["legalStatus", "familyId"].includes(field) && !fact.sourceUrl) error("法律状态或家族需要可追踪的来源 URL");
          record.fields[field] = { ...fact, status: "manually_reviewed", reviewedAt: new Date().toISOString() }; return { recordId: id, field, status: "manually_reviewed" }; });
      }
      if (action === "gold") {
        const id = String(body.recordId ?? ""), label = String(body.label ?? ""), reviewer = String(body.reviewer ?? "").trim();
        if (![...DOMAINS, "uncertain"].includes(label as typeof DOMAINS[number]) || !reviewer || reviewer.length > 100) error("请选择分类标签并填写复核人");
        return store.transaction(state => { if (!state.records.some(r => r.id === id)) error("记录不存在"); if (state.runs.some(r => r.recordId === id)) error("Gold 标签必须在模型运行前建立");
          state.gold[id] = { label, setVersion: "human-gold-v1", reviewer, reviewedAt: new Date().toISOString() }; return state.gold[id]; });
      }
      if (action === "models") return benchmark.models(signal);
      if (action === "estimate") {
        const state = await store.read(), record = state.records.find(r => r.id === body.recordId) ?? error("记录不存在");
        return preflight(record, String(body.model ?? DEFAULT_MODEL), Number(body.maxOutputTokens ?? 1200));
      }
      if (action === "classify") return benchmark.run(String(body.recordId ?? ""), String(body.model ?? DEFAULT_MODEL), { mock: body.mock === true,
        allowRepeat: body.allowRepeat === true, taskBudgetUsd: Number(body.taskBudgetUsd ?? 0.02), maxOutputTokens: Number(body.maxOutputTokens ?? 1200), signal });
      if (action === "batch") {
        const ids = body.recordIds as unknown[]; const models = body.models as unknown[];
        if (!Array.isArray(ids) || !Array.isArray(models) || ids.length < 1 || ids.length > 50 || models.length < 1 || models.length > 4) error("批量任务需要 1–50 条记录及 1–4 个模型");
        if (new Set(ids).size !== ids.length || new Set(models).size !== models.length) error("批量任务不能包含重复文献或重复模型");
        const mock = body.mock === true, cap = Number(body.batchBudgetUsd ?? 0.10), taskCap = Number(body.taskBudgetUsd ?? 0.02);
        if (!Number.isFinite(cap) || cap < 0 || cap > 100) error("批量预算无效");
        const state = await store.read(); let reserved = 0; const todo = [] as { id: string; model: string; reserve: number }[];
        for (const id of ids) for (const model of models) { const r = state.records.find(x => x.id === id) ?? error("记录不存在"); const name = String(model), f = preflight(r, name, Number(body.maxOutputTokens ?? 1200));
          const cached = !body.allowRepeat && state.runs.some(run => run.taskId === taskId(r, name) && run.model === name && run.mode === (mock ? "mock" : "api") && run.status !== "failed");
          const reserve = mock || cached ? 0 : f.estimatedMaxUsd;
          todo.push({ id: String(id), model: name, reserve }); reserved += reserve; }
        if (reserved > cap) error("整批运行前预估超过批量预算；未发起请求");
        let spent = 0; const runs = [] as unknown[];
        for (const item of todo) {
          if (!mock && spent + item.reserve > cap) break;
          const run = await benchmark.run(item.id, item.model, { mock, allowRepeat: body.allowRepeat === true, taskBudgetUsd: taskCap, maxOutputTokens: Number(body.maxOutputTokens ?? 1200), signal });
          runs.push(run); if (!mock && !run.cached) spent += run.apiCostUsd ?? item.reserve;
        }
        return { runs, stoppedEarly: runs.length < todo.length, spentOrReservedUsd: spent, batchBudgetUsd: cap, benchmark: summarizeBenchmark(await store.read()) };
      }
      if (action === "review-classification") {
        const id = String(body.recordId ?? ""), decision = body.decision;
        if (!["validated", "rejected"].includes(String(decision))) error("仅允许人工确认或拒绝");
        return store.transaction(state => { const r = state.records.find(x => x.id === id) ?? error("记录不存在"); const classification = r.classification; if (!classification || classification.validationStatus !== "needs_review") return error("没有通过程序校验的待复核分类");
          classification.validationStatus = decision as "validated" | "rejected"; classification.reviewedAt = new Date().toISOString(); return { recordId: id, status: decision }; });
      }
      if (action === "report") { const state = await store.read(); const rules = state.records.map(ruleBaseline), evaluated = rules.filter(r => state.gold[r.recordId] && state.gold[r.recordId].label !== "uncertain"); return { generatedAt: new Date().toISOString(), source: "local_registry", total: state.records.length, sampleSet: { version: "epo-smart-terminal-v1", recordIds: state.records.filter(r => r.sampleSetVersion === "epo-smart-terminal-v1").map(r => r.id), selectionRule: "EPO 英文标题/摘要关键词 battery、inductive、thermal、display、communication；各取第一页最多前五条并按公开文献号去重。" }, ruleBaseline: { version: RULE_BASELINE_VERSION, predictions: rules, goldEvaluated: evaluated.length, accuracy: evaluated.length ? evaluated.filter(r => state.gold[r.recordId].label === r.label).length / evaluated.length : null }, portfolio: portfolio(state.records), benchmark: summarizeBenchmark(state), runs: state.runs, gold: state.gold,
        knownLimits: ["未建立人工 Gold Set 的记录不计算准确率", "来源摘要摘录可能不完整", "人工确认不等于法律意见", "价格估算不等于账单"] }; }
      error("Pilot 接口不存在");
    }
  };
}
