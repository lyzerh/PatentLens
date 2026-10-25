import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { getPatent } from "../src/retrieval.js";
import { createRetrievalTransport, loadRetrievalNetwork } from "../src/network.js";
import { createThermalDocument, freezeThermalDataset } from "../src/pilot/thermal.ts";

// Explicit, no-key, no-LLM reconstruction from the public EPO source manifest.
// A fresh retrieval is a new snapshot; it cannot reproduce the private 2026-10-24 bytes.
const manifest = JSON.parse(await readFile(new URL("../samples/thermal-23-manifest.json", import.meta.url), "utf8"));
if (manifest.patents?.length !== 23) throw new Error("Expected 23 public source references");
const output = new URL("../data/thermal-public-rebuild.json", import.meta.url);
const transport = createRetrievalTransport(await loadRetrievalNetwork());
try {
  const entries = [];
  const candidates = [];
  for (const item of manifest.patents) {
    const patent = await getPatent({ source: "epo", publicationNumber: item.publicationNumber }, { fetchImpl: transport.fetchImpl });
    if (patent.publicationNumber !== item.publicationNumber || patent.sourceUrl !== item.sourceUrl) {
      throw new Error(`Source mismatch for ${item.publicationNumber}`);
    }
    const document = createThermalDocument(patent, ["public_source_manifest"]);
    if (!document.title || !(document.abstract || document.independentClaims.length || document.description)) {
      throw new Error(`Reviewable text unavailable for ${item.publicationNumber}`);
    }
    entries.push(document);
    candidates.push({ publicationNumber: item.publicationNumber, discoveryQueries: ["public_source_manifest"], retrievalStatus: "ok", reason: null });
    process.stdout.write(`Fetched ${item.publicationNumber} (${entries.length}/23)\n`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const version = `thermal-public-rebuild-${new Date().toISOString().slice(0, 10)}`;
  const dataset = freezeThermalDataset(entries, [], candidates, version);
  await mkdir(fileURLToPath(new URL("../data/", import.meta.url)), { recursive: true });
  await writeFile(output, JSON.stringify(dataset, null, 2), { flag: "wx" });
  process.stdout.write(`Saved new local snapshot: ${fileURLToPath(output)}\nDataset hash: ${dataset.datasetHash}\n`);
} finally {
  await transport.close();
}
