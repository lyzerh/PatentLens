import { createPilotService } from "../src/pilot/service.ts";
import { CANDIDATES, SUCCESSOR_DATASET_VERSION, SUPPLEMENT_DATASET_VERSION } from "../src/pilot/value-data.ts";
import { createRetrievalTransport, loadRetrievalNetwork } from "../src/network.js";

const transport = createRetrievalTransport(await loadRetrievalNetwork());
const service = createPilotService({ retrievalFetchImpl: transport.fetchImpl });
try {
  const before = await service.handle("v3-state", {});
  if ([SUCCESSOR_DATASET_VERSION, SUPPLEMENT_DATASET_VERSION].includes(before.dataset?.version)) {
    process.stdout.write(JSON.stringify({ alreadyPrepared: true, version: before.dataset.version }) + "\n");
  } else {
    if (!before.dataset || before.goldFrozenAt || Object.keys(before.gold).length || before.runs.some(r => r.mode === "api")) throw new Error("当前已有 Gold/真实模型或缺原始冻结集；需要人工迁移，不自动补取");
    const errors = [];
    for (const candidate of CANDIDATES) {
      try {
        const result = await service.handle("v3-audit-source", { publicationNumber: candidate.publicationNumber });
        process.stdout.write(JSON.stringify({ publicationNumber: candidate.publicationNumber, status: result.retrievalStatus, cpc: result.fields.cpc.observations.at(-1)?.value, ipc: result.fields.ipc.observations.at(-1)?.value, conflicts: Object.entries(result.fields).filter(([,field])=>field.conflictFlag).map(([name])=>name) }) + "\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : "source failed";
        errors.push({ publicationNumber: candidate.publicationNumber, message });
        process.stdout.write(JSON.stringify({ publicationNumber: candidate.publicationNumber, error: message }) + "\n");
      }
    }
    if (!errors.length) {
      const dataset = await service.handle("v3-freeze-successor", {});
      const candidates = await service.handle("v3-gold-candidates", {});
      const report = await service.handle("v3-data-report", { format: "json" });
      process.stdout.write(JSON.stringify({ frozen: dataset.version, parent: dataset.parentVersion, documents: dataset.entries.length, candidates: Object.keys(candidates).length,
        before: Object.fromEntries(["abstract","independentClaims","cpc","ipc"].map(k=>[k,report.report.before.coverage[k].numerator])),
        after: Object.fromEntries(["abstract","independentClaims","cpc","ipc"].map(k=>[k,report.report.after.coverage[k].numerator])), conflicts: report.report.conflictingFields.count, missing: report.report.missingCriticalFields.count }) + "\n");
    } else process.exitCode = 1;
  }
} finally { await transport.close(); }
