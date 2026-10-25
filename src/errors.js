export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function redact(value, secrets = []) {
  let text = JSON.stringify(value);
  for (const secret of secrets.filter(Boolean)) text = text.split(JSON.stringify(secret).slice(1, -1)).join("[REDACTED]");
  return JSON.parse(text);
}

export async function fetchText(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: "error", ...options });
  const text = await response.text();
  if (!response.ok) {
    throw new AppError("UPSTREAM_HTTP_" + response.status,
      "远端服务返回 HTTP " + response.status + "。请检查网络、Key、额度或接口参数。", 502);
  }
  return text;
}

export function retrievalConnectionError(error, prefix) {
  const codes = [];
  let current = error;
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) codes.push(current.code, current.name);
  const hint = "请核对工作台显示的检索代理地址、Clash Meta 是否运行，以及目标网站是否可达。没有自动重试或切换来源。";
  if (codes.includes("AbortError")) return new AppError(prefix + "_CANCELLED", "检索等待已取消。", 499);
  if (codes.some((code) => ["TimeoutError", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "ETIMEDOUT"].includes(code))) {
    return new AppError(prefix + "_CONNECT_TIMEOUT", "检索连接或响应超时。" + hint, 502);
  }
  if (codes.some((code) => ["ENOTFOUND", "EAI_AGAIN"].includes(code))) return new AppError(prefix + "_DNS_FAILED", "检索地址解析失败。" + hint, 502);
  if (codes.includes("ECONNREFUSED")) return new AppError(prefix + "_CONNECTION_REFUSED", "代理或目标接口拒绝连接。" + hint, 502);
  if (codes.includes("ECONNRESET")) return new AppError(prefix + "_CONNECTION_RESET", "检索连接被中断。" + hint, 502);
  if (codes.some((code) => ["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT"].includes(code))) return new AppError(prefix + "_TLS_FAILED", "检索 HTTPS 证书验证失败；不会关闭证书验证。", 502);
  return new AppError(prefix + "_UNAVAILABLE", "无法连接检索源。" + hint + "未返回模拟结果。", 502);
}
