import { createPilotService } from "../src/pilot/service.ts";
import { CANDIDATES } from "../src/pilot/value-data.ts";
import { createRetrievalTransport, loadRetrievalNetwork } from "../src/network.js";

const transport = createRetrievalTransport(await loadRetrievalNetwork());
const service = createPilotService({ retrievalFetchImpl: transport.fetchImpl });
const errors = [];
try {
  const before = await service.handle("v3-state", {});
  if (before.dataset) { process.stdout.write(JSON.stringify({ alreadyFrozen: true, count: before.dataset.entries.length }) + "\n"); process.exitCode = 0; }
  else {
    for (const candidate of CANDIDATES) {
      try {
        const result = await service.handle("v3-enrich", { publicationNumber: candidate.publicationNumber });
        process.stdout.write(JSON.stringify({ publicationNumber: candidate.publicationNumber, abstract: result.abstract, independentClaims: result.independentClaims, cpc: result.cpc, ipc: result.ipc }) + "\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : "source failed";
        errors.push({ publicationNumber: candidate.publicationNumber, message });
        process.stdout.write(JSON.stringify({ publicationNumber: candidate.publicationNumber, error: message }) + "\n");
      }
    }
    const dataset = await service.handle("v3-freeze-dataset", {});
    process.stdout.write(JSON.stringify({ frozen: true, version: dataset.version, count: dataset.entries.length, abstract: dataset.entries.filter(e => e.completeness.abstract).length, independentClaims: dataset.entries.filter(e => e.completeness.independentClaims).length, cpc: dataset.entries.filter(e => e.completeness.cpc).length, ipc: dataset.entries.filter(e => e.completeness.ipc).length, errors }) + "\n");
  }
} finally { await transport.close(); }
