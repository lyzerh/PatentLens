import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { normalizeRetrievalProxy, loadRetrievalNetwork, createRetrievalTransport } from "../src/network.js";
import { parsePatentHtml, searchPatents, getPatent } from "../src/retrieval.js";
import { createApp, APP_VERSION } from "../src/server.js";

const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status });
const closeServer = (server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
const fixture = await readFile(new URL("../fixtures/google-description-legal-events.html", import.meta.url), "utf8");

test("project proxy configuration permits only credential-free loopback HTTP ports", () => {
  assert.equal(normalizeRetrievalProxy("http://127.0.0.1:7897/"), "http://127.0.0.1:7897");
  assert.equal(normalizeRetrievalProxy("http://localhost:7897"), "http://localhost:7897");
  assert.equal(normalizeRetrievalProxy("direct"), null);
  for (const url of ["http://evil.test:7897", "http://127.0.0.1", "socks5://127.0.0.1:7897", "http://user:secret@127.0.0.1:7897", "http://127.0.0.1:7897/path", "http://127.0.0.1:7897?secret=key", "http://127.0.0.1:7897#key"]) {
    assert.throws(() => normalizeRetrievalProxy(url), (error) => error.code === "INVALID_RETRIEVAL_PROXY" && !error.message.includes("secret"));
  }
});

test("network configuration gives explicit environment override precedence, validates JSON and defaults safely", async () => {
  const readConfig = async () => JSON.stringify({ retrievalProxy: "http://127.0.0.1:7897" });
  assert.deepEqual(await loadRetrievalNetwork({ env: {}, readConfig }), { proxyUrl: "http://127.0.0.1:7897", source: "project_config" });
  assert.deepEqual(await loadRetrievalNetwork({ env: { PATENT_RETRIEVAL_PROXY: "direct" }, readConfig }), { proxyUrl: null, source: "environment" });
  assert.deepEqual(await loadRetrievalNetwork({ env: {}, readConfig: async () => { throw Object.assign(new Error(), { code: "ENOENT" }); } }), { proxyUrl: null, source: "default_direct" });
  await assert.rejects(loadRetrievalNetwork({ env: {}, readConfig: async () => "invalid-secret-json" }), (error) => error.code === "INVALID_NETWORK_CONFIG" && !error.message.includes("secret"));
});

test("retrieval transport uses a per-request dispatcher, blocks non-retrieval targets and never falls back", async () => {
  let calls = 0, proxyCreations = 0, closed = false;
  const dispatcher = { close: async () => { closed = true; } };
  const transport = createRetrievalTransport({ proxyUrl: "http://127.0.0.1:7897", source: "test" }, {
    proxyFactory: (url) => { proxyCreations++; assert.equal(url, "http://127.0.0.1:7897"); return dispatcher; },
    fetchImpl: async (url, options) => { calls++; assert.equal(options.dispatcher, dispatcher); assert.equal(options.redirect, "error"); throw Object.assign(new Error("hidden-provider-secret"), { cause: { code: "ECONNREFUSED" } }); }
  });
  await assert.rejects(searchPatents({ source: "google", query: "DVFS" }, { fetchImpl: transport.fetchImpl }), (error) => error.code === "SEARCH_CONNECTION_REFUSED" && !error.message.includes("secret"));
  assert.equal(calls, 1); assert.equal(proxyCreations, 1);
  await assert.rejects(transport.fetchImpl("https://api.x.ai/v1/models"), (error) => error.code === "RETRIEVAL_TARGET_BLOCKED");
  await assert.rejects(transport.fetchImpl("http://127.0.0.1:4317/api/health"), (error) => error.code === "RETRIEVAL_TARGET_BLOCKED");
  assert.equal(calls, 1); await transport.close(); assert.equal(closed, true);
});

test("explicit direct mode uses its own direct dispatcher rather than a global proxy", async () => {
  const dispatcher = { close: async () => {} }; let called = false;
  const transport = createRetrievalTransport({ proxyUrl: null }, {
    directFactory: () => dispatcher, proxyFactory: () => { throw new Error("no proxy"); },
    fetchImpl: async (url, options) => { called = true; assert.equal(options.dispatcher, dispatcher); return jsonResponse({}); }
  });
  await transport.fetchImpl("https://patents.google.com/");
  assert.equal(called, true); assert.equal(transport.metadata.mode, "direct"); await transport.close();
});

test("specification ignores preceding legal-event descriptions and retains paragraph identifiers", () => {
  const patent = parsePatentHtml(fixture, "US20240053809A1");
  assert.equal(patent.description, "TECHNICAL FIELD\n[0001] A processor controls a clock according to workload.\n[0002] A controller supplies a voltage to the processor.");
  assert.ok(!/ASSIGNMENT|Assignors|Legal event|UNTRUSTED/.test(patent.description));
  assert.equal(patent.claims.length, 1); assert.equal(patent.abstract, "Synthetic abstract.");
  assert.equal(patent.sectionAvailability.description, true);
});

test("missing specification never falls back to legal events and is clearly identified", () => {
  const patent = parsePatentHtml('<div itemprop="abstract">Abstract.</div><span itemprop="description">Assignment.</span><div class="legal-event"><div class="description">Legal text.</div></div>', "US20240053809A1");
  assert.equal(patent.description, ""); assert.equal(patent.sectionAvailability.description, false);
  assert.match(patent.notice, /未找到可信/);
  assert.throws(() => parsePatentHtml('<span itemprop="description">Assignment only.</span>', "US20240053809A1"), (error) => error.code === "PATENT_TEXT_UNAVAILABLE");
});

test("description container fallback and long paragraphs preserve full source rather than truncating", () => {
  const longText = "word ".repeat(13000).trim();
  const patent = parsePatentHtml('<div class="description"><p>[0042] ' + longText + '</p><p>[0043] Next paragraph.</p></div>', "US20240053809A1");
  assert.equal(patent.description, "[0042] " + longText + "\n[0043] Next paragraph.");
  assert.ok(patent.description.length > 60000);
});

test("retrieval errors distinguish transport failures, HTTP denial and invalid upstream JSON without exposing secrets", async () => {
  const cases = [["UND_ERR_CONNECT_TIMEOUT", "SEARCH_CONNECT_TIMEOUT"], ["ENOTFOUND", "SEARCH_DNS_FAILED"], ["ECONNRESET", "SEARCH_CONNECTION_RESET"], ["CERT_HAS_EXPIRED", "SEARCH_TLS_FAILED"]];
  for (const [code, expected] of cases) {
    await assert.rejects(searchPatents({ source: "google", query: "DVFS" }, { fetchImpl: async () => { throw new TypeError("secret", { cause: { code } }); } }), (error) => error.code === expected && !error.message.includes("secret"));
  }
  await assert.rejects(searchPatents({ source: "google", query: "DVFS" }, { fetchImpl: async () => jsonResponse({ error: "secret" }, 403) }), (error) => error.code === "UPSTREAM_HTTP_403" && !error.message.includes("secret"));
  await assert.rejects(searchPatents({ source: "google", query: "DVFS" }, { fetchImpl: async () => new Response("<html>captcha</html>") }), (error) => error.code === "SEARCH_FORMAT_CHANGED");
  await assert.rejects(getPatent({ source: "google", publicationNumber: "US20240053809A1" }, { fetchImpl: async () => { throw new TypeError("secret", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }); } }), (error) => error.code === "PATENT_CONNECT_TIMEOUT");
});

test("HTTP routing sends only search and patent traffic through retrieval transport", async (t) => {
  let retrievalCalls = 0, normalCalls = 0;
  const server = createApp({
    retrievalNetwork: { mode: "proxy", proxyUrl: "http://127.0.0.1:7897", scope: "patent_retrieval_only" },
    retrievalFetchImpl: async (url) => { retrievalCalls++; return url.includes("xhr/query") ? jsonResponse({ results: { cluster: [], total_num_results: 0 } }) : new Response(fixture); },
    fetchImpl: async () => { normalCalls++; return jsonResponse({ data: [{ id: "test-model" }] }); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); t.after(() => closeServer(server));
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (route, body) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Patent-Client": "workbench" }, body: JSON.stringify(body) });
  const health = await (await fetch(base + "/api/health")).json();
  assert.equal(health.version, APP_VERSION); assert.equal(health.retrievalNetwork.proxyUrl, "http://127.0.0.1:7897");
  assert.equal((await post("/api/search", { source: "google", query: "DVFS" })).status, 200);
  const detail = await (await post("/api/patent", { source: "google", publicationNumber: "US20240053809A1" })).json();
  assert.ok(!detail.description.includes("ASSIGNMENT"));
  assert.equal((await post("/api/models", { protocol: "chat", baseUrl: "https://api.x.ai/v1", apiKey: "fake-test-key" })).status, 200);
  assert.equal(retrievalCalls, 2); assert.equal(normalCalls, 1);
});

test("Google throttling is distinguished from generic outages without retries or leaking source HTML", async () => {
  for (const status of [429, 503]) {
    let calls = 0;
    await assert.rejects(searchPatents({ source: "google", query: "DVFS" }, { fetchImpl: async () => {
      calls++; return new Response("<html>secret ... your network may be sending automated queries.</html>", { status });
    } }), (error) => error.code === "GOOGLE_RATE_LIMITED" && !error.message.includes("secret"));
    assert.equal(calls, 1);
  }
  await assert.rejects(getPatent({ source: "google", publicationNumber: "US20240053809A1" }, { fetchImpl: async () => new Response("unusual traffic", { status: 503 }) }), (error) => error.code === "GOOGLE_RATE_LIMITED");
  await assert.rejects(searchPatents({ source: "google", query: "DVFS" }, { fetchImpl: async () => new Response("service unavailable", { status: 503 }) }), (error) => error.code === "UPSTREAM_HTTP_503");
});

test("actual CONNECT failure on a disposable local proxy gives one safe error and no direct fallback", async (t) => {
  let connects = 0;
  const proxy = http.createServer();
  proxy.on("connect", (_request, socket) => { connects++; socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n"); });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => closeServer(proxy));
  const transport = createRetrievalTransport({ proxyUrl: "http://127.0.0.1:" + proxy.address().port });
  t.after(() => transport.close());
  await assert.rejects(searchPatents({ source: "google", query: "synthetic" }, { fetchImpl: transport.fetchImpl }));
  assert.equal(connects, 1);
});
