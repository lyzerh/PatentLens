import test from "node:test";
import assert from "node:assert/strict";
import { searchParams, publicationId, searchSeeds, searchPatents, parseGoogleSearch, parseSerpSearch, parsePatentHtml, parseSerpDetail, getPatent } from "../src/retrieval.js";
import { prepareInput, mockOutput, evaluateExtraction } from "../src/extraction.js";
import { normalizeConfig, buildRequest, readModelText, runExperiment, listModels } from "../src/llm.js";
import { createApp } from "../src/server.js";
import { redact } from "../src/errors.js";
import { DEFAULT_PRESET, MODEL_PRESETS, RETIRED_XAI_MODELS, modelNotice } from "../public/model-presets.js";

const input = { publicationNumber: "DEMO-001", title: "Synthetic",
  coverage: "synthetic", sections: {
    claims: "Claim 1. A processor receives a workload value and adjusts a clock frequency.",
    abstract: "The device dynamically controls processor frequency.", description: "" } };
const config = { protocol: "responses", baseUrl: "https://api.example.com/v1", apiKey: "test-not-a-real-key",
  model: "test-model", format: "schema", maxOutputTokens: 2500 };
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("real seed records are searchable with assignee, date and country filters", () => {
  assert.equal(searchSeeds({ query: "DVFS", assignee: "Samsung", country: "US" }).total, 4);
  assert.equal(searchSeeds({ query: "DVFS memory", after: "2024-01-01" }).records[0].publicationNumber, "US20240053809A1");
  assert.equal(searchSeeds({ query: "does-not-exist" }).total, 0);
  assert.equal(searchSeeds({ query: "DVFS", country: "TW" }).total, 0);
});
test("publication IDs are normalized without accepting arbitrary fetch URLs", () => {
  assert.equal(publicationId("https://patents.google.com/patent/US20240053809A1/en"), "US20240053809A1");
  assert.equal(publicationId("US 20240053809 A1"), "US20240053809A1");
  assert.throws(() => publicationId("https://example.com/US20240053809A1"));
  assert.throws(() => publicationId("../../private"));
});
test("invalid calendar dates, reversed ranges and page values are rejected", () => {
  for (const p of [{ after: "2024-99-99" }, { after: "2024-02-30" }, { after: "2025-01-01", before: "2024-01-01" }, { page: -1 }]) {
    assert.throws(() => searchParams({ query: "DVFS", ...p }));
  }
});
test("Google adapter parses nested patent data and preserves zero results", () => {
  const result = parseGoogleSearch({ results: { total_num_results: "1", cluster: [{ result: [{ patent: {
    publication_number: "US20240053809A1", title: "<b>DVFS</b> controller", assignee: "Samsung",
    snippet: "workload", publication_date: "20240215" } }] }] } });
  assert.equal(result.records[0].title, "DVFS controller");
  assert.equal(result.records[0].publicationDate, "2024-02-15");
  assert.equal(parseGoogleSearch({ results: { total_num_results: "0", cluster: [] } }).total, 0);
});
test("SerpAPI adapter excludes non-patent results and records source URL", () => {
  const r = parseSerpSearch({ organic_results: [{ publication_number: "US20240053809A1", title: "DVFS", assignee: "Samsung" }, { is_scholar: true }], search_information: { total_results: 1 } });
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].source, "serpapi");
});
test("live search failure is never silently replaced by seed data", async () => {
  await assert.rejects(searchPatents({ query: "DVFS", source: "google" }, { fetchImpl: async () => { throw new Error("network"); } }),
    (e) => e.code === "SEARCH_UNAVAILABLE");
});
test("search adapters transmit encoded filters and paging to each provider", async () => {
  let target;
  await searchPatents({ query: "DVFS", source: "google", assignee: "Samsung", page: 2, after: "2024-01-01" },
    { fetchImpl: async (url) => { target = new URL(url); return jsonResponse({ results: { cluster: [] } }); } });
  const query = new URLSearchParams(target.searchParams.get("url"));
  assert.equal(query.get("assignee"), "Samsung"); assert.equal(query.get("page"), "2");
  assert.equal(query.get("after"), "publication:20240101");
  const result = await searchPatents({ query: "DVFS", source: "serpapi", searchKey: "fake-search-key" },
    { fetchImpl: async (url) => { target = new URL(url); return jsonResponse({ organic_results: [], search_information: { total_results: 0 } }); } });
  assert.equal(target.searchParams.get("engine"), "google_patents");
  assert.equal(target.searchParams.get("page"), "1");
  assert.equal(target.searchParams.get("dups"), "language");
  assert.ok(!JSON.stringify(result).includes("fake-search-key"));
});
test("HTML parser preserves claims and separates source sections and priority date", () => {
  const p = parsePatentHtml('<html><head><meta name="DC.title" content="DVFS"><meta name="DC.date" scheme="datePublished" content="2024-02-15"></head><body>' +
    '<time itemprop="priorityDate" datetime="2022-08-12"></time><div itemprop="abstract">Abstract only.</div>' +
    '<div itemprop="claims"><div class="claim" num="00001">1. A CPU receives a value.</div><div class="claim" num="00002">2. The CPU of claim 1.</div></div>' +
    '<section itemprop="description">Description only.</section></body></html>', "US20240053809A1");
  assert.equal(p.claims[0].number, "1"); assert.equal(p.claims.length, 2);
  assert.equal(p.abstract, "Abstract only."); assert.equal(p.description, "Description only.");
  assert.equal(p.priorityDate, "2022-08-12");
  assert.throws(() => parsePatentHtml("<html>captcha</html>", "US20240053809A1"));
});
test("SerpAPI details preserve individual claims and assignee names", () => {
  const p = parseSerpDetail({ title: "Example", assignees: [{ name: "Samsung" }], claims: ["1. A processor.", "2. The processor of claim 1."], abstract: "Abstract." }, "US20240053809A1");
  assert.equal(p.claims.length, 2); assert.equal(p.assignee, "Samsung");
});
test("seed details explicitly label short excerpts", async () => {
  const p = await getPatent({ source: "seed", publicationNumber: "US20240053809A1" });
  assert.equal(p.coverage, "claim_excerpt");
  assert.match(p.notice, /不是完整/);
});
test("empty or huge input is rejected, never silently truncated", () => {
  assert.throws(() => prepareInput({ sections: { abstract: "", claims: "", description: "" } }));
  assert.throws(() => prepareInput({ ...input, sections: { ...input.sections, claims: "x".repeat(120001) } }));
  assert.throws(() => prepareInput(undefined));
});
test("schema/evidence pass still requires human review", () => {
  const e = evaluateExtraction(input, mockOutput(input));
  assert.equal(e.schemaValid, true);
  assert.equal(e.status, "awaiting_human_review");
  assert.equal(e.metrics.groundingRate, 1);
});
test("schema rejects extra fields and missing nested fields", () => {
  const output = mockOutput(input); output.unrequested = "invented";
  assert.equal(evaluateExtraction(input, output).schemaValid, false);
  delete output.unrequested; delete output.mechanism.evidenceIds;
  assert.equal(evaluateExtraction(input, output).schemaValid, false);
});
test("wrong evidence, duplicate IDs, dangling references and unsupported assertions are detected", () => {
  const output = mockOutput(input, true);
  output.evidence.push({ ...output.evidence[0] });
  output.problem = { value: "invented problem", evidenceIds: [] };
  const types = evaluateExtraction(input, output).errors.map((e) => e.type);
  for (const type of ["EVIDENCE_NOT_GROUNDED", "DUPLICATE_EVIDENCE_ID", "EVIDENCE_REFERENCE_MISSING", "UNSUPPORTED_EXTRACTION"]) assert.ok(types.includes(type));
});
test("evidence cannot be grounded in the wrong section", () => {
  const output = mockOutput(input);
  output.evidence[0].section = "description";
  const types = evaluateExtraction(input, output).errors.map((e) => e.type);
  assert.ok(types.includes("EVIDENCE_NOT_GROUNDED"));
  assert.ok(types.includes("CLAIM_EVIDENCE_WRONG_SECTION"));
});
test("whitespace matches are distinguished from exact original-text matches", () => {
  const output = mockOutput(input);
  output.evidence[0].quote = input.sections.claims.replaceAll(" ", "\n");
  const e = evaluateExtraction(input, output);
  assert.equal(e.evidenceChecks[0].match, "whitespace_normalized");
  assert.equal(e.evidenceChecks[0].offset, null);
});
test("API config rejects insecure remote URLs, embedded credentials and invalid limits", () => {
  for (const c of [{ baseUrl: "http://remote.example/v1" }, { baseUrl: "https://user:pass@example.com/v1" }, { apiKey: "" }, { maxOutputTokens: 1 }, { protocol: "unknown" }]) assert.throws(() => normalizeConfig({ ...config, ...c }));
  assert.equal(normalizeConfig({ ...config, baseUrl: "http://127.0.0.1:11434/v1" }).baseUrl, "http://127.0.0.1:11434/v1");
});
test("Responses and compatible requests use the correct schema format and token limit", () => {
  const r = buildRequest(normalizeConfig(config), "JSON test");
  assert.equal(r.body.store, false); assert.equal(r.body.text.format.strict, true);
  assert.equal(r.body.max_output_tokens, 2500); assert.equal(r.url, config.baseUrl + "/responses");
  const c = buildRequest(normalizeConfig({ ...config, protocol: "chat" }), "JSON test");
  assert.equal(c.body.response_format.json_schema.strict, true); assert.equal(c.body.max_tokens, 2500);
  assert.ok(!("apiKey" in c.body));
  const newer = buildRequest(normalizeConfig({ ...config, protocol: "chat", tokenParameter: "max_completion_tokens" }), "JSON test");
  assert.equal(newer.body.max_completion_tokens, 2500);
  assert.ok(!("max_tokens" in newer.body));
});
test("Responses parser ignores reasoning items and catches refusals/incomplete output", () => {
  assert.equal(readModelText({ output: [{ type: "reasoning" }, { content: [{ type: "output_text", text: "{}" }] }] }, "responses"), "{}");
  assert.throws(() => readModelText({ status: "incomplete", output: [] }, "responses"));
  assert.throws(() => readModelText({ output: [{ content: [{ type: "refusal" }] }] }, "responses"));
});

test("xAI budget preset uses explicit current model, strict schema and bounded output without tools", () => {
  const preset = MODEL_PRESETS[DEFAULT_PRESET];
  const c = normalizeConfig({ ...preset, apiKey: "fake-xai-key" });
  const r = buildRequest(c, "JSON extraction");
  assert.equal(r.url, "https://api.x.ai/v1/responses");
  assert.equal(r.body.model, "grok-build-0.1");
  assert.equal(r.body.max_output_tokens, 2500);
  assert.equal(r.body.store, false);
  assert.equal(r.body.text.format.strict, true);
  for (const field of ["tools", "service_tier", "reasoning", "apiKey"]) assert.ok(!(field in r.body));
  assert.match(modelNotice(c.baseUrl, c.model), /质量未验证/);
});

test("xAI general preset explicitly disables reasoning in both API protocols", () => {
  const c = normalizeConfig({ ...MODEL_PRESETS["xai-general"], apiKey: "fake-xai-key" });
  assert.deepEqual(buildRequest(c, "JSON").body.reasoning, { effort: "none" });
  const chat = buildRequest({ ...c, protocol: "chat" }, "JSON");
  assert.equal(chat.url, "https://api.x.ai/v1/chat/completions");
  assert.equal(chat.body.reasoning_effort, "none");
  assert.ok(!("reasoning" in chat.body));
});

test("retired xAI model IDs are rejected before making any paid request", async () => {
  let count = 0;
  for (const model of RETIRED_XAI_MODELS) {
    await assert.rejects(runExperiment(input, { ...config, baseUrl: "https://api.x.ai/v1", model },
      { fetchImpl: async () => { count++; throw new Error("should not call"); } }), (e) => e.code === "XAI_MODEL_RETIRED");
  }
  assert.equal(count, 0);
  assert.equal(normalizeConfig({ ...config, model: "grok-3" }).model, "grok-3");
  assert.throws(() => normalizeConfig({ ...config, reasoningEffort: "invalid" }));
  assert.throws(() => normalizeConfig({ ...MODEL_PRESETS[DEFAULT_PRESET], apiKey: "fake", reasoningEffort: "none" }), (e) => e.code === "XAI_REASONING_UNSUPPORTED");
});

test("xAI response is parsed with usage and reasoning setting retained but Key redacted", async () => {
  let count = 0;
  const c = { ...MODEL_PRESETS["xai-general"], apiKey: "fake-xai-key" };
  const r = await runExperiment(input, c, { fetchImpl: async (url, options) => {
    count++;
    assert.equal(url, "https://api.x.ai/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer fake-xai-key");
    assert.equal(JSON.parse(options.body).reasoning.effort, "none");
    return jsonResponse({ model: "grok-4.3", status: "completed", output: [{ type: "reasoning" },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(mockOutput(input)) }] }],
      usage: { input_tokens: 3000, output_tokens: 2000 }, echoedKey: c.apiKey });
  } });
  assert.equal(count, 1); assert.equal(r.run.reasoningEffort, "none");
  assert.equal(r.run.resolvedModel, "grok-4.3"); assert.equal(r.run.usage.output_tokens, 2000);
  assert.equal(r.evaluation.status, "awaiting_human_review");
  assert.ok(!JSON.stringify(r).includes(c.apiKey));
});
test("real-adapter test uses only a fake transport; auth sent but absent from report", async () => {
  let count = 0;
  const result = await runExperiment(input, config, { fetchImpl: async (url, options) => {
    count++; assert.equal(url, config.baseUrl + "/responses"); assert.equal(options.headers.Authorization, "Bearer " + config.apiKey);
    assert.equal(options.redirect, "error");
    return jsonResponse({ id: "test", status: "completed", model: "test-model",
      output: [{ content: [{ type: "output_text", text: JSON.stringify(mockOutput(input)) }] }],
      usage: { input_tokens: 123, output_tokens: 456 }, echoedKey: config.apiKey });
  } });
  assert.equal(count, 1); assert.equal(result.evaluation.status, "awaiting_human_review");
  assert.equal(result.run.usage.input_tokens, 123); assert.ok(!JSON.stringify(result).includes(config.apiKey));
  assert.equal(result.rawResponse.echoedKey, "[REDACTED]");
});
test("compatible API parses fenced JSON but schema still validated locally", async () => {
  const fence = String.fromCharCode(96).repeat(3);
  const r = await runExperiment(input, { ...config, protocol: "chat", format: "prompt" },
    { fetchImpl: async () => jsonResponse({ choices: [{ finish_reason: "stop", message: { content: fence + "json\n" + JSON.stringify(mockOutput(input)) + "\n" + fence } }] }) });
  assert.equal(r.evaluation.schemaValid, true);
});
test("invalid model JSON preserves raw response and returns parse error report", async () => {
  const r = await runExperiment(input, config, { fetchImpl: async () => jsonResponse({ output_text: "not JSON" }) });
  assert.equal(r.evaluation.errors[0].type, "JSON_PARSE_ERROR");
  assert.equal(r.rawResponse.output_text, "not JSON");
});
test("refusals preserve original response and cannot become verified", async () => {
  const response = { output: [{ content: [{ type: "refusal", refusal: "test refusal" }] }] };
  const r = await runExperiment(input, config, { fetchImpl: async () => jsonResponse(response) });
  assert.equal(r.evaluation.errors[0].type, "MODEL_REFUSAL");
  assert.deepEqual(r.rawResponse, response);
});
test("quota errors trigger one request only and never echo provider secret", async () => {
  let count = 0;
  await assert.rejects(runExperiment(input, config, { fetchImpl: async () => { count++; return jsonResponse({ error: { message: config.apiKey } }, 429); } }),
    (e) => e.code === "LLM_HTTP_429" && !e.message.includes(config.apiKey));
  assert.equal(count, 1);
});
test("offline mock never uses network", async () => {
  const r = await runExperiment(input, { protocol: "mock" }, { fetchImpl: () => { throw new Error("must not call"); } });
  assert.equal(r.run.mock, true);
  assert.equal(r.evaluation.status, "awaiting_human_review");
});
test("model connection check obtains models without generating output", async () => {
  const r = await listModels(config, { fetchImpl: async (url) => {
    assert.equal(url, config.baseUrl + "/models"); return jsonResponse({ data: [{ id: "z" }, { id: "a" }] });
  } });
  assert.deepEqual(r.models, ["a", "z"]);
});
test("redaction also handles secrets with JSON escapes", () => {
  assert.equal(redact({ value: 'prefix-key"quote-suffix' }, ['key"quote']).value, "prefix-[REDACTED]-suffix");
});
test("HTTP surface serves UI, rejects cross-origin writes and runs the whole mock flow", async (t) => {
  const server = createApp({ fetchImpl: async () => { throw new Error("No external traffic allowed"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (route, value, headers = {}) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Patent-Client": "workbench", ...headers }, body: JSON.stringify(value) });
  const page = await fetch(base + "/");
  assert.equal(page.status, 200); assert.match(await page.text(), /id="search-form"/);
  const presets = await fetch(base + "/model-presets.js");
  assert.equal(presets.status, 200); assert.match(await presets.text(), /grok-build-0.1/);
  assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.equal((await request("/api/test", { input, config: { protocol: "mock" } }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await fetch(base + "/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await request("/api/test", { input, config: { protocol: "mock" } })).status, 200);
  const search = await (await request("/api/search", { source: "seed", query: "DVFS" })).json();
  assert.equal(search.records.length, 4);
  const detail = await (await request("/api/patent", { source: "seed", publicationNumber: search.records[0].publicationNumber })).json();
  assert.equal(detail.coverage, "claim_excerpt");
});
