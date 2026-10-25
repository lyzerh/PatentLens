import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runPipeline } from "../src/pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = async (name) => JSON.parse(await readFile(path.join(here, "..", "fixtures", name), "utf8"));

test("good structured output still requires human review", async () => {
  const rawPatent = await load("raw-patent.json");
  const structuredOutput = await load("mock-llm-output.good.json");
  const result = runPipeline({ rawPatent, structuredOutput });

  assert.equal(result.status, "awaiting_human_review");
  assert.equal(result.metrics.totalErrorCount, 0);
});

test("bad structured output is rejected with typed errors", async () => {
  const rawPatent = await load("raw-patent.json");
  const structuredOutput = await load("mock-llm-output.bad.json");
  const result = runPipeline({ rawPatent, structuredOutput });
  const errorTypes = new Set(result.errors.map((error) => error.type));

  assert.equal(result.status, "needs_revision");
  assert.ok(errorTypes.has("CONFIDENCE_OUT_OF_RANGE"));
  assert.ok(errorTypes.has("EVIDENCE_NOT_GROUNDED"));
  assert.ok(errorTypes.has("EVIDENCE_REFERENCE_MISSING"));
});

test("evidence must be traceable to raw patent text", async () => {
  const rawPatent = await load("raw-patent.json");
  const structuredOutput = await load("mock-llm-output.good.json");
  structuredOutput.intelligence.evidence[0].originalText = "invented text";
  const result = runPipeline({ rawPatent, structuredOutput });

  assert.equal(result.status, "needs_revision");
  assert.equal(result.errors[0].type, "EVIDENCE_NOT_GROUNDED");
});
