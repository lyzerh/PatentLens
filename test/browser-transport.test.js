import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { browserBase, browserJson, publicConfig, runBrowserExperiment, diagnoseBrowserXai } from "../public/browser-xai.js";
import { prepareBrowserExperiment, completeBrowserExperiment } from "../src/llm.js";
import { mockOutput } from "../src/extraction.js";
import { MODEL_PRESETS } from "../public/model-presets.js";
import { diagnoseXai } from "../src/diagnostics.js";
import { createApp } from "../src/server.js";
import { startLocal, probeWorkbench } from "../scripts/start-edge.js";

const input = { publicationNumber: "DEMO-001", title: "Synthetic", coverage: "synthetic",
  sections: { claims: "Claim 1. A processor adjusts a clock frequency according to a workload value.", abstract: "", description: "" } };
const key = 'fake-browser-key-"quoted';
const config = { ...MODEL_PRESETS["xai-lawlens"], apiKey: key };
const responseJson = (value, status = 200) => new Response(JSON.stringify(value), { status });
const modelResponse = () => ({ model: config.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(mockOutput(input)) } }], usage: { prompt_tokens: 25, completion_tokens: 30 } });
const closeServer = (server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });

test("browser route only permits explicit official xAI endpoints", () => {
  assert.equal(browserBase("https://api.x.ai/v1/"), "https://api.x.ai/v1");
  assert.equal(browserBase("https://us.api.x.ai/v1"), "https://us.api.x.ai/v1");
  for (const base of ["http://api.x.ai/v1", "https://api.x.ai.evil.test/v1", "https://u:p@api.x.ai/v1", "https://api.x.ai/v1?q=secret", "http://127.0.0.1:1000/v1", "https://api.x.ai/v1#key", "https://api.x.ai:999/v1"]) assert.throws(() => browserBase(base));
});

test("public configuration is allowlisted and browser plan never needs the real Key", () => {
  const safe = publicConfig({ ...config, secret: "do-not-copy", Authorization: "forbidden" });
  assert.ok(!Object.hasOwn(safe, "apiKey")); assert.ok(!Object.hasOwn(safe, "secret"));
  const plan = prepareBrowserExperiment(input, safe);
  assert.equal(plan.request.url, "https://api.x.ai/v1/chat/completions");
  assert.equal(plan.request.body.model, "grok-4.20-0309-reasoning");
  assert.equal(plan.request.body.max_tokens, 8192);
  assert.ok(!Object.hasOwn(plan.request.body, "reasoning_effort"));
  assert.ok(!JSON.stringify(plan).includes(key));
  assert.throws(() => prepareBrowserExperiment(input, config), (e) => e.code === "BROWSER_KEY_NOT_ALLOWED");
  assert.throws(() => prepareBrowserExperiment(input, { ...safe, baseUrl: "https://other.test/v1" }), (e) => e.code === "BROWSER_XAI_ONLY");
});

test("browser flow sends Key only to xAI, redacts echoed secrets and validates locally", async () => {
  let paidCount = 0; const routes = [];
  const api = async (route, payload) => {
    routes.push(route);
    assert.ok(!JSON.stringify(payload).includes(JSON.stringify(key).slice(1, -1)));
    assert.ok(!Object.hasOwn(payload.config, "apiKey"));
    if (route === "browser-prepare") return prepareBrowserExperiment(payload.input, payload.config);
    assert.equal(route, "browser-result");
    return completeBrowserExperiment(payload.input, payload.config, payload.rawResponse, payload.timing);
  };
  const result = await runBrowserExperiment(input, config, { api, fetchImpl: async (url, options) => {
    paidCount++; assert.equal(url, "https://api.x.ai/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer " + key);
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
    assert.equal(JSON.parse(options.body).model, config.model);
    return responseJson({ ...modelResponse(), echoedKey: key });
  } });
  assert.equal(paidCount, 1); assert.deepEqual(routes, ["browser-prepare", "browser-result"]);
  assert.equal(result.run.transport, "browser"); assert.equal(result.run.responseOrigin, "browser_reported");
  assert.equal(result.run.mock, false); assert.equal(result.run.usage.completion_tokens, 30);
  assert.equal(result.evaluation.status, "awaiting_human_review");
  assert.equal(result.rawResponse.echoedKey, "[REDACTED]");
});

test("browser error paths neither retry, fall back nor disclose provider response", async () => {
  for (const fetchImpl of [async () => { throw new TypeError(key); }, async () => responseJson({ error: key }, 401), async () => responseJson({ error: key }, 429)]) {
    let calls = 0; const routes = [];
    await assert.rejects(runBrowserExperiment(input, config, {
      api: async (route, payload) => { routes.push(route); return prepareBrowserExperiment(payload.input, payload.config); },
      fetchImpl: async (...args) => { calls++; return fetchImpl(...args); }
    }), (error) => !error.message.includes(key));
    assert.equal(calls, 1); assert.deepEqual(routes, ["browser-prepare"]);
  }
  let calls = 0;
  await assert.rejects(browserJson("https://evil.test/v1/models", key, { fetchImpl: async () => { calls++; } }));
  await assert.rejects(browserJson("https://api.x.ai/v1/models", "", { fetchImpl: async () => { calls++; } }));
  assert.equal(calls, 0);
});

test("a returned provider response is not regenerated after local validation failure", async () => {
  let count = 0;
  await assert.rejects(runBrowserExperiment(input, config, {
    api: async (route, body) => { if (route === "browser-prepare") return prepareBrowserExperiment(body.input, body.config); throw new Error("local failure"); },
    fetchImpl: async () => { count++; return responseJson(modelResponse()); }
  }), /xAI 已返回响应/);
  assert.equal(count, 1);
});

test("browser refuses incomplete output and keeps raw response for review", () => {
  const raw = { choices: [{ finish_reason: "length", message: { content: "partial" } }] };
  const result = completeBrowserExperiment(input, publicConfig(config), raw, { latencyMs: 10 });
  assert.equal(result.evaluation.status, "needs_revision");
  assert.equal(result.evaluation.errors[0].type, "OUTPUT_INCOMPLETE");
  assert.deepEqual(result.rawResponse, raw);
  assert.throws(() => completeBrowserExperiment(input, publicConfig(config), raw, { latencyMs: -1 }));
});

test("both diagnostics use one unauthenticated GET only and treat 401 as HTTP reachability", async () => {
  for (const diagnostic of [diagnoseXai, diagnoseBrowserXai]) {
    let calls = 0;
    const result = await diagnostic({ fetchImpl: async (url, options) => {
      calls++; assert.equal(url, "https://api.x.ai/v1/models"); assert.equal(options.method, "GET");
      assert.ok(!options.body); assert.ok(!options.headers?.Authorization);
      return responseJson({ error: "key missing" }, 401);
    } });
    assert.equal(calls, 1); assert.equal(result.reachedHttp, true); assert.equal(result.httpStatus, 401);
    assert.equal(result.authenticated, false); assert.equal(result.generation, false);
  }
  const result = await diagnoseXai({ fetchImpl: async () => { throw new TypeError(key, { cause: { code: "UND_ERR_CONNECT_TIMEOUT", message: key } }); } });
  assert.equal(result.errorCode, "UND_ERR_CONNECT_TIMEOUT"); assert.ok(!JSON.stringify(result).includes(key));
});

test("HTTP serves browser module and new endpoints without performing external fetch", async (t) => {
  let calls = 0;
  const server = createApp({ fetchImpl: async () => { calls++; throw new Error("external fetch forbidden"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => closeServer(server));
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (route, body, origin) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Patent-Client": "workbench", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  const workspace = await fetch(base + "/"); assert.match(await workspace.text(), /专利技术研究工作台/);
  const page = await fetch(base + "/patent-search"); const html = await page.text();
  assert.match(html, /id="transport"/); assert.match(html, /id="network-diagnose"/);
  assert.match(page.headers.get("content-security-policy"), /connect-src 'self' https:\/\/api.x.ai https:\/\/us.api.x.ai;/);
  assert.equal((await fetch(base + "/browser-xai.js")).status, 200);
  assert.equal(await probeWorkbench(server.address().port), true);
  const planResponse = await post("/api/browser-prepare", { input, config: publicConfig(config) });
  assert.equal(planResponse.status, 200); assert.equal((await planResponse.json()).request.body.model, config.model);
  const result = await post("/api/browser-result", { input, config: publicConfig(config), rawResponse: modelResponse(), timing: { latencyMs: 2 } });
  assert.equal(result.status, 200); assert.equal((await result.json()).run.transport, "browser");
  assert.equal((await post("/api/browser-prepare", { input, config })).status, 400);
  assert.equal((await post("/api/browser-result", {}, "https://evil.test")).status, 403);
  assert.equal(calls, 0);
});

test("launcher skips an occupied old server without killing it and can reuse its own v0.3 service", async (t) => {
  const occupied = http.createServer((_req, res) => { res.end("old app"); });
  await new Promise((resolve) => occupied.listen(0, "127.0.0.1", resolve));
  t.after(() => closeServer(occupied));
  const port = occupied.address().port;
  if (port > 65525) return t.skip("ephemeral port too near upper bound");
  const result = await startLocal({ startPort: port, probe: async () => false });
  t.after(() => closeServer(result.server));
  assert.ok(result.port > port); assert.equal(occupied.listening, true); assert.equal(result.reused, false);
  const reused = await startLocal({ startPort: result.port });
  assert.equal(reused.reused, true); assert.equal(reused.server, null); assert.equal(reused.port, result.port);
});
