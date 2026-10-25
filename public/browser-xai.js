// Browser-only transport. No storage, credential logging, automatic retry or fallback.
export function publicConfig(config) {
  return Object.fromEntries(["protocol", "baseUrl", "model", "format", "maxOutputTokens", "tokenParameter", "reasoningEffort"].map((key) => [key, config[key]]));
}
export function browserBase(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error("xAI 地址无效。"); }
  if (url.protocol !== "https:" || !["api.x.ai", "us.api.x.ai"].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, "") !== "/v1") {
    throw new Error("浏览器直连仅支持官方 xAI HTTPS /v1 地址。其他服务请手动选择本地后端。");
  }
  return url.href.replace(/\/+$/, "");
}
function credential(value) {
  const key = String(value ?? "").trim();
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) throw new Error("请填写格式有效的 xAI Key。");
  return key;
}
function safeResponse(value, key) {
  return JSON.parse(JSON.stringify(value).split(JSON.stringify(key).slice(1, -1)).join("[REDACTED]"));
}
export async function browserJson(url, keyInput, { body, signal, timeoutMs = 20000, fetchImpl = fetch } = {}) {
  const key = credential(keyInput);
  const target = new URL(url);
  const base = browserBase(target.origin + "/v1");
  if (![base + "/models", base + "/responses", base + "/chat/completions"].includes(url)) throw new Error("不允许的 xAI 请求地址。");
  let response;
  try {
    response = await fetchImpl(url, { method: body ? "POST" : "GET", redirect: "error", credentials: "omit", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      headers: { Authorization: "Bearer " + key, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new Error(error?.name === "TimeoutError" ? "Edge 直连 xAI 超时；没有自动重试，若请求已处理仍可能计费。" : "浏览器未取得 xAI 响应：可能是网络、CORS 或扩展拦截。请在 Edge 按 F12 查看 Network；不会自动改走后端或重复请求。");
  }
  if (!response.ok) {
    await response.body?.cancel();
    const hint = response.status === 401 ? "Key 无效或认证失败。" : response.status === 429 ? "额度或速率受限。" : response.status === 404 ? "模型不存在或无权限。" : response.status === 400 ? "模型参数或输出格式不支持。" : "服务商请求失败。";
    throw new Error("xAI HTTP " + response.status + "：" + hint + " 没有自动重试或替换模型。");
  }
  try { return safeResponse(await response.json(), key); }
  catch { throw new Error("xAI 未返回有效 JSON。没有重试；如生成请求已处理仍可能计费。"); }
}
export async function runBrowserExperiment(input, config, { api, signal, fetchImpl = fetch }) {
  const settings = publicConfig(config);
  browserBase(settings.baseUrl); credential(config.apiKey);
  const plan = await api("browser-prepare", { input, config: settings }, signal);
  const started = performance.now();
  const rawResponse = await browserJson(plan.request.url, config.apiKey, { body: plan.request.body, timeoutMs: plan.timeoutMs, signal, fetchImpl });
  try {
    return await api("browser-result", { input: plan.input, config: settings, rawResponse,
      timing: { latencyMs: Math.round(performance.now() - started) } }, signal);
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new Error("xAI 已返回响应，但本地校验未完成。请勿直接重复生成；可在 Edge Network 中保留响应排查。" );
  }
}
export async function diagnoseBrowserXai({ fetchImpl = fetch } = {}) {
  const started = performance.now();
  const common = { path: "browser", endpoint: "https://api.x.ai/v1/models", authenticated: false, generation: false };
  try {
    const response = await fetchImpl(common.endpoint, { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(12000) });
    await response.body?.cancel();
    return { ...common, reachedHttp: true, httpStatus: response.status, latencyMs: Math.round(performance.now() - started), note: "无 Key 检查，401/403 也说明收到 HTTP 响应，不验证账号权限。" };
  } catch (error) {
    return { ...common, reachedHttp: false, errorCode: error?.name === "TimeoutError" ? "BROWSER_TIMEOUT" : "BROWSER_NETWORK_OR_CORS",
      latencyMs: Math.round(performance.now() - started), note: "浏览器不能区分网络、CORS 或扩展拦截，请用 Edge F12 查看。" };
  }
}
