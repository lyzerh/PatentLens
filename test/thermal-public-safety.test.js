import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createThermalDocument, freezeThermalDataset } from "../src/pilot/thermal.ts";
import { createThermalSmoke } from "../src/pilot/thermal-smoke.ts";

// Entirely synthetic text and Mock transport. These IDs exercise the fixed-sample gate;
// no original patent text, historical response, private file, or real Key is used.
const ids = ["EP3149425B1", "EP4498205A1", "EP4761489A1", "EP4015272B1", "EP4476289B1"];
const documents = ids.map((id) => {
  const match = id.match(/^EP(\d+)([A-Z]\d+)$/);
  return createThermalDocument({
    publicationNumber: id,
    title: "Synthetic cooling controller",
    abstract: "Synthetic test material for a cooling controller.",
    description: "Synthetic description: a controller adjusts cooling in a portable device.",
    claims: [{ number: "1", text: "A synthetic cooling controller comprising a temperature sensor." }],
    sourceUrl: `https://data.epo.org/publication-server/rest/v1.2/patents/EP${match[1]}NW${match[2]}/document.xml`,
    fetchedAt: "2026-01-01T00:00:00.000Z"
  }, ["synthetic_mock_fixture"]);
});
const dataset = freezeThermalDataset(documents, [], [], "synthetic-public-safety-fixture");
const modelList = new Response(JSON.stringify({ data: [{ id: "grok-4.3" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
const scratch = join(process.cwd(), "data");
const freshDir = async (prefix) => { await mkdir(scratch, { recursive: true }); return mkdtemp(join(scratch, prefix)); };

test("public synthetic preflight and absent authorization never make a paid request", async () => {
  const dir = await freshDir("patentlens-public-safety-");
  let modelChecks = 0, paid = 0;
  const service = createThermalSmoke({ path: join(dir, "smoke.json"), legacyPath: join(dir, "legacy.json"), getKey: () => "synthetic-mock-key", fetchImpl: async (url) => {
    if (String(url).endsWith("/models")) { modelChecks++; return modelList.clone(); }
    paid++; throw new Error("Public preflight must not reach generation");
  } });
  try {
    assert.equal((await service.publicState(dataset)).runs.length, 0);
    await assert.rejects(service.run(dataset, { confirmed: true, publicationNumber: "EP4015272B1" }), /一次性执行授权无效/);
    const quote = await service.preflight(dataset, "EP4015272B1");
    assert.equal(quote.requiresUserConfirmation, true);
    assert.equal(quote.model, "grok-4.3");
    assert.ok(quote.reservedUsd <= .10);
    assert.equal(modelChecks, 1);
    assert.equal(paid, 0);
    await assert.rejects(service.run(dataset, { quoteId: quote.quoteId, confirmed: true }), /一次性执行授权无效/);
    assert.equal(paid, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("public synthetic one-use grant rejects replay before another Mock Provider call", async () => {
  const dir = await freshDir("patentlens-public-replay-");
  let paid = 0;
  const doc = documents.find((item) => item.publicationNumber === "EP4015272B1");
  const output = { industryScope: doc.scope, primaryTechnologyCategory: doc.primaryTechnologyCategory,
    secondaryTechnologyCategories: doc.secondaryTechnologyCategories, productApplication: doc.potentialProductApplication,
    potentialProductApplication: doc.potentialProductApplication, technicalRelevance: doc.technicalRelevance,
    verifiedCommercialImplementation: "unknown", evidence: [doc.supportingSourceSpan[0]] };
  const service = createThermalSmoke({ path: join(dir, "smoke.json"), legacyPath: join(dir, "legacy.json"), getKey: () => "synthetic-mock-key", fetchImpl: async (url) => {
    if (String(url).endsWith("/models")) return modelList.clone();
    paid++;
    return new Response(JSON.stringify({ model: "grok-4.3", status: "completed", usage: { input_tokens: 100, output_tokens: 100 },
      output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  } });
  try {
    const quote = await service.preflight(dataset, "EP4015272B1");
    const grant = await service.authorize(dataset, { quoteId: quote.quoteId, publicationNumber: quote.publicationNumber });
    const run = await service.run(dataset, grant);
    assert.equal(run.kind, "engineering_smoke_test");
    assert.equal(paid, 1);
    await assert.rejects(service.run(dataset, grant), /一次性执行授权无效/);
    await assert.rejects(service.preflight(dataset, "EP4015272B1"), /禁止重复/);
    assert.equal(paid, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
