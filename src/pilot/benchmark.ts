import { readFile } from "node:fs/promises";
import type { PatentRecord, PilotStore, PilotState } from "./records.ts";
import { CLASSIFICATION_SCHEMA, CLASSIFICATION_VERSION, TAXONOMY_VERSION, classificationPrompt, mockClassification, taskId, validateClassification, type Classification } from "./classification.ts";
import { buildRequest, readModelText } from "../llm.js";

type Rate = { input: number; cached: number; output: number };
type PriceTable = { version: string; source: string; longContextThreshold: number; models: Record<string, { short: Rate; long: Rate }> };
export const PRICES = JSON.parse(await readFile(new URL("prices.json", import.meta.url), "utf8")) as PriceTable;
export const MODEL_CHOICES = Object.keys(PRICES.models);
export const DEFAULT_MODEL = "grok-4.3";
type Fetch = typeof fetch;
type Usage = { input_tokens?: number; prompt_tokens?: number; output_tokens?: number; completion_tokens?: number; input_tokens_details?: { cached_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number }; cost_in_usd_ticks?: number };
export type PilotRun = { taskId: string; recordId: string; publicationNumber: string; model: string; promptVersion: string; taxonomyVersion: string; priceVersion: string; startedAt: string;
  mode: "mock" | "api"; status: "needs_review" | "validated" | "rejected" | "insufficient_evidence" | "failed";
  output: Classification | null; validation: ReturnType<typeof validateClassification> | null; schemaValid: boolean | null; evidenceValid: boolean | null; classificationMatch: boolean | null;
  inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null; latencyMs: number;
  apiCostUsd: number | null; costKind: "actual" | "estimated" | "unknown" | "mock"; errorType: string | null; modelResolved: string | null; cached: boolean };
const validNumber = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export function estimateCost(model: string, inputTokens: number, outputTokens: number, cachedTokens = 0): number {
  const rates = PRICES.models[model]; if (!rates) throw new Error("价格表没有此模型，不能预估费用");
  const price = inputTokens >= PRICES.longContextThreshold ? rates.long : rates.short;
  return ((Math.max(0, inputTokens - cachedTokens) * price.input) + (cachedTokens * price.cached) + (outputTokens * price.output)) / 1_000_000;
}
export function preflight(record: PatentRecord, model: string, maxOutputTokens = 1200) {
  if (!MODEL_CHOICES.includes(model)) throw new Error("未配置此模型或价格；请更新价格表");
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 4000) throw new Error("输出上限需在 128–4000 Token");
  const inputEstimate = Math.ceil(classificationPrompt(record).length / 2); // Reserve conservatively; tokenizer may differ.
  return { inputTokensEstimate: inputEstimate, outputTokensLimit: maxOutputTokens, estimatedMaxUsd: estimateCost(model, inputEstimate, maxOutputTokens), priceVersion: PRICES.version, estimateOnly: true };
}
export function costFromUsage(usage: Usage | undefined, model: string): { usd: number | null; kind: "actual" | "estimated" | "unknown"; input: number | null; cached: number | null; output: number | null; reasoning: number | null } {
  const input = validNumber(usage?.input_tokens ?? usage?.prompt_tokens), output = validNumber(usage?.output_tokens ?? usage?.completion_tokens);
  const cached = validNumber(usage?.input_tokens_details?.cached_tokens ?? usage?.prompt_tokens_details?.cached_tokens);
  const reasoning = validNumber(usage?.output_tokens_details?.reasoning_tokens ?? usage?.completion_tokens_details?.reasoning_tokens);
  const ticks = validNumber(usage?.cost_in_usd_ticks);
  if (ticks !== null) return { usd: ticks / 10_000_000_000, kind: "actual", input, cached, output, reasoning };
  if (input !== null && output !== null && cached !== null && cached <= input) return { usd: estimateCost(model, input, output, cached), kind: "estimated", input, cached, output, reasoning };
  if (input !== null && output !== null) return { usd: estimateCost(model, input, output), kind: "estimated", input, cached, output, reasoning };
  return { usd: null, kind: "unknown", input, cached, output, reasoning };
}
const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => { const t = setTimeout(resolve, ms); signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("ABORTED")); }, { once: true }); });
export class PilotBenchmark {
  private busy = false;
  readonly store: PilotStore;
  readonly fetchImpl: Fetch;
  readonly getKey: () => string | undefined;
  constructor(store: PilotStore, fetchImpl: Fetch = fetch, getKey: () => string | undefined = () => process.env.XAI_API_KEY) { this.store = store; this.fetchImpl = fetchImpl; this.getKey = getKey; }
  async models(signal?: AbortSignal) {
    const key = this.getKey(); if (!key) return { configured: false, available: [], checkedAt: null };
    const response = await this.fetchImpl("https://api.x.ai/v1/models", { headers: { Authorization: "Bearer " + key }, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("模型列表返回 HTTP " + response.status);
    const data = await response.json() as { data?: { id?: string }[] };
    return { configured: true, available: (data.data ?? []).map(m => m.id).filter((id): id is string => Boolean(id && MODEL_CHOICES.includes(id))), checkedAt: new Date().toISOString() };
  }
  async run(recordId: string, model = DEFAULT_MODEL, options: { mock?: boolean; allowRepeat?: boolean; taskBudgetUsd?: number; maxOutputTokens?: number; signal?: AbortSignal } = {}): Promise<PilotRun> {
    if (this.busy) throw new Error("已有模型任务运行中；并发上限为 1");
    this.busy = true;
    try {
      const state = await this.store.read(), record = state.records.find(r => r.id === recordId);
      if (!record) throw new Error("专利记录不存在");
      const mock = options.mock === true;
      const forecast = preflight(record, model, options.maxOutputTokens ?? 1200);
      const id = taskId(record, model), prior = [...state.runs].reverse().find(r => r.taskId === id && r.mode === (mock ? "mock" : "api") && r.status !== "failed") as PilotRun | undefined;
      if (prior && !options.allowRepeat) return { ...prior, cached: true };
      const cap = options.taskBudgetUsd ?? 0.02;
      if (!Number.isFinite(cap) || cap < 0 || cap > 100) throw new Error("单任务预算无效");
      if (!mock && forecast.estimatedMaxUsd > cap) throw new Error("运行前预估超过单任务预算；请缩小原文或提高明确预算");
      if (!mock && !this.getKey()) throw new Error("未配置服务端 XAI_API_KEY；可运行 Mock");
      const started = performance.now(), startedAt = new Date().toISOString();
      let output: Classification | null = null, validation: ReturnType<typeof validateClassification> | null = null, usage: Usage | undefined, modelResolved: string | null = null, errorType: string | null = null;
      if (mock) { output = mockClassification(record); validation = validateClassification(record, output); }
      else {
        const request = buildRequest({ protocol: "responses", baseUrl: "https://api.x.ai/v1", model, maxOutputTokens: forecast.outputTokensLimit, format: "schema", reasoningEffort: "auto" }, classificationPrompt(record), { schema: CLASSIFICATION_SCHEMA, name: "patent_portfolio_classification" });
        const call = async (): Promise<Response> => this.fetchImpl(request.url, { method: "POST", redirect: "error", signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000), headers: { Authorization: "Bearer " + this.getKey(), "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
        try {
          let response = await call();
          if (response.status === 429 || response.status === 503) { const retryAfter = Number(response.headers.get("retry-after")); await response.body?.cancel(); await wait(Math.max(1000, Math.min(10000, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000)), options.signal); response = await call(); }
          if (!response.ok) { errorType = "HTTP_" + response.status; await response.body?.cancel(); }
          else {
            const raw = await response.json() as { usage?: Usage; model?: string; output?: unknown; output_text?: string; status?: string };
            usage = raw.usage; modelResolved = raw.model ?? null;
            if (modelResolved && modelResolved !== model) errorType = "MODEL_MISMATCH";
            else { const text = readModelText(raw, "responses") as string; output = JSON.parse(text) as Classification; validation = validateClassification(record, output); }
          }
        } catch (e) { errorType = e instanceof SyntaxError ? "INVALID_JSON" : e instanceof Error ? e.message.slice(0, 80) : "REQUEST_FAILED"; }
      }
      const cost = mock ? { usd: 0, kind: "mock" as const, input: null, cached: null, output: null, reasoning: null } : costFromUsage(usage, model);
      const result: PilotRun = { taskId: id, recordId, publicationNumber: record.publicationNumber, model, promptVersion: CLASSIFICATION_VERSION, taxonomyVersion: TAXONOMY_VERSION, priceVersion: PRICES.version,
        startedAt, mode: mock ? "mock" : "api", status: errorType ? "failed" : validation?.status ?? "failed", output, validation,
        schemaValid: validation?.schemaValid ?? null, evidenceValid: validation?.evidenceValid ?? null,
        classificationMatch: !mock && state.gold[recordId]?.label && state.gold[recordId].label !== "uncertain" ? Boolean(validation?.schemaValid && state.gold[recordId].label === output?.classification?.technical_domain?.value) : null,
        inputTokens: cost.input, cachedInputTokens: cost.cached, outputTokens: cost.output, reasoningTokens: cost.reasoning, latencyMs: Math.round(performance.now() - started),
        apiCostUsd: cost.usd, costKind: cost.kind, errorType, modelResolved, cached: false };
      await this.store.transaction((latest: PilotState) => {
        latest.runs.push(result);
        const current = latest.records.find(r => r.id === recordId);
        if (current && !mock && !errorType && validation?.status === "needs_review") current.classification = { output, validationStatus: "needs_review", reviewedAt: null, taskId: id };
      });
      return result;
    } finally { this.busy = false; }
  }
}

export function summarizeBenchmark(state: PilotState) {
  const models = [...new Set(state.runs.map(r => String(r.model)))];
  return models.map(model => {
    const runs = state.runs.filter(r => r.model === model && r.mode === "api") as PilotRun[];
    const known = runs.filter(r => r.apiCostUsd !== null), latencies = runs.filter(r => r.status !== "failed").map(r => r.latencyMs).sort((a, b) => a - b);
    const gold = runs.filter(r => state.gold[r.recordId]?.label && state.gold[r.recordId].label !== "uncertain");
    const validated = runs.filter(r => { const c = state.records.find(x => x.id === r.recordId)?.classification; return c?.validationStatus === "validated" && c.taskId === r.taskId; });
    return { model, tasks: runs.length, classificationAccuracy: gold.length ? gold.filter(r => r.validation?.schemaValid && state.gold[r.recordId].label === r.output?.classification?.technical_domain?.value).length / gold.length : null,
      goldCount: gold.length, evidenceSupportRate: runs.length ? runs.filter(r => r.validation?.evidenceValid).length / runs.length : null,
      schemaSuccessRate: runs.length ? runs.filter(r => r.validation?.schemaValid).length / runs.length : null,
      totalCostUsd: known.length === runs.length ? known.reduce((n, r) => n + r.apiCostUsd!, 0) : null,
      costPerValidatedUsd: validated.length && known.length === runs.length ? known.reduce((n, r) => n + r.apiCostUsd!, 0) / validated.length : null,
      medianLatencyMs: latencies.length ? (latencies[Math.floor((latencies.length - 1) / 2)] + latencies[Math.floor(latencies.length / 2)]) / 2 : null,
      errors: Object.fromEntries([...new Set(runs.map(r => r.errorType).filter(Boolean))].map(type => [type, runs.filter(r => r.errorType === type).length])) };
  });
}
