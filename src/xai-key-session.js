import { randomBytes, timingSafeEqual } from "node:crypto";

const MODEL = "grok-4.3";

/** @param {string} key @param {{fetchImpl?: typeof fetch, signal?: AbortSignal}} [options] */
export async function checkXaiModel(key, { fetchImpl = fetch, signal } = {}) {
  let response;
  try {
    response = await fetchImpl("https://api.x.ai/v1/models", {
      method: "GET", redirect: "error", headers: { Authorization: "Bearer " + key },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000)
    });
  } catch {
    return { connectionStatus: "Connection error", modelAvailability: "unknown", message: "无法连接 xAI；请检查网络和代理。" };
  }
  if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return { connectionStatus: "Invalid key", modelAvailability: "unknown", message: "xAI 拒绝了此 Key；请检查 Key 和账号权限。" }; }
  if (response.status === 429) { await response.body?.cancel(); return { connectionStatus: "Rate limited", modelAvailability: "unknown", message: "xAI 当前限制请求；稍后重试。" }; }
  if (!response.ok) { await response.body?.cancel(); return { connectionStatus: "Connection error", modelAvailability: "unknown", message: `xAI 模型列表返回 HTTP ${response.status}。` }; }
  let data;
  try { data = await response.json(); } catch { return { connectionStatus: "Connected", modelAvailability: "not_fully_verified", message: "已连接 xAI，但 Model availability not fully verified。" }; }
  if (!Array.isArray(data?.data)) return { connectionStatus: "Connected", modelAvailability: "not_fully_verified", message: "已连接 xAI，但 Model availability not fully verified。" };
  if (!data.data.some(item => item?.id === MODEL)) return { connectionStatus: "Model unavailable", modelAvailability: "unavailable", message: `${MODEL} 不在此 Key 的模型列表中；未进行生成测试。` };
  return { connectionStatus: "Connected", modelAvailability: "listed_not_generation_verified", message: `${MODEL} 已列于账号模型列表；Model availability not fully verified（未进行付费生成测试）。` };
}

export function createXaiKeySession({ fetchImpl = fetch, getEnvironmentKey = () => process.env.XAI_API_KEY } = {}) {
  let memoryKey, connectionStatus = "Not configured", modelAvailability = "unknown";
  const csrf = randomBytes(32).toString("hex");
  const getKey = () => memoryKey || getEnvironmentKey();
  const source = () => memoryKey ? "memory" : getEnvironmentKey() ? "environment" : "none";
  const status = () => ({ configured: Boolean(getKey()), source: source(), connectionStatus: getKey() ? connectionStatus === "Not configured" ? "Configured" : connectionStatus : "Not configured", modelAvailability });
  const csrfToken = () => csrf;
  const checkCsrf = value => {
    if (typeof value !== "string" || value.length !== csrf.length) return false;
    return timingSafeEqual(Buffer.from(value), Buffer.from(csrf));
  };
  const save = value => {
    if (typeof value !== "string" || value.length < 8 || value.length > 4096 || value.trim() !== value || /[\r\n\0]/.test(value)) throw new Error("API Key 格式无效；请检查输入。");
    memoryKey = value; connectionStatus = "Configured"; modelAvailability = "unknown";
    return status();
  };
  const clear = () => { memoryKey = undefined; connectionStatus = getEnvironmentKey() ? "Configured" : "Not configured"; modelAvailability = "unknown"; return { ...status(), message: getEnvironmentKey() ? "网页临时 Key 已清除；环境变量 XAI_API_KEY 仍然有效。" : "网页临时 Key 已清除。" }; };
  const test = async signal => {
    const key = getKey(); if (!key) { connectionStatus = "Not configured"; modelAvailability = "unknown"; return { ...status(), message: "请先配置 xAI API Key。" }; }
    connectionStatus = "Testing";
    const result = await checkXaiModel(key, { fetchImpl, signal });
    if (getKey() !== key) return { ...status(), message: "Key 已变更；请重新测试连接。" };
    connectionStatus = result.connectionStatus; modelAvailability = result.modelAvailability;
    return { ...status(), message: result.message };
  };
  return { getKey, status, csrfToken, checkCsrf, save, clear, test };
}
