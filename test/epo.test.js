import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildEpoQuery, parseEpoSearch, parseEpoXml, epoPublicationId, epoDocumentUrl, createEpoService } from "../src/epo.js";
import { searchParams, searchPatents, getPatent } from "../src/retrieval.js";
import { createRetrievalTransport } from "../src/network.js";
import { createApp } from "../src/server.js";

const xml = await readFile(new URL("../fixtures/epo-document.xml", import.meta.url), "utf8");
const params = (extra = {}) => searchParams({ query: "DVFS", source: "epo", ...extra });
const binding = (number = "3633495") => ({ pub: { type: "uri", value: "http://data.epo.org/linked-data/data/publication/EP/" + number + "/A1/-" },
  number: { value: number }, kind: { value: "http://data.epo.org/linked-data/def/patent/publicationKind_A1" }, title: { value: "Synthetic DVFS title" },
  date: { value: "2020-04-08" }, assignee: { value: "Synthetic Applicant" }, abstract: { value: "Synthetic abstract." } });
const result = (bindings = [binding()]) => ({ head: { vars: ["pub", "number", "kind", "title", "date", "assignee", "abstract"] }, results: { bindings } });
const response = (data = result()) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/sparql-results+json" } });

test("EPO identifiers reject non-EP documents and arbitrary URLs before requesting data", () => {
  assert.equal(epoPublicationId("EP 3,633,495 A1"), "EP3633495A1");
  assert.equal(epoPublicationId("EP9552A3"), "EP0009552A3");
  assert.equal(epoDocumentUrl("EP3633495A1"), "https://data.epo.org/publication-server/rest/v1.2/patents/EP3633495NWA1/document.xml");
  for (const id of ["US20240053809A1", "https://evil.test/a", "EP3633495A1/../../", "EP3633495"]) assert.throws(() => epoPublicationId(id), (e) => e.code === "EPO_EP_ONLY");
});

test("EPO builds bounded indexed keyword queries with actual date, applicant and paging filters", () => {
  const query = buildEpoQuery(params({ query: "voltage scaling", assignee: 'Test" } UNION { ?x ?y ?z } #', country: "EP", after: "2020-01-01", before: "2026-01-01", page: 1 }));
  assert.match(query, /text:query \(patent:titleOfInvention "voltage AND scaling"\)/);
  assert.match(query, /text:query \(dcterms:abstract/); assert.match(query, /LIMIT 11 OFFSET 10$/);
  assert.match(query, /\?date >= "2020-01-01"\^\^xsd:date/); assert.match(query, /FILTER EXISTS/);
  assert.ok(query.includes(JSON.stringify('Test" } UNION { ?x ?y ?z } #')));
  assert.ok(!query.includes("api_key"));
  const exact = buildEpoQuery(params({ query: "EP3633495A1" }));
  assert.match(exact, /publicationNumber "3633495"/); assert.doesNotMatch(exact, /text:query \(/);
});

test("unsupported country, query syntax and deep pages are not silently ignored", () => {
  for (const extra of [{ country: "US" }, { query: "US20240053809A1" }, { page: 10 }, { query: "voltage OR scaling" }, { query: '"quoted phrase"' }, { query: "a" }, { query: "SELECT { ?x ?y ?z }" }]) assert.throws(() => buildEpoQuery(params(extra)));
});

test("EPO search lookahead is separate from results, with no invented global total or family count", () => {
  const parsed = parseEpoSearch(result(Array.from({ length: 11 }, (_, i) => binding(String(3633495 + i)))), 0);
  assert.equal(parsed.records.length, 10); assert.equal(parsed.hasNext, true); assert.equal(parsed.total, null);
  assert.equal(parsed.records[0].source, "epo"); assert.equal(parsed.records[0].country, "EP");
  assert.equal(parsed.records[0].priorityDate, null); assert.match(parsed.attribution, /European Patent Office/);
  assert.deepEqual(parseEpoSearch(result([]), 0).records, []);
  assert.equal(parseEpoSearch(result([]), 0).hasNext, false);
});

test("EPO rejects wrong JSON shape and mismatched identifiers instead of treating them as zero hits", () => {
  for (const data of [{}, { results: { bindings: [] } }, result([{ ...binding(), number: { value: "9999999" } }]), result([{ ...binding(), pub: { value: "https://evil.test/a" } }]), result([{ ...binding(), date: { value: "unknown" } }])]) assert.throws(() => parseEpoSearch(data, 0), (e) => e.code === "EPO_FORMAT_CHANGED");
});

test("EPO XML keeps claims in one original language, numbered paragraphs, UTF-8 and clean metadata", () => {
  const patent = parseEpoXml(xml, "EP3633495A1");
  assert.equal(patent.title, "Synthetic voltage controller"); assert.equal(patent.assignee, "Synthetic Applicant");
  assert.equal(patent.publicationDate, "2020-04-08"); assert.equal(patent.priorityDate, "2018-10-01");
  assert.equal(patent.claims.length, 2); assert.equal(patent.claims[1].number, "2");
  assert.ok(patent.claims[0].text.includes("contrôleur")); assert.ok(!patent.claims[0].text.includes("Official"));
  assert.match(patent.description, /\[0001\] Un contrôleur/); assert.match(patent.description, /\n\[0002\]/);
  assert.equal(patent.language, "fr"); assert.equal(patent.sectionLanguages.claims, "fr");
  assert.deepEqual(patent.sectionAvailability, { abstract: true, description: true, claims: true });
});

test("EPO ST.36 B510EP/B520EP classifications parse with prefixes and keep missing text missing", () => {
  const base = '<ep-patent-document xmlns:s="urn:st36" country="EP" doc-number="3633495" kind="A1" date-publ="20200408">';
  const tags = '<B510EP><s:classification-ipcr><s:text>H01M 10/6567 20140101AFI20210827BHEP</s:text></s:classification-ipcr></B510EP>' +
    '<B520EP><s:classifications-cpc><s:classification-cpc><s:text>Y02E 60/10 20130101 LA20210624BGEP</s:text></s:classification-cpc>' +
    '<s:classification-cpc><s:text>H01M 10/613 20150401 FI20210715BHEP</s:text></s:classification-cpc></s:classifications-cpc></B520EP>';
  const result = parseEpoXml(base + tags + '</ep-patent-document>', 'EP3633495A1');
  assert.deepEqual(result.ipc, ['H01M 10/6567']);assert.deepEqual(result.cpc, ['Y02E 60/10','H01M 10/613']);
  assert.equal(result.abstract, '');assert.equal(result.claims.length,0);assert.equal(result.classificationDiagnostics.cpc.rawCount,2);
  const broken = parseEpoXml(base + '<B520EP><classification-cpc><text>BAD-SYMBOL</text></classification-cpc></B520EP>' + '<abstract lang="en"><p>Example.</p></abstract></ep-patent-document>','EP3633495A1');
  assert.equal(broken.classificationDiagnostics.cpc.rawCount,1);assert.deepEqual(broken.classificationDiagnostics.cpc.unparsed,['BAD-SYMBOL']);
});

test("EPO refuses a wrong document, unsafe XML, unsupported encoding or incomplete/empty text", () => {
  assert.throws(() => parseEpoXml(xml, "EP1111111A1"), (e) => e.code === "EPO_DOCUMENT_MISMATCH");
  assert.throws(() => parseEpoXml(xml.replace("<SDOBI>", '<!ENTITY injected "bad"><SDOBI>'), "EP3633495A1"), (e) => e.code === "EPO_UNSAFE_XML");
  assert.throws(() => parseEpoXml(xml.replace("UTF-8", "ISO-8859-1"), "EP3633495A1"), (e) => e.code === "EPO_ENCODING_UNSUPPORTED");
  assert.throws(() => parseEpoXml(xml.slice(0, -30), "EP3633495A1"), (e) => e.code === "EPO_FORMAT_CHANGED");
  assert.throws(() => parseEpoXml('<ep-patent-document country="EP" doc-number="3633495" kind="A1"></ep-patent-document>', "EP3633495A1"), (e) => e.code === "EPO_TEXT_UNAVAILABLE");
});

test("EPO cache avoids duplicate requests, isolates mutable return values, expires and evicts", async () => {
  let count = 0, clock = 1000000;
  const service = createEpoService({ now: () => clock, minIntervalMs: 0, maxEntries: 1, fetchImpl: async () => { count++; return response(); } });
  const a = await service.search(params()); a.records[0].title = "changed";
  const b = await service.search(params()); assert.equal(b.cache.hit, true); assert.equal(b.records[0].title, "Synthetic DVFS title"); assert.equal(count, 1);
  clock += 1000000; await service.search(params()); assert.equal(count, 2);
  clock += 1000000; await service.search(params({ query: "voltage" }));
  clock += 1000000; const evicted = await service.search(params()); assert.equal(evicted.cache.hit, false); assert.equal(count, 4);
});

test("EPO serializes work, handles cancellation, refuses oversized bodies and never retries errors", async () => {
  let release;
  const service = createEpoService({ minIntervalMs: 0, fetchImpl: () => new Promise((resolve) => { release = () => resolve(response()); }) });
  const first = service.search(params());
  await assert.rejects(service.search(params()), (e) => e.code === "EPO_BUSY"); release(); await first;
  const controller = new AbortController(); controller.abort(); await assert.rejects(service.search(params(), { signal: controller.signal }), (e) => e.name === "AbortError");
  for (const status of [403, 404, 429, 503]) {
    let calls = 0;
    const failure = createEpoService({ fetchImpl: async () => { calls++; return new Response("secret error", { status }); } });
    await assert.rejects(failure.search(params()), (e) => e.code.startsWith("EPO_") && !e.message.includes("secret")); assert.equal(calls, 1);
  }
  await assert.rejects(createEpoService({ maxBytes: 10, fetchImpl: async () => new Response("a".repeat(100)) }).search(params()), (e) => e.code === "EPO_RESPONSE_TOO_LARGE");
  await assert.rejects(createEpoService({ maxBytes: 10, fetchImpl: async () => new Response("", { headers: { "content-length": "100" } }) }).search(params()), (e) => e.code === "EPO_RESPONSE_TOO_LARGE");
  await assert.rejects(createEpoService({ fetchImpl: async () => new Response("<html>blocked</html>") }).search(params()), (e) => e.code === "EPO_FORMAT_CHANGED");
});

test("EPO network allowlist allows only official query and publication XML, not arbitrary EPO proxying", async () => {
  const transport = createRetrievalTransport({ proxyUrl: null }, { directFactory: () => ({ close: async () => {} }), fetchImpl: async () => response() });
  await transport.fetchImpl("https://data.epo.org/linked-data/query?query=test");
  await transport.fetchImpl(epoDocumentUrl("EP3633495A1"));
  for (const url of ["https://data.epo.org/other", "https://data.epo.org/linked-data/api/admin", "http://data.epo.org/linked-data/query", "https://evil.test/linked-data/query", "https://data.epo.org:999/linked-data/query"]) await assert.rejects(transport.fetchImpl(url), (e) => e.code === "RETRIEVAL_TARGET_BLOCKED");
  await transport.close();
});

test("workbench dispatches EPO search/detail without sending any LLM or SerpAPI Key", async (t) => {
  let calls = 0;
  const server = createApp({ retrievalFetchImpl: async (url, options) => {
    calls++; assert.ok(!String(url).includes("secret")); assert.ok(!options.headers.Authorization);
    return url.includes("/query?") ? response() : new Response(xml);
  }, fetchImpl: async () => { throw new Error("LLM transport must not run"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const post = async (route, body) => {
    const r = await fetch("http://127.0.0.1:" + server.address().port + "/api/" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Patent-Client": "workbench" }, body: JSON.stringify(body) });
    assert.equal(r.status, 200); return r.json();
  };
  const s = await post("search", { source: "epo", query: "DVFS", searchKey: "secret" }); assert.equal(s.records[0].source, "epo");
  const p = await post("patent", { source: "epo", publicationNumber: "EP3633495A1", searchKey: "secret" }); assert.equal(p.claims.length, 2);
  const cached = await post("patent", { source: "epo", publicationNumber: "EP3633495A1" }); assert.equal(cached.cache.hit, true); assert.equal(calls, 2);
  assert.equal(typeof searchPatents, "function"); assert.equal(typeof getPatent, "function");
});
