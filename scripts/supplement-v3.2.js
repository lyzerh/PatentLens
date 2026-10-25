import { createPilotService } from "../src/pilot/service.ts";
import { SIBLING_SOURCES, SUCCESSOR_DATASET_VERSION, SUPPLEMENT_DATASET_VERSION } from "../src/pilot/value-data.ts";
import { createRetrievalTransport, loadRetrievalNetwork } from "../src/network.js";

const transport = createRetrievalTransport(await loadRetrievalNetwork());
const service = createPilotService({ retrievalFetchImpl: transport.fetchImpl });
try {
  const before = await service.handle("v3-state",{});
  if (before.dataset?.version === SUPPLEMENT_DATASET_VERSION) process.stdout.write(JSON.stringify({ alreadyPrepared:true, version:before.dataset.version })+"\n");
  else {
    if (before.dataset?.version !== SUCCESSOR_DATASET_VERSION || Object.keys(before.gold).length || before.runs.some(r=>r.mode==="api")) throw new Error("当前版本、Gold 或真实运行记录不允许自动补充");
    const errors=[];
    for (const [publicationNumber,sibling] of Object.entries(SIBLING_SOURCES)) {
      try {const audit=await service.handle("v3-supplement-source",{publicationNumber});process.stdout.write(JSON.stringify({publicationNumber,sibling,status:"ok",abstract:audit.fields.abstract.observations.at(-1)?.value!==null,claims:audit.fields.independentClaims.observations.at(-1)?.value!==null,conflicts:Object.entries(audit.fields).filter(([,f])=>f.conflictFlag).map(([k])=>k)})+"\n");}
      catch(error){errors.push({publicationNumber,message:error instanceof Error?error.message:"source failed"});process.stdout.write(JSON.stringify({publicationNumber,error:errors.at(-1).message})+"\n");}
    }
    if (!errors.length) {
      const dataset=await service.handle("v3-freeze-supplement",{});const candidates=await service.handle("v3-gold-candidates",{});const report=(await service.handle("v3-data-report",{})).report;
      process.stdout.write(JSON.stringify({frozen:dataset.version,parent:dataset.parentVersion,candidates:Object.keys(candidates).length,coverage:Object.fromEntries(["abstract","independentClaims","cpc","ipc"].map(k=>[k,report.after.coverage[k].numerator])),conflicts:report.conflictingFields.count,missing:report.missingCriticalFields.count})+"\n");
    } else process.exitCode=1;
  }
} finally {await transport.close();}
