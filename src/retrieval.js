import { load } from "cheerio";
import { readFile } from "node:fs/promises";
import { AppError, fetchText, retrievalConnectionError } from "./errors.js";
import { epoServiceFor } from "./epo.js";

const seedRecords = JSON.parse(await readFile(new URL("../fixtures/patent-seeds.json", import.meta.url), "utf8"));
export const cleanText = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
const plain = (html) => cleanText(load(String(html ?? "")).text());

async function fetchRetrievalText(url, options, fetchImpl) {
  return fetchText(url, options, async (target, init) => {
    const response = await fetchImpl(target, init);
    if (new URL(target).hostname === "patents.google.com") {
      const blocked = response.status === 429 || (response.status === 503 &&
        /sending automated queries|unusual traffic/i.test(await response.clone().text()));
      if (blocked) throw new AppError("GOOGLE_RATE_LIMITED", "Google Patents 暂时限制了当前出口的自动化查询。这不是连接超时，也不需要 xAI Key。请暂停检索，稍后手动再试；程序不会自动重试、切换出口或返回种子结果。", 502);
    }
    return response;
  });
}

export function publicationId(input) {
  const value = String(input ?? "").trim();
  const match = value.match(/^https:\/\/patents\.google\.com\/patent\/([A-Za-z0-9]+)(?:\/[a-z]{2})?\/?(?:\?[^#]*)?$/i);
  const id = (match ? match[1] : value.replace(/[\s,-]/g, "")).toUpperCase();
  if (!/^[A-Z]{2}\d{5,14}[A-Z]\d{0,2}$/.test(id)) {
    throw new AppError("INVALID_PUBLICATION", "请输入带文献种类码的公开编号，例如 US20240053809A1，或 Google Patents 链接。");
  }
  return id;
}

const dateValue = (value) => {
  const text = String(value ?? "");
  return /^\d{8}$/.test(text) ? text.slice(0, 4) + "-" + text.slice(4, 6) + "-" + text.slice(6) : text || null;
};

export function searchParams(input) {
  const query = String(input.query ?? "").trim();
  if (!query || query.length > 500) throw new AppError("INVALID_QUERY", "请输入 1–500 字符的关键词、Boolean 检索式或公开编号。");
  const country = String(input.country ?? "").toUpperCase();
  if (country && !["US", "CN", "TW", "KR", "JP", "EP", "WO"].includes(country)) throw new AppError("INVALID_COUNTRY", "国家筛选不受支持。");
  const after = String(input.after ?? "");
  const before = String(input.before ?? "");
  for (const date of [after, before]) {
    const parsed = new Date(date);
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)) {
      throw new AppError("INVALID_DATE", "日期必须是有效的 YYYY-MM-DD。");
    }
  }
  if (after && before && after > before) throw new AppError("INVALID_DATE_RANGE", "起始日期不能晚于结束日期。");
  const page = Number(input.page ?? 0);
  if (!Number.isInteger(page) || page < 0 || page > 99) throw new AppError("INVALID_PAGE", "页码必须在 0–99 之间。");
  const assignee = String(input.assignee ?? "").trim();
  if (assignee.length > 150) throw new AppError("INVALID_ASSIGNEE", "申请人名称过长。");
  return { query, country, after, before, assignee, page };
}

export function googleSearchUrl(input) {
  const p = new URLSearchParams({ q: input.query });
  if (input.assignee) p.set("assignee", input.assignee);
  if (input.country) p.set("country", input.country);
  if (input.after) p.set("after", "publication:" + input.after.replaceAll("-", ""));
  if (input.before) p.set("before", "publication:" + input.before.replaceAll("-", ""));
  p.set("page", String(input.page));
  p.set("num", "10");
  p.set("dups", "language");
  p.set("type", "PATENT");
  return "https://patents.google.com/?" + p.toString();
}

export function parseGoogleSearch(json) {
  if (!json?.results || !Array.isArray(json.results.cluster)) throw new AppError("SEARCH_FORMAT_CHANGED", "公开检索源返回的结构无法解析；可切换 SerpAPI 或打开来源网站。", 502);
  const records = json.results.cluster.flatMap((cluster) => cluster.result ?? []).filter((item) => item.patent).map(({ patent }) => ({
    publicationNumber: patent.publication_number,
    title: plain(patent.title), assignee: plain(patent.assignee),
    snippet: plain(patent.snippet), priorityDate: dateValue(patent.priority_date),
    publicationDate: dateValue(patent.publication_date),
    country: String(patent.publication_number).slice(0, 2),
    sourceUrl: "https://patents.google.com/patent/" + patent.publication_number + "/en",
    source: "google", coverage: "search_snippet"
  })).filter((item) => /^[A-Z]{2}\d+[A-Z]\d*$/.test(item.publicationNumber ?? ""));
  const total = json.results.total_num_results;
  return { records, total: total !== undefined && Number.isFinite(Number(total)) ? Number(total) : null };
}

export function parseSerpSearch(json) {
  if (json.error) throw new AppError("SEARCH_PROVIDER_ERROR", "检索服务拒绝请求；请检查 SerpAPI Key 或服务额度。", 502);
  if (!Array.isArray(json.organic_results) && !json.search_information) throw new AppError("SEARCH_FORMAT_CHANGED", "检索服务返回的结构无法解析。", 502);
  return {
    records: (json.organic_results ?? []).filter((x) => x.publication_number && !x.is_scholar).map((x) => ({
      publicationNumber: x.publication_number, title: plain(x.title), assignee: plain(x.assignee),
      snippet: plain(x.snippet), priorityDate: x.priority_date ?? null,
      publicationDate: x.publication_date ?? null, country: x.publication_number.slice(0, 2),
      sourceUrl: "https://patents.google.com/patent/" + x.publication_number + "/en",
      source: "serpapi", coverage: "search_snippet"
    })), total: Number.isFinite(json.search_information?.total_results) ? json.search_information.total_results : null
  };
}

export function searchSeeds(input) {
  const p = searchParams(input);
  // Local search is literal AND, never presented as a Boolean search engine.
  const terms = p.query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = seedRecords.filter((r) => {
    const haystack = [r.publicationNumber, r.title, r.assignee, r.snippet, ...r.tags].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term)) &&
      (!p.assignee || r.assignee.toLowerCase().includes(p.assignee.toLowerCase())) &&
      (!p.country || r.country === p.country) &&
      (!p.after || r.publicationDate >= p.after) && (!p.before || r.publicationDate <= p.before);
  });
  return { records: hits.slice(p.page * 10, (p.page + 1) * 10), total: hits.length,
    source: "seed", page: p.page, hasNext: hits.length > (p.page + 1) * 10,
    searchUrl: googleSearchUrl(p),
    notice: "本地种子库共 " + seedRecords.length + " 条真实专利，仅按关键词 AND 搜索。内容是固定摘录，不能用于检索覆盖率或家族统计。"};
}

export async function searchPatents(input, { fetchImpl = fetch, signal } = {}) {
  if (input.source === "epo") return epoServiceFor(fetchImpl).search(searchParams(input), { signal });
  if (input.source === "seed") return searchSeeds(input);
  if (!["google", "serpapi"].includes(input.source)) throw new AppError("INVALID_SEARCH_SOURCE", "请选择检索来源。");
  const p = searchParams(input);
  let url;
  if (input.source === "serpapi") {
    if (!String(input.searchKey ?? "").trim()) throw new AppError("SEARCH_KEY_REQUIRED", "SerpAPI 检索需要独立的 SerpAPI Key，不是 LLM Key。");
    const params = new URLSearchParams({ engine: "google_patents", q: p.query, page: String(p.page + 1), num: "10",
      dups: "language", type: "PATENT", api_key: input.searchKey });
    if (p.assignee) params.set("assignee", p.assignee);
    if (p.country) params.set("country", p.country);
    if (p.after) params.set("after", "publication:" + p.after.replaceAll("-", ""));
    if (p.before) params.set("before", "publication:" + p.before.replaceAll("-", ""));
    url = "https://serpapi.com/search.json?" + params;
  } else {
    url = "https://patents.google.com/xhr/query?url=" + encodeURIComponent(googleSearchUrl(p).split("?")[1]) + "&exp=";
  }
  try {
    const text = await fetchRetrievalText(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000), headers: { Accept: "application/json" } }, fetchImpl);
    let json;
    try { json = JSON.parse(text); } catch { throw new AppError("SEARCH_FORMAT_CHANGED", "检索源没有返回 JSON；可能需要验证或服务格式已经变化。", 502); }
    const parsed = input.source === "google" ? parseGoogleSearch(json) : parseSerpSearch(json);
    return { ...parsed, source: input.source, page: p.page, hasNext: parsed.records.length === 10,
      searchUrl: googleSearchUrl(p), notice: "结果是公开文献条目，尚未合并家族。来源总数是估算值，不是 Verified Dataset 的统计。" };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw retrievalConnectionError(error, "SEARCH");
  }
}

export function parsePatentHtml(html, id) {
  const $ = load(html);
  const meta = (name) => $('meta[name="' + name + '"]').first().attr("content") ?? null;
  const section = (selector) => cleanText($(selector).first().text());
  const claims = $('[itemprop="claim"], .claim[num]').map((i, el) => {
    const text = cleanText($(el).text());
    const rawNumber = $(el).attr("num") ?? text.match(/^(\d+)[.)\s]/)?.[1];
    return { number: String(rawNumber ? Number(rawNumber) : i + 1), text };
  }).get().filter((c) => c.text);
  const fallbackClaims = section('[itemprop="claims"]');
  if (claims.length === 0 && fallbackClaims) claims.push({ number: "all", text: fallbackClaims });
  const abstract = section('[itemprop="abstract"]');
  // Legal-event spans also use itemprop=description. Never treat them as specification text.
  const descriptionSection = $('section[itemprop="description"]').first();
  let descriptionBody;
  if (descriptionSection.length) {
    const innerBody = descriptionSection.find('.description').first();
    descriptionBody = innerBody.length ? innerBody : descriptionSection;
  } else {
    descriptionBody = $('div.description[itemprop="description"], div.description')
      .filter((i, el) => !$(el).closest('[itemprop="legalEvents"], .legal-events, .legal-event').length).first();
  }
  const descriptionClone = descriptionBody.clone();
  descriptionClone.find('script, style, [itemprop="legalEvents"], .legal-events, .legal-event').remove();
  // Keep paragraph boundaries and explicit paragraph identifiers for manual evidence review.
  descriptionClone.find('br').replaceWith('\n');
  descriptionClone.find('p, .description-line, .description-paragraph, .description-heading, .description-title, li, h2, h3, h4').each((i, el) => {
    $(el).append('\n');
  });
  const description = descriptionClone.text().split(/\r?\n/).map(cleanText).filter(Boolean).join('\n');
  if (!abstract && !claims.length && !description) throw new AppError("PATENT_TEXT_UNAVAILABLE", "来源页面没有可读取的专利文本，可打开来源后粘贴权利要求。", 502);
  return {
    publicationNumber: id,
    title: meta("DC.title") ?? section('span[itemprop="title"]'),
    assignee: $('[itemprop="assigneeOriginal"]').map((i, e) => cleanText($(e).text())).get().join("; "),
    publicationDate: $('meta[name="DC.date"][scheme="datePublished"]').attr("content") ?? null,
    priorityDate: $('time[itemprop="priorityDate"]').attr("datetime") ?? null,
    country: id.slice(0, 2), abstract, description, claims, source: "google",
    sectionAvailability: { abstract: Boolean(abstract), claims: claims.length > 0, description: Boolean(description) },
    sourceUrl: "https://patents.google.com/patent/" + id + "/en",
    fetchedAt: new Date().toISOString(), coverage: "source_sections",
    notice: "文本来自公开页面。解析后需要人工核对完整性、claim 编号和元数据。" +
      (!description ? " 未找到可信的说明书正文容器，未用法律事件说明替代正文。" : " 说明书仅取正文容器，保留段落分隔；法律事件不作为说明书输入。")
  };
}

function detailText(value) {
  if (typeof value === "string") return plain(value);
  if (Array.isArray(value)) return value.map(detailText).filter(Boolean).join("\n");
  if (value && typeof value === "object") return detailText(value.text ?? value.snippet ?? value.description ?? value.name ?? "");
  return "";
}

export function parseSerpDetail(json, id) {
  if (json.error) throw new AppError("PATENT_TEXT_UNAVAILABLE", "SerpAPI 专利详情请求失败，请检查检索 Key。", 502);
  const claimsSource = json.claims_translated ?? json.claims;
  const claims = Array.isArray(claimsSource) ? claimsSource.map((claim, i) => ({ number: String(i + 1), text: detailText(claim) })).filter((c) => c.text) : [];
  const claimText = detailText(claimsSource);
  const abstract = detailText(json.abstract);
  const description = detailText(json.description);
  if (!claimText && !abstract && !description) throw new AppError("PATENT_TEXT_UNAVAILABLE", "详情接口未返回可读取的文本，请粘贴原文。", 502);
  return { publicationNumber: id, title: detailText(json.title), assignee: detailText(json.assignees ?? json.assignee),
    publicationDate: json.publication_date ?? null, priorityDate: json.priority_date ?? null,
    abstract, description, claims: claims.length ? claims : claimText ? [{ number: "all", text: claimText }] : [],
    source: "serpapi", sourceUrl: "https://patents.google.com/patent/" + id + "/en",
    fetchedAt: new Date().toISOString(), coverage: "source_sections",
    notice: "SerpAPI 详情文本；claim 编号和完整性需人工核对。说明书若未返回，可从来源页面粘贴。"};
}

export async function getPatent(input, { fetchImpl = fetch, signal } = {}) {
  if (input.source === "epo") return epoServiceFor(fetchImpl).patent(input.publicationNumber, { signal });
  const id = publicationId(input.publicationNumber);
  if (input.source === "seed") {
    const seed = seedRecords.find((r) => r.publicationNumber === id);
    if (!seed) throw new AppError("SEED_NOT_FOUND", "该编号不在本地种子库中。", 404);
    return { ...seed, claims: [{ number: "1 (excerpt)", text: seed.claimExcerpt }],
      abstract: "", description: "", coverage: "claim_excerpt", fetchedAt: seed.capturedAt,
      notice: "这是 Claim 1 的短摘录，不是完整权利要求，不能评估分解完整性。请联网读取或粘贴完整原文。" };
  }
  try {
    if (input.source === "serpapi") {
      if (!input.searchKey) throw new AppError("SEARCH_KEY_REQUIRED", "读取 SerpAPI 详情需要检索 Key。");
      const url = "https://serpapi.com/search.json?" + new URLSearchParams({
        engine: "google_patents_details", patent_id: "patent/" + id + "/en", api_key: input.searchKey });
      const text = await fetchRetrievalText(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }, fetchImpl);
      return parseSerpDetail(JSON.parse(text), id);
    }
    if (input.source !== "google") throw new AppError("INVALID_SEARCH_SOURCE", "请选择专利来源。");
    const html = await fetchRetrievalText("https://patents.google.com/patent/" + id + "/en",
      { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }, fetchImpl);
    return parsePatentHtml(html, id);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw retrievalConnectionError(error, "PATENT");
  }
}
