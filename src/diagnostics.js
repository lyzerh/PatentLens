export async function diagnoseXai({ fetchImpl = fetch, signal } = {}) {
  const started = performance.now();
  const common = { path: "backend", endpoint: "https://api.x.ai/v1/models", authenticated: false, generation: false };
  try {
    const response = await fetchImpl(common.endpoint, { method: "GET", redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
    await response.body?.cancel();
    return { ...common, reachedHttp: true, httpStatus: response.status, latencyMs: Math.round(performance.now() - started),
      note: "已收到 HTTP 响应。未携带 Key 的 401/403 不代表你的 Key 无效；这不是生成或账号权限测试。" };
  } catch (error) {
    const code = error?.cause?.code ?? error?.code ?? error?.name;
    const allowed = ["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "TimeoutError", "AbortError"];
    return { ...common, reachedHttp: false, errorCode: allowed.includes(code) ? code : "CONNECTION_FAILED",
      latencyMs: Math.round(performance.now() - started), note: "没有取得 HTTP 响应。未修改代理、DNS 或证书设置，也没有自动重试。" };
  }
}
