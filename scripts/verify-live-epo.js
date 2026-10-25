// Opt-in small EPO trial. No account, Key, LLM or paid-provider requests; stop on first failure.
import assert from "node:assert/strict";
const url = new URL(process.argv[2] || "http://127.0.0.1:4317/");
if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Only a loopback workbench URL is accepted");
const checks = [];
const post = async (route, body) => {
  const start = performance.now();
  const response = await fetch(url.origin + "/api/" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Patent-Client": "workbench" }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000) });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data.error));
  return { data, latencyMs: Math.round(performance.now() - start) };
};
try {
  const health = await (await fetch(url.origin + "/api/health")).json(); assert.equal(health.version, "0.5.0");
  const inputs = [
    ["keywords", { source: "epo", query: "DVFS" }],
    ["page2", { source: "epo", query: "DVFS", page: 1 }],
    ["filtered", { source: "epo", query: "DVFS", assignee: "Qualcomm", country: "EP", after: "2020-01-01", before: "2026-01-01" }],
    ["zero", { source: "epo", query: "zzpatentsynthnonsense20261018" }],
    ["exact", { source: "epo", query: "EP3633495A1" }]
  ];
  const pages = [];
  for (const [name, input] of inputs) {
    const { data, latencyMs } = await post("search", input);
    assert.equal(data.source, "epo"); assert.equal(data.total, null);
    if (name === "zero") { assert.equal(data.records.length, 0); assert.equal(data.hasNext, false); }
    else assert.ok(data.records.length > 0);
    if (name === "filtered") assert.ok(data.records.every((r) => r.country === "EP" && r.assignee.toLowerCase().includes("qualcomm") && r.publicationDate >= input.after && r.publicationDate <= input.before));
    if (name === "exact") assert.ok(data.records.every((r) => r.publicationNumber === input.query));
    if (["keywords", "page2"].includes(name)) pages.push(data.records.map((r) => r.publicationNumber));
    checks.push({ name, ok: true, latencyMs, count: data.records.length, page: data.page, hasNext: data.hasNext, first: data.records[0]?.publicationNumber, cache: data.cache });
  }
  assert.notDeepEqual(pages[0], pages[1]); checks.push({ name: "different_pages", ok: true });
  const { data: detail, latencyMs } = await post("patent", { source: "epo", publicationNumber: "EP3633495A1" });
  assert.equal(detail.source, "epo"); assert.equal(detail.claims.length, 19); assert.equal(detail.language, "fr");
  assert.ok(detail.description.length > 30000); assert.ok(detail.description.includes("[0001]"));
  checks.push({ name: "detail", ok: true, latencyMs, title: detail.title, publicationNumber: detail.publicationNumber, language: detail.language, claims: detail.claims.length, descriptionCharacters: detail.description.length, abstractCharacters: detail.abstract.length, sectionAvailability: detail.sectionAvailability });
  for (const [route, input] of [["search", inputs[0][1]], ["patent", { source: "epo", publicationNumber: "EP3633495A1" }]]) {
    const { data, latencyMs } = await post(route, input); assert.equal(data.cache.hit, true);
    checks.push({ name: route + "_cache", ok: true, latencyMs, hit: true });
  }
  console.log(JSON.stringify({ ok: true, source: "EPO", generatedAt: new Date().toISOString(), generationRequests: 0, paidProviderRequests: 0, checks }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, checks, error: error.message }, null, 2)); process.exitCode = 1;
}
