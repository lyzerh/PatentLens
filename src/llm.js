import { AppError, redact } from "./errors.js";
import { prepareInput, buildPrompt, EXTRACTION_SCHEMA, PROMPT_VERSION, evaluateExtraction, inputHash, mockOutput } from "./extraction.js";
import { createHash } from "node:crypto";
import { isXaiUrl, RETIRED_XAI_MODELS } from "../public/model-presets.js";

export function normalizeConfig(input, { needsKey = true } = {}) {
  if (!input || typeof input !== "object") throw new AppError("INVALID_CONFIG", "需要 API 配置对象。");
  const protocol = input.protocol;
  if (!["responses", "chat"].includes(protocol)) throw new AppError("INVALID_PROTOCOL", "请选择 Responses 或 Chat Completions。");
  let url;
  try { url = new URL(String(input.baseUrl ?? "")); } catch { throw new AppError("INVALID_BASE_URL", "Base URL 不是有效地址。"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new AppError("INVALID_BASE_URL", "远端接口必须使用 HTTPS；本地服务可以使用 HTTP。");
  if (url.username || url.password || url.search || url.hash) throw new AppError("INVALID_BASE_URL", "Base URL 不能包含密码、参数或片段。");
  const model = String(input.model ?? "").trim();
  if (needsKey && (!model || model.length > 150)) throw new AppError("MODEL_REQUIRED", "请填入服务商实际支持的模型 ID。");
  if (needsKey && isXaiUrl(url.href) && RETIRED_XAI_MODELS.includes(model)) throw new AppError("XAI_MODEL_RETIRED", "此 xAI 模型已退休，会转到不同价格的新模型。请选择 grok-build-0.1 或 grok-4.3，工作台不会自动替换。");
  const apiKey = String(input.apiKey ?? "").trim();
  if (needsKey && !apiKey) throw new AppError("API_KEY_REQUIRED", "请在 API Key 栏填写你的 Key。");
  if (apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new AppError("INVALID_API_KEY", "API Key 格式无效。");
  const format = input.format ?? "schema";
  if (!["schema", "json", "prompt"].includes(format)) throw new AppError("INVALID_OUTPUT_FORMAT", "不支持的输出模式。");
  const maxOutputTokens = Number(input.maxOutputTokens ?? 2500);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 128 || maxOutputTokens > 16000) throw new AppError("INVALID_TOKEN_LIMIT", "输出 Token 上限需在 128–16000。");
  const tokenParameter = input.tokenParameter ?? "max_tokens";
  if (!["max_tokens", "max_completion_tokens"].includes(tokenParameter)) throw new AppError("INVALID_TOKEN_PARAMETER", "不支持的 Token 参数。");
  const reasoningEffort = input.reasoningEffort ?? "auto";
  if (!["auto", "none", "low", "medium", "high"].includes(reasoningEffort)) throw new AppError("INVALID_REASONING_EFFORT", "不支持的推理强度。");
  if (needsKey && isXaiUrl(url.href) && model === "grok-build-0.1" && reasoningEffort !== "auto") throw new AppError("XAI_REASONING_UNSUPPORTED", "Grok Build 的可调推理参数尚未确认，请保持服务商默认；关闭推理可选 Grok 4.3 预设。");
  return { protocol, baseUrl: url.href.replace(/\/+$/, ""), model, apiKey, format, maxOutputTokens, tokenParameter, reasoningEffort };
}

export function buildRequest(config, prompt, { schema = EXTRACTION_SCHEMA, name = "patent_extraction" } = {}) {
  if (config.protocol === "responses") {
    const body = { model: config.model, input: [{ role: "user", content: prompt }],
      max_output_tokens: config.maxOutputTokens, store: false };
    if (config.reasoningEffort && config.reasoningEffort !== "auto") body.reasoning = { effort: config.reasoningEffort };
    if (config.format !== "prompt") body.text = { format: config.format === "schema"
      ? { type: "json_schema", name, strict: true, schema }
      : { type: "json_object" } };
    return { url: config.baseUrl + "/responses", body };
  }
  const body = { model: config.model, messages: [{ role: "user", content: prompt }], [config.tokenParameter]: config.maxOutputTokens };
  if (config.reasoningEffort && config.reasoningEffort !== "auto") body.reasoning_effort = config.reasoningEffort;
  if (config.format !== "prompt") body.response_format = config.format === "schema"
    ? { type: "json_schema", json_schema: { name, strict: true, schema } }
    : { type: "json_object" };
  return { url: config.baseUrl + "/chat/completions", body };
}

export function readModelText(json, protocol) {
  if (protocol === "responses") {
    const content = (json.output ?? []).flatMap((item) => item.content ?? []);
    if (content.some((item) => item.type === "refusal")) throw new AppError("MODEL_REFUSAL", "模型拒绝了该请求。", 422);
    if (json.status === "incomplete") throw new AppError("OUTPUT_INCOMPLETE", "模型输出未完成，请增加输出上限或缩小原文范围。", 422);
    if (json.error || json.status === "failed") throw new AppError("MODEL_FAILED", "模型请求失败。", 502);
    const text = typeof json.output_text === "string" ? json.output_text : content.filter((item) => item.type === "output_text").map((item) => item.text).join("");
    if (!text) throw new AppError("MODEL_EMPTY_OUTPUT", "接口返回了空输出或不兼容的 Responses 结构。", 422);
    return text;
  }
  const choice = json.choices?.[0];
  if (choice?.message?.refusal) throw new AppError("MODEL_REFUSAL", "模型拒绝了该请求。", 422);
  if (choice?.finish_reason === "length") throw new AppError("OUTPUT_INCOMPLETE", "输出达到 Token 上限，请增加上限或缩小输入。", 422);
  if (choice?.finish_reason === "content_filter") throw new AppError("MODEL_REFUSAL", "服务商过滤了该请求。", 422);
  if (typeof choice?.message?.content !== "string" || !choice.message.content) throw new AppError("MODEL_EMPTY_OUTPUT", "接口未返回文本；请确认它兼容 Chat Completions。", 422);
  return choice.message.content;
}

function parseOutput(text) {
  const cleaned = text.trim().replace(/^~~~(?:json)?\s*/i, "").replace(/\s*~~~$/, "")
    .replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "");
  try { return JSON.parse(cleaned); } catch { return null; }
}

export async function runExperiment(input, configInput, { fetchImpl = fetch, signal } = {}) {
  const prepared = prepareInput(input);
  const prompt = buildPrompt(prepared);
  const started = performance.now();
  const createdAt = new Date().toISOString();
  let outputText = "", rawResponse, model, protocol, format, endpoint, tokenParameter = null, reasoningEffort = null, usage = null, modelOutputError = null;
  const mock = configInput?.protocol === "mock";
  if (mock) {
    rawResponse = { mock: true, output: mockOutput(prepared, configInput.bad === true) };
    outputText = JSON.stringify(rawResponse.output);
    model = "offline-mock"; protocol = "mock"; format = "mock"; endpoint = null;
  } else {
    const config = normalizeConfig(configInput);
    ({ model, protocol, format, reasoningEffort } = config);
    tokenParameter = protocol === "responses" ? "max_output_tokens" : config.tokenParameter;
    const request = buildRequest(config, prompt);
    endpoint = request.url;
    try {
      const response = await fetchImpl(request.url, { method: "POST", redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey },
        body: JSON.stringify(request.body) });
      const text = await response.text();
      if (!response.ok) {
        const hint = response.status === 401 ? "Key 无效或服务商不匹配。" :
          response.status === 429 ? "额度不足或请求受限。" :
          response.status === 400 ? "模型、推理参数或输出格式可能不受支持；可保持默认推理或改用 JSON / Prompt 模式。" :
          response.status === 404 ? "模型不存在或账号没有权限，请获取模型列表并核对 ID；不会自动替换模型。" : "远端服务暂时不可用。";
        throw new AppError("LLM_HTTP_" + response.status, "API 返回 HTTP " + response.status + "：" + hint, 502);
      }
      try { rawResponse = redact(JSON.parse(text), [config.apiKey]); }
      catch { throw new AppError("PROVIDER_INVALID_JSON", "接口未返回有效 JSON。请确认 Base URL 和协议。", 502); }
      usage = rawResponse.usage ?? null;
      try { outputText = readModelText(rawResponse, protocol); }
      catch (error) {
        if (!(error instanceof AppError)) throw error;
        modelOutputError = { type: error.code, path: "/", message: error.message, severity: "error" };
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("LLM_CONNECTION_FAILED", "API 连接失败或超时，请检查 Base URL、网络或代理。没有自动重试，以避免重复扣费。", 502);
    }
  }
  return finishReport({ prepared, prompt, outputText, rawResponse, modelOutputError, model, protocol, format,
    endpoint, tokenParameter, reasoningEffort, usage, mock, createdAt, latencyMs: Math.round(performance.now() - started), transport: mock ? "offline" : "backend" });
}

function finishReport({ prepared, prompt, outputText, rawResponse, modelOutputError, model, protocol, format,
  endpoint, tokenParameter, reasoningEffort, usage, mock, createdAt, latencyMs, transport }) {
  const output = parseOutput(outputText);
  const evaluation = output === null || modelOutputError ? { schemaValid: false, status: "needs_revision",
    errors: [modelOutputError ?? { type: "JSON_PARSE_ERROR", path: "/", message: "模型输出不能解析为 JSON。", severity: "error" }],
    metrics: { errorCount: 1, evidenceCount: 0, groundedEvidenceCount: 0, groundingRate: null },
    evidenceChecks: [], warnings: ["保留了原始响应以便人工检查。"] }
    : evaluateExtraction(prepared, output);
  return { run: { createdAt, model, protocol, format, endpoint, promptVersion: PROMPT_VERSION,
    schemaVersion: "experimental-v0.2", inputHash: inputHash(prepared),
    promptHash: createHash("sha256").update(prompt).digest("hex"), latencyMs,
    usage, mock, transport, responseOrigin: transport === "browser" ? "browser_reported" : mock ? "offline_mock" : "backend_received",
    tokenParameter, reasoningEffort, resolvedModel: rawResponse?.model ?? null }, input: prepared, prompt, schema: EXTRACTION_SCHEMA, output, outputText, rawResponse, evaluation };
}

// The real credential never enters the local backend in browser mode.
function browserConfig(input) {
  if (!input || Object.hasOwn(input, "apiKey")) throw new AppError("BROWSER_KEY_NOT_ALLOWED", "浏览器直连模式不能把 Key 发送到本地后端。");
  const config = normalizeConfig({ ...input, apiKey: "browser-only-placeholder" });
  const url = new URL(config.baseUrl);
  if (url.protocol !== "https:" || !["api.x.ai", "us.api.x.ai"].includes(url.hostname) || url.port || url.pathname !== "/v1") {
    throw new AppError("BROWSER_XAI_ONLY", "浏览器直连仅支持官方 xAI HTTPS /v1 地址；其他服务请手动选择本地后端模式。");
  }
  return config;
}

export function prepareBrowserExperiment(input, configInput) {
  const config = browserConfig(configInput);
  const prepared = prepareInput(input);
  return { input: prepared, request: buildRequest(config, buildPrompt(prepared)), timeoutMs: 90000 };
}

export function completeBrowserExperiment(input, configInput, response, timing = {}) {
  const config = browserConfig(configInput);
  const prepared = prepareInput(input);
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new AppError("PROVIDER_INVALID_JSON", "需要浏览器返回的 JSON 响应对象。");
  const latencyMs = Number(timing.latencyMs);
  if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > 300000) throw new AppError("INVALID_TIMING", "浏览器耗时记录无效。");
  const prompt = buildPrompt(prepared);
  const rawResponse = redact(response);
  let outputText = "", modelOutputError = null;
  try { outputText = readModelText(rawResponse, config.protocol); }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    modelOutputError = { type: error.code, path: "/", message: error.message, severity: "error" };
  }
  return finishReport({ prepared, prompt, outputText, rawResponse, modelOutputError,
    model: config.model, protocol: config.protocol, format: config.format, endpoint: buildRequest(config, prompt).url,
    tokenParameter: config.protocol === "responses" ? "max_output_tokens" : config.tokenParameter,
    reasoningEffort: config.reasoningEffort, usage: rawResponse.usage ?? null, mock: false,
    createdAt: new Date().toISOString(), latencyMs: Math.round(latencyMs), transport: "browser" });
}

export async function listModels(configInput, { fetchImpl = fetch, signal } = {}) {
  const config = normalizeConfig(configInput, { needsKey: false });
  if (!config.apiKey) throw new AppError("API_KEY_REQUIRED", "请先填写 API Key。");
  try {
    const response = await fetchImpl(config.baseUrl + "/models", { redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), headers: { Authorization: "Bearer " + config.apiKey } });
    if (!response.ok) throw new AppError("MODELS_HTTP_" + response.status, "连接检查返回 HTTP " + response.status + "。部分服务不提供 /models；可直接填模型 ID 测试。", 502);
    const data = await response.json();
    if (!Array.isArray(data.data)) throw new AppError("MODELS_FORMAT_ERROR", "接口模型列表格式不兼容，请手动填写模型 ID。", 502);
    return redact({ models: data.data.map((m) => m.id).filter((id) => typeof id === "string").sort(), checkedAt: new Date().toISOString() }, [config.apiKey]);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("MODELS_UNAVAILABLE", "无法读取模型列表；请检查地址和网络。", 502);
  }
}
