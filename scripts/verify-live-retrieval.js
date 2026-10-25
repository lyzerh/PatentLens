// Opt-in public Google checks only. Never called by npm test; no LLM or SerpAPI Key.
import assert from "node:assert/strict";
import { createRuntimeApp, APP_VERSION } from "../src/server.js";

let app;
let base = process.argv[2];
if (base) {
  const url = new URL(base);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Only the local workbench URL is permitted");
  base = url.origin;
} else {
  app = await createRuntimeApp();
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + app.address().port;
}
async function post(path, input) {
  const started = performance.now();
  const response = await fetch(base + "/api/" + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Patent-Client": "workbench" },
    body: JSON.stringify(input), signal: AbortSignal.timeout(35000) });
  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify({ httpStatus: response.status, error: data.error }));
  return { data, latencyMs: Math.round(performance.now() - started) };
}
const checks = [];
try {
  const health = await (await fetch(base + "/api/health", { signal: AbortSignal.timeout(3000) })).json();
  assert.equal(health.app, "patent-intelligence-workbench"); assert.equal(health.version, APP_VERSION);
  checks.push({ name: "runtime", ok: true, version: health.version, network: health.retrievalNetwork });
  const cases = [
    ["basic", { source: "google", query: "DVFS", page: 0 }],
    ["page2", { source: "google", query: "DVFS", page: 1 }],
    ["filtered", { source: "google", query: "DVFS", country: "US", assignee: "Samsung", after: "2020-01-01", before: "2026-01-01" }],
    ["zero", { source: "google", query: '"zzpatentworkbenchsynthnonsense20261003"' }]
  ];
  const responses = new Map();
  for (const [name, input] of cases) {
    const { data, latencyMs } = await post("search", input);
    assert.equal(data.source, "google");
    if (name === "zero") { assert.equal(data.records.length, 0); assert.equal(data.hasNext, false); }
    else assert.ok(data.records.length > 0);
    if (name === "filtered") assert.ok(data.records.every((r) => r.country === "US" && r.assignee.toLowerCase().includes("samsung") && r.publicationDate >= input.after && r.publicationDate <= input.before));
    responses.set(name, data);
    checks.push({ name, ok: true, latencyMs, count: data.records.length, total: data.total, page: data.page, hasNext: data.hasNext,
      firstId: data.records[0]?.publicationNumber, firstAssignee: data.records[0]?.assignee, publicationDates: data.records.map((r) => r.publicationDate) });
  }
  assert.notDeepEqual(responses.get("basic").records.map((r) => r.publicationNumber), responses.get("page2").records.map((r) => r.publicationNumber));
  checks.push({ name: "distinct_pages", ok: true });
  const { data: patent, latencyMs } = await post("patent", { source: "google", publicationNumber: "US20240053809A1" });
  assert.equal(patent.claims.length, 20); assert.ok(patent.claims[0].text.length > 800);
  assert.ok(patent.description.length > 50000); assert.ok(patent.description.includes("\n"));
  assert.ok(!patent.description.includes("ASSIGNMENT OF ASSIGNORS INTEREST"));
  checks.push({ name: "detail", ok: true, latencyMs, publicationNumber: patent.publicationNumber, claims: patent.claims.length,
    claim1Characters: patent.claims[0].text.length, descriptionCharacters: patent.description.length,
    descriptionParagraphs: patent.description.split("\n").length, descriptionStart: patent.description.slice(0, 160), sectionAvailability: patent.sectionAvailability });
  console.log(JSON.stringify({ ok: true, generationRequests: 0, checks }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, generationRequests: 0, checks, error: error.message }, null, 2));
  process.exitCode = 1;
} finally {
  if (app) await new Promise((resolve) => { app.close(resolve); app.closeAllConnections(); });
}
