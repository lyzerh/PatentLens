import { load } from "cheerio";
import { setTimeout as delay } from "node:timers/promises";
import { AppError, retrievalConnectionError } from "./errors.js";

export const EPO_QUERY_ENDPOINT = "https://data.epo.org/linked-data/query";
export const EPO_SEARCH_PAGE = "https://data.epo.org/linked-data/sparql-query";
export const EPO_ATTRIBUTION = "European Patent Office · Linked open EP data (CC BY 4.0); European Publication Server";
const compact = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
const literal = (value) => JSON.stringify(String(value));
const arr = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const isoDate = (value) => /^\d{8}$/.test(value ?? "") ? value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6) : value || null;
const LIMIT = 10;

export function epoPublicationId(input) {
  const id = compact(input).replace(/[\s,.-]/g, "").toUpperCase();
  const match = id.match(/^EP(\d{1,10})([A-Z]\d{0,2})$/);
  if (!match) throw new AppError("EPO_EP_ONLY", "EPO 免费原型仅读取 EP 公开文献。请输入完整编号，例如 EP3633495A1；US、CN 等请显式切换其他来源。");
  return "EP" + match[1].replace(/^0+(?=\d)/, "").padStart(7, "0") + match[2];
}

export function epoDocumentUrl(id) {
  const match = epoPublicationId(id).match(/^EP(\d+)([A-Z]\d{0,2})$/);
  return "https://data.epo.org/publication-server/rest/v1.2/patents/EP" + match[1] + "NW" + match[2] + "/document.xml";
}

export function buildEpoQuery(p) {
  if (p.country && p.country !== "EP") throw new AppError("EPO_EP_ONLY", "EPO 免费原型只检索 EP 文献。请将国家选为「全部」或「EP」，不会忽略国家筛选。");
  if (p.page > 9) throw new AppError("EPO_PAGE_LIMIT", "为遵守小规模试验用途，EPO 原型最多读取前 10 页；请收窄关键词或日期。");
  const number = p.query.replace(/[\s,.-]/g, "").toUpperCase();
  let search;
  if (/^[A-Z]{2}\d+[A-Z]\d{0,2}$/.test(number)) {
    const id = epoPublicationId(number), parts = id.match(/^EP(\d+)([A-Z]\d{0,2})$/);
    search = `?pub patent:publicationNumber ${literal(parts[1])}; patent:publicationKind patent:publicationKind_${parts[2]}.`;
  } else {
    // Literal token AND only. Do not accept user-written SPARQL or Lucene operators.
    if (/["{}()[\]:*?\\]|\b(?:AND|OR|NOT)\b/u.test(p.query)) throw new AppError("EPO_QUERY_SYNTAX", "EPO 原型使用普通关键词、空格分词 AND，或完整 EP 编号；不接收 Boolean、通配符或自定义查询代码。");
    const terms = p.query.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (!terms.length || terms.length > 8 || terms.some((word) => word.length > 64) || terms.join("").length < 3) throw new AppError("EPO_QUERY_SYNTAX", "请使用至少 3 字符、最多 8 个普通关键词；优先使用英文技术词，例如 DVFS 或 voltage scaling。");
    const words = terms.join(" AND ");
    search = `{ ?pub text:query (patent:titleOfInvention ${literal(words)}) } UNION { ?pub text:query (dcterms:abstract ${literal(words)}) }`;
  }
  const filters = [
    p.after && `FILTER(?date >= ${literal(p.after)}^^xsd:date)`,
    p.before && `FILTER(?date <= ${literal(p.before)}^^xsd:date)`,
    p.assignee && `FILTER EXISTS { ?pub patent:applicantVC/vcard:fn ?filterName. FILTER(CONTAINS(LCASE(STR(?filterName)), LCASE(${literal(p.assignee)}))) }`
  ].filter(Boolean).join("\n");
  return `PREFIX patent: <http://data.epo.org/linked-data/def/patent/>
PREFIX text: <http://jena.apache.org/text#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX vcard: <http://www.w3.org/2006/vcard/ns#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?pub ?number ?kind ?title ?date (GROUP_CONCAT(DISTINCT ?name; separator="; ") AS ?assignee) (SAMPLE(?ab) AS ?abstract)
WHERE {
  ${search}
  ?pub a patent:Publication; patent:publicationAuthority <http://data.epo.org/linked-data/id/st3/EP>;
    patent:publicationNumber ?number; patent:publicationKind ?kind;
    patent:titleOfInvention ?title; patent:publicationDate ?date.
  FILTER(langMatches(lang(?title), "en"))
  OPTIONAL { ?pub patent:applicantVC/vcard:fn ?name }
  OPTIONAL { ?pub dcterms:abstract ?ab. FILTER(langMatches(lang(?ab), "en")) }
  ${filters}
}
GROUP BY ?pub ?number ?kind ?title ?date
ORDER BY DESC(?date) ?pub
LIMIT ${LIMIT + 1} OFFSET ${p.page * LIMIT}`;
}

export function parseEpoSearch(json, page) {
  const rows = json?.results?.bindings;
  if (!Array.isArray(rows) || !Array.isArray(json?.head?.vars) || !json.head.vars.includes("pub") || rows.length > 11) throw new AppError("EPO_FORMAT_CHANGED", "EPO 没有返回预期的检索 JSON；本次不以零结果或种子数据代替。", 502);
  const records = rows.slice(0, LIMIT).map((row) => {
    const number = row.number?.value, kind = row.kind?.value?.match(/\/publicationKind_([A-Z]\d{0,2})$/)?.[1];
    const uri = row.pub?.value?.match(/^https?:\/\/data\.epo\.org\/linked-data\/data\/publication\/EP\/(\d+)\/([A-Z]\d{0,2})\/(?:-|\d{4}-\d{2}-\d{2})$/);
    const date = row.date?.value;
    if (!/^\d{1,10}$/.test(number ?? "") || !kind || !uri || uri[1] !== number || uri[2] !== kind || !row.title?.value || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new AppError("EPO_FORMAT_CHANGED", "EPO 条目编号或日期结构异常，已停止解析，避免对应错误文献。", 502);
    const publicationNumber = epoPublicationId("EP" + number + kind);
    return { publicationNumber, title: compact(row.title.value), assignee: compact(row.assignee?.value),
      snippet: compact(row.abstract?.value).slice(0, 1000) || "来源未提供英文摘要。选中文献后从 EPO 官方出版服务器读取可用原文。",
      country: "EP", publicationDate: date, priorityDate: null, source: "epo", coverage: "search_metadata",
      sourceUrl: epoDocumentUrl(publicationNumber), metadataUri: row.pub.value, attribution: EPO_ATTRIBUTION };
  });
  return { records, total: null, source: "epo", page, hasNext: rows.length > LIMIT, searchUrl: EPO_SEARCH_PAGE,
    attribution: EPO_ATTRIBUTION,
    notice: "EPO 免费试验源 · 无需 Key · 仅 EP 文献的英文标题 / 摘要关键词 AND 检索，不是全球全文检索；未计总数、未合并家族。原站入口需重填查询。仅限小规模偶发使用，不用于生产批量抓取。" };
}

export function parseEpoXml(xml, requestedId) {
  if (/<!ENTITY\b/i.test(xml)) throw new AppError("EPO_UNSAFE_XML", "来源 XML 包含自定义实体，已拒绝解析。", 502);
  const encoding = xml.match(/^\s*<\?xml[^>]*encoding=["']([^"']+)/i)?.[1];
  if (encoding && !/^utf-?8$/i.test(encoding)) throw new AppError("EPO_ENCODING_UNSUPPORTED", "此 EPO XML 的字符编码暂不支持，未将乱码当成原文。请查看原站。", 502);
  if (!/<\/ep-patent-document>\s*$/.test(xml.trim())) throw new AppError("EPO_FORMAT_CHANGED", "EPO XML 缺少完整文档结尾，已停止解析。", 502);
  // Cheerio does not fetch DTDs or resolve external entities.
  const $ = load(xml, { xmlMode: true }), root = $("ep-patent-document").first();
  const id = epoPublicationId(requestedId);
  if (!root.length || root.attr("country") !== "EP" || epoPublicationId("EP" + root.attr("doc-number") + root.attr("kind")) !== id) throw new AppError("EPO_DOCUMENT_MISMATCH", "出版服务器没有返回编号一致的专利 XML，已停止读取。", 502);
  const lang = root.attr("lang") || "unknown";
  const section = (name) => {
    const nodes = root.children(name);
    return nodes.filter((_, node) => $(node).attr("lang") === lang).first().length
      ? nodes.filter((_, node) => $(node).attr("lang") === lang).first() : nodes.first();
  };
  const abstractNode = section("abstract"), descriptionNode = section("description"), claimsNode = section("claims");
  const formatText = (node, numbered = false) => {
    const clone = node.clone(); clone.find("script, style").remove(); clone.find("br").replaceWith("\n");
    clone.find("p, heading, claim-text, li").each((_, item) => {
      const el = $(item), num = el.attr("num");
      if (numbered && /^\d+$/.test(num ?? "") && !/^\[\d+\]/.test(el.text().trim())) el.prepend("[" + num.padStart(4, "0") + "] ");
      el.append("\n");
    });
    return clone.text().split(/\r?\n/).map(compact).filter(Boolean).join("\n");
  };
  const abstract = formatText(abstractNode), description = formatText(descriptionNode, true);
  const claims = claimsNode.children("claim").map((index, node) => {
    const raw = $(node).attr("num"), number = /^\d+$/.test(raw ?? "") ? String(Number(raw)) : String(index + 1);
    return { number, text: formatText($(node)) };
  }).get().filter((claim) => claim.text);
  const localName = (node) => String(node?.name ?? "").split(":").at(-1);
  const classificationNodes = (family) => root.find("*").filter((_, node) => {
    if (localName(node) !== (family === "ipc" ? "classification-ipcr" : "classification-cpc")) return false;
    return $(node).parents().toArray().some(parent => [family === "ipc" ? "B510EP" : "B520EP", family === "ipc" ? "B510" : "B520"].includes(localName(parent)));
  });
  const classification = (family) => {
    const nodes = classificationNodes(family), symbols = [], unparsed = [];
    nodes.each((_, node) => {
      const raw = compact($(node).children().filter((_, child) => localName(child) === "text").first().text() || $(node).text());
      const match = raw.match(/^([A-HY]\d{2}[A-Z])\s*(\d{1,4})\s*\/\s*(\d{2,})/i);
      if (match) symbols.push(`${match[1].toUpperCase()} ${Number(match[2])}/${match[3]}`); else unparsed.push(raw.slice(0, 100));
    });
    return { symbols: [...new Set(symbols)], rawCount: nodes.length, unparsed };
  };
  const ipcData = classification("ipc"), cpcData = classification("cpc");
  const modernTitles = root.find("invention-title");
  const legacyTitles = root.find("B542");
  const titleNode = modernTitles.filter((_, node) => $(node).attr("lang") === "en").first();
  const legacyEnglish = legacyTitles.filter((_, node) => $(node).prev("B541").text() === "en").first();
  const title = compact((titleNode.length ? titleNode : legacyEnglish.length ? legacyEnglish : modernTitles.length ? modernTitles.first() : legacyTitles.first()).text());
  const assignee = [...new Set(root.find("B711 > snm, B731 > snm, applicant addressbook orgname").map((_, node) => compact($(node).text())).get().filter(Boolean))].join("; ");
  const priority = root.find("B300 B320, priority-claim date").map((_, node) => compact($(node).text())).get().filter((value) => /^\d{8}$/.test(value)).sort()[0];
  if (!abstract && !description && !claims.length && !ipcData.symbols.length && !cpcData.symbols.length) throw new AppError("EPO_TEXT_UNAVAILABLE", "这份 EP 出版物没有可解析的文本或分类分区，请查看原站；不以元数据冒充全文。", 502);
  const sectionLanguages = { abstract: abstractNode.attr("lang") || lang, description: descriptionNode.attr("lang") || lang, claims: claimsNode.attr("lang") || lang };
  return { publicationNumber: id, title, assignee, country: "EP", publicationDate: isoDate(root.attr("date-publ")), priorityDate: isoDate(priority),
    abstract, description, claims, ipc: ipcData.symbols, cpc: cpcData.symbols,
    classificationDiagnostics: { ipc: { rawCount: ipcData.rawCount, unparsed: ipcData.unparsed }, cpc: { rawCount: cpcData.rawCount, unparsed: cpcData.unparsed } },
    sectionAvailability: { abstract: Boolean(abstract), description: Boolean(description), claims: claims.length > 0 },
    language: lang, sectionLanguages, source: "epo", coverage: "source_sections", sourceUrl: epoDocumentUrl(id), attribution: EPO_ATTRIBUTION,
    fetchedAt: new Date().toISOString(),
    notice: "来源：EPO European Publication Server 官方 XML；分区语言 " + Object.entries(sectionLanguages).map(([key, value]) => key + "=" + value).join(" / ") + "。保留原文，不自动翻译或截断；分区完整性和 claim 编号需人工核对。" +
      (!claims.length ? " 此文献未返回 claims，不代表不存在相关权利要求。" : "") };
}

export function createEpoService({ fetchImpl = fetch, now = Date.now, minIntervalMs = 2000, maxBytes = 3 * 1024 * 1024, cacheBytes = 8 * 1024 * 1024, maxEntries = 40 } = {}) {
  const cache = new Map(); let storedBytes = 0, active = false, nextAt = 0;
  async function request(url, parse, ttl, signal) {
    signal?.throwIfAborted();
    const old = cache.get(url);
    if (old && old.expiresAt > now()) return { ...JSON.parse(old.text), cache: { hit: true, expiresAt: new Date(old.expiresAt).toISOString() } };
    if (old) { storedBytes -= old.bytes; cache.delete(url); }
    if (active) throw new AppError("EPO_BUSY", "已有一个 EPO 请求正在等待或读取，请完成后再操作。程序不会并行批量抓取。", 429);
    active = true;
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    try {
      const wait = Math.max(0, nextAt - now());
      if (wait) await delay(wait, undefined, { signal: combined });
      const response = await fetchImpl(url, { signal: combined, redirect: "error", headers: { Accept: url.includes("/query?") ? "application/sparql-results+json" : "application/xml" } });
      if (!response.ok) {
        if ([429, 503].includes(response.status)) {
          const seconds = Number(response.headers.get("retry-after"));
          nextAt = now() + Math.max(30000, Math.min(3600000, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30000));
        }
        await response.body?.cancel();
        throw new AppError(response.status === 429 ? "EPO_RATE_LIMITED" : response.status === 403 ? "EPO_ACCESS_DENIED" : "EPO_HTTP_" + response.status,
          "EPO 返回 HTTP " + response.status + "。可能限流、维护、暂未公开或没有该文本；请稍后手动再试或查看原站。不会自动重试、换出口或切换数据源。", 502);
      }
      if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new AppError("EPO_RESPONSE_TOO_LARGE", "EPO 响应超过本地 3 MiB 上限，已停止读取；不会截断后当成全文。", 502); }
      const chunks = []; let bytes = 0;
      if (!response.body) throw new AppError("EPO_FORMAT_CHANGED", "EPO 返回空响应体。", 502);
      for await (const chunk of response.body) {
        combined.throwIfAborted(); bytes += chunk.byteLength;
        if (bytes > maxBytes) throw new AppError("EPO_RESPONSE_TOO_LARGE", "EPO 响应超过本地 3 MiB 上限，已停止读取；不会截断后当成全文。", 502);
        chunks.push(chunk);
      }
      const result = parse(Buffer.concat(chunks).toString("utf8")), text = JSON.stringify(result), size = Buffer.byteLength(text), expiresAt = now() + ttl;
      if (size <= cacheBytes && maxEntries > 0) {
        while (cache.size && (cache.size >= maxEntries || storedBytes + size > cacheBytes)) { const key = cache.keys().next().value; storedBytes -= cache.get(key).bytes; cache.delete(key); }
        cache.set(url, { text, bytes: size, expiresAt }); storedBytes += size;
      }
      // Pace occasional requests; this is local protection, not account/IP-wide quota tracking.
      nextAt = Math.max(nextAt, now() + Math.max(minIntervalMs, Math.ceil(bytes / 100)));
      return { ...result, cache: { hit: false, expiresAt: new Date(expiresAt).toISOString() } };
    } catch (error) {
      nextAt = Math.max(nextAt, now() + minIntervalMs);
      if (error instanceof AppError) throw error;
      throw retrievalConnectionError(error, "EPO");
    } finally { active = false; }
  }
  return {
    search(p, { signal } = {}) {
      const query = buildEpoQuery(p), url = EPO_QUERY_ENDPOINT + "?" + new URLSearchParams({ query, format: "application/sparql-results+json" });
      return request(url, (text) => {
        let json; try { json = JSON.parse(text); } catch { throw new AppError("EPO_FORMAT_CHANGED", "EPO 未返回检索 JSON，可能遇到验证或服务变化；不会绕过验证。", 502); }
        return parseEpoSearch(json, p.page);
      }, 10 * 60 * 1000, signal);
    },
    patent(id, { signal } = {}) {
      const normalized = epoPublicationId(id);
      return request(epoDocumentUrl(normalized), (text) => parseEpoXml(text, normalized), 24 * 60 * 60 * 1000, signal);
    }
  };
}

const services = new WeakMap();
export function epoServiceFor(fetchImpl) {
  if (!services.has(fetchImpl)) services.set(fetchImpl, createEpoService({ fetchImpl }));
  return services.get(fetchImpl);
}
