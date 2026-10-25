import { readFile } from "node:fs/promises";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";
import { AppError } from "./errors.js";

export function normalizeRetrievalProxy(value) {
  if (value === "direct" || value === "" || value == null) return null;
  let url;
  try { url = new URL(String(value)); } catch { throw new AppError("INVALID_RETRIEVAL_PROXY", "检索代理地址无效，请检查 config/network.json。", 500); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new AppError("INVALID_RETRIEVAL_PROXY", "检索代理须为本机 HTTP / mixed 端口，不可包含认证信息、路径或参数。", 500);
  }
  return url.origin;
}

export async function loadRetrievalNetwork({ env = process.env, readConfig = () => readFile(new URL("../config/network.json", import.meta.url), "utf8") } = {}) {
  if (Object.hasOwn(env, "PATENT_RETRIEVAL_PROXY")) return { proxyUrl: normalizeRetrievalProxy(env.PATENT_RETRIEVAL_PROXY), source: "environment" };
  try {
    const config = JSON.parse(await readConfig());
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("invalid object");
    return { proxyUrl: normalizeRetrievalProxy(config.retrievalProxy), source: "project_config" };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error.code === "ENOENT") return { proxyUrl: null, source: "default_direct" };
    throw new AppError("INVALID_NETWORK_CONFIG", "无法读取检索网络配置，请检查 config/network.json 的 JSON 格式。", 500);
  }
}

export function createRetrievalTransport(settings, { fetchImpl = undiciFetch, proxyFactory = (url) => new ProxyAgent(url), directFactory = () => new Agent() } = {}) {
  const proxyUrl = normalizeRetrievalProxy(settings.proxyUrl);
  let dispatcher;
  const metadata = { mode: proxyUrl ? "proxy" : "direct", proxyUrl, source: settings.source ?? "explicit", scope: "patent_retrieval_only" };
  return {
    metadata,
    async fetchImpl(url, options = {}) {
      const target = new URL(url);
      const epoTarget = target.hostname === "data.epo.org" && (target.pathname === "/linked-data/query" || /^\/publication-server\/rest\/v1\.2\/patents\/EP\d{7,10}NW[A-Z]\d{0,2}\/document\.xml$/.test(target.pathname));
      if (target.protocol !== "https:" || (!["patents.google.com", "serpapi.com"].includes(target.hostname) && !epoTarget) || target.port || target.username || target.password) {
        throw new AppError("RETRIEVAL_TARGET_BLOCKED", "检索传输仅允许已接入的 Google Patents、SerpAPI 和 EPO 官方 HTTPS 检索路径。", 500);
      }
      dispatcher ??= proxyUrl ? proxyFactory(proxyUrl) : directFactory();
      // Per-request dispatcher: no global proxy mutation, fallback or retries.
      return fetchImpl(url, { ...options, redirect: "error", dispatcher });
    },
    async close() { if (dispatcher) await dispatcher.close(); }
  };
}
