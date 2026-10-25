import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { normalizePatent, parseCsv, parseImport, portfolio, PilotStore } from "../src/pilot/records.ts";
import { CLASSIFICATION_SCHEMA, mockClassification, ruleBaseline, validateClassification } from "../src/pilot/classification.ts";
import { DEFAULT_MODEL, PilotBenchmark, costFromUsage, preflight, summarizeBenchmark } from "../src/pilot/benchmark.ts";
import { createPilotService } from "../src/pilot/service.ts";
import { createApp } from "../src/server.js";

const makeRecord = (suffix = "1") => normalizePatent({ publicationNumber: "EP3633495A" + suffix, title: "Battery controller", abstract: "A battery controller monitors cell temperature and adjusts charging current.", assignee: "Acme", filingDate: "2023-07-14", sourceUrl: "https://example.org/patent/EP3633495A1" });
const fakeOutput = record => { const result = mockClassification(record); result.classification.technical_domain = { value: "Battery Management", evidence_ids: ["E1"], support_type: "explicit" }; result.technical_summary.primary_function = { value: "控制充电电流", evidence_ids: ["E1"], support_type: "inferred" }; result.evidence = [{ evidence_id: "E1", section: "abstract", source_span: "adjusts charging current", support_type: "explicit" }]; return result; };
const noExternal = async () => { throw new Error("Unexpected external request"); };
async function temporaryStore(t) { const parent = join(process.cwd(), "data"); await mkdir(parent, { recursive: true }); const dir = await mkdtemp(join(parent, "pilot-test-")); t.after(() => rm(dir, { recursive: true, force: true })); return new PilotStore(join(dir, "pilot.json")); }

test("CSV / JSON import is bounded, quoted, provenance-marked and stable", () => {
  assert.deepEqual(parseCsv('publicationNumber,title\nEP3633495A1,"Battery, controller"\n')[0], { publicationNumber: "EP3633495A1", title: "Battery, controller" });
  assert.equal(parseImport("json", '[{"publicationNumber":"EP3633495A1"}]').length, 1);
  assert.throws(() => parseImport("json", "[]"));
  const r = makeRecord();
  assert.equal(r.id, makeRecord().id); assert.equal(r.fields.abstract.status, "imported_unverified");
  assert.equal(r.fields.familyId, null); assert.equal(r.classification, null);
  assert.throws(() => normalizePatent({ publicationNumber: "EP3633495A1", legalStatus: "Active" }), /核验日期/);
  assert.throws(() => normalizePatent({ publicationNumber: "EP3633495A1", sourceUrl: "http://example.org/" }), /HTTPS/);
});

test("store persists transactions without duplicates; dashboard does not invent family or AI counts", async t => {
  const store = await temporaryStore(t), r = makeRecord();
  await store.transaction(s => { s.records.push(r); });
  const persisted = await store.read(); assert.equal(persisted.records.length, 1);
  let p = portfolio(persisted.records);
  assert.equal(p.total, 1); assert.equal(p.familyCount, 0); assert.equal(p.reviewed, 0); assert.equal(p.pending, 1); assert.equal(p.filingYears["2023"], 1);
  assert.equal(portfolio(persisted.records, { jurisdiction: "US" }).total, 0);
  r.familyId = "FAM1"; r.fields.familyId = { status: "imported_unverified", sourceUrl: r.sourceUrl, observedAt: r.importedAt, reviewedAt: null };
  assert.equal(portfolio([r]).familyCount, 0);
  r.fields.familyId.status = "manually_reviewed";
  assert.equal(portfolio([r]).familyCount, 1);
});

test("classification requires exact-source spans, evidence references and human review", () => {
  const r = makeRecord(), output = fakeOutput(r);
  assert.equal(ruleBaseline(r).label, "Battery Management");
  assert.equal(ruleBaseline(normalizePatent({ publicationNumber: "EP3633495A2" })).label, "Unknown");
  assert.equal(CLASSIFICATION_SCHEMA.additionalProperties, false);
  const good = validateClassification(r, output);
  assert.equal(good.schemaValid, true); assert.equal(good.evidenceValid, true); assert.equal(good.status, "needs_review");
  output.evidence[0].source_span = "not in the patent";
  assert.equal(validateClassification(r, output).status, "rejected");
  output.evidence[0].source_span = "adjusts charging current";
  output.potential_applications.push({ value: "已商用于手机", evidence_ids: ["E1"], support_type: "inferred" });
  assert.equal(validateClassification(r, output).status, "rejected");
  output.potential_applications[0].value = "专利有效";
  assert.ok(validateClassification(r, output).errors.some(e => e.code === "UNSUPPORTED_LEGAL_BUSINESS_CLAIM"));
  assert.equal(validateClassification(r, mockClassification(r)).status, "insufficient_evidence");
});

test("preflight and usage separate estimate from actual provider cost", () => {
  const r = makeRecord();
  assert.ok(preflight(r, DEFAULT_MODEL, 1200).estimatedMaxUsd > 0);
  assert.equal(costFromUsage({ input_tokens: 200, output_tokens: 100, cost_in_usd_ticks: 1234567 }, DEFAULT_MODEL).usd, 0.0001234567);
  assert.equal(costFromUsage({ input_tokens: 200, output_tokens: 100 }, DEFAULT_MODEL).kind, "estimated");
  assert.equal(costFromUsage(undefined, DEFAULT_MODEL).kind, "unknown");
});

test("mock never sends network; paid budget and missing server key fail before fetch", async t => {
  const store = await temporaryStore(t), r = makeRecord(); await store.transaction(s => { s.records.push(r); });
  const bench = new PilotBenchmark(store, noExternal, () => undefined);
  const result = await bench.run(r.id, DEFAULT_MODEL, { mock: true });
  assert.equal(result.mode, "mock"); assert.equal(result.apiCostUsd, 0); assert.equal(result.status, "insufficient_evidence");
  await assert.rejects(bench.run(r.id, DEFAULT_MODEL, { taskBudgetUsd: 0 }), /预算/);
  await assert.rejects(bench.run(r.id, DEFAULT_MODEL, { taskBudgetUsd: 1 }), /XAI_API_KEY/);
  assert.equal((await store.read()).records[0].classification, null);
});

test("fake xAI response records exact cost, caches paid task and excludes key", async t => {
  const store = await temporaryStore(t), r = makeRecord(); await store.transaction(s => { s.records.push(r); });
  let calls = 0;
  const key = "FAKE-SECRET-NOT-REAL";
  const fetchImpl = async (url, init) => {
    calls++; assert.equal(url, "https://api.x.ai/v1/responses"); assert.equal(init.headers.Authorization, "Bearer " + key);
    assert.equal(JSON.parse(init.body).text.format.name, "patent_portfolio_classification");
    return new Response(JSON.stringify({ model: DEFAULT_MODEL, output_text: JSON.stringify(fakeOutput(r)), usage: { input_tokens: 330, output_tokens: 180, cost_in_usd_ticks: 6543210 } }), { status: 200 });
  };
  const bench = new PilotBenchmark(store, fetchImpl, () => key);
  const first = await bench.run(r.id, DEFAULT_MODEL, { taskBudgetUsd: 1 });
  const second = await bench.run(r.id, DEFAULT_MODEL, { taskBudgetUsd: 1 });
  assert.equal(calls, 1); assert.equal(second.cached, true); assert.equal(first.status, "needs_review");
  assert.equal(first.costKind, "actual"); assert.equal(first.apiCostUsd, 0.000654321);
  assert.equal((await store.read()).records[0].classification.validationStatus, "needs_review");
  assert.ok(!JSON.stringify(await store.read()).includes(key));
});

test("Gold is independent and benchmark accuracy is unavailable without it", async t => {
  const store = await temporaryStore(t), r = makeRecord(); await store.transaction(s => { s.records.push(r); });
  const service = createPilotService({ path: store.path, fetchImpl: noExternal });
  assert.deepEqual(summarizeBenchmark(await store.read()), []);
  await service.handle("gold", { recordId: r.id, label: "Battery Management", reviewer: "Human A" });
  await service.handle("classify", { recordId: r.id, model: DEFAULT_MODEL, mock: true });
  await assert.rejects(service.handle("gold", { recordId: r.id, label: "Other", reviewer: "Human B" }), /模型运行前/);
  assert.equal((await store.read()).gold[r.id].label, "Battery Management");
});

test("batch budget allows already cached tasks without reserving a second paid request", async t => {
  const store = await temporaryStore(t), r = makeRecord(); await store.transaction(s => { s.records.push(r); });
  let calls = 0;
  const service = createPilotService({ path: store.path, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ model: DEFAULT_MODEL, output_text: JSON.stringify(fakeOutput(r)), usage: { input_tokens: 100, output_tokens: 100, cost_in_usd_ticks: 1000000 } }), { status: 200 }); } });
  const priorKey = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = "FAKE-TEST-ONLY";
  try {
    await service.handle("classify", { recordId: r.id, model: DEFAULT_MODEL, taskBudgetUsd: 1 });
    const batch = await service.handle("batch", { recordIds: [r.id], models: [DEFAULT_MODEL], mock: false, batchBudgetUsd: 0, taskBudgetUsd: 0 });
    assert.equal(batch.runs.length, 1); assert.equal(batch.runs[0].cached, true); assert.equal(calls, 1);
  } finally { if (priorKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = priorKey; }
});

test("a completed 20-record public sample is frozen and report does not invent accuracy", async t => {
  const store = await temporaryStore(t);
  await store.transaction(s => { for (let i = 1; i <= 20; i++) s.records.push(normalizePatent({ publicationNumber: "EP3633495A" + i, sampleSetVersion: "epo-smart-terminal-v1", title: "Battery" }, { sourceVerified: true, sourceKind: "epo_index_metadata" })); });
  const service = createPilotService({ path: store.path, retrievalFetchImpl: noExternal });
  const sample = await service.handle("collect-sample", {});
  const report = await service.handle("report", {});
  assert.equal(sample.frozen, true); assert.equal(sample.added, 0);
  assert.equal(report.sampleSet.recordIds.length, 20);
  assert.equal(report.ruleBaseline.goldEvaluated, 0);
  assert.equal(report.ruleBaseline.accuracy, null);
  assert.deepEqual(report.benchmark, []);
});

test("Pilot HTTP loop serves UI and completes import → mock → report without paid traffic", async t => {
  const store = await temporaryStore(t), server = createApp({ pilotPath: store.path, fetchImpl: noExternal, retrievalFetchImpl: noExternal });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = "http://127.0.0.1:" + server.address().port;
  const call = async (route, body) => { const response = await fetch(base + "/api/pilot/" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Patent-Client": "workbench" }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
  assert.equal((await fetch(base + "/pilot")).status, 200);
  assert.equal((await fetch(base + "/pilot.js")).status, 200);
  assert.equal((await call("import", { format: "json", text: JSON.stringify([{ publicationNumber: "EP3633495A1", abstract: "Battery controller", title: "Cell controller" }]) })).data.added, 1);
  const state = (await call("state", {})).data;
  const id = state.records[0].id;
  assert.equal(state.records[0].fields.abstract.status, "imported_unverified");
  assert.equal((await call("classify", { recordId: id, model: DEFAULT_MODEL, mock: true })).data.mode, "mock");
  assert.equal((await call("dashboard", {})).data.total, 1);
  assert.equal((await call("report", {})).data.runs.length, 1);
  assert.equal((await call("import", { format: "json", text: JSON.stringify([{ publicationNumber: "EP3633495A1" }]) })).data.duplicates, 1);
  assert.equal((await call("batch", { recordIds: [id], models: [DEFAULT_MODEL], mock: false, batchBudgetUsd: 0 })).status, 400);
});
