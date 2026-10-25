import { writeFile } from "node:fs/promises";
import { searchPatents, getPatent } from "../src/retrieval.js";
import { createRetrievalTransport, loadRetrievalNetwork } from "../src/network.js";
import { createThermalDocument, freezeThermalDataset } from "../src/pilot/thermal.ts";

// Fixed candidate registry from targeted patent discovery. An ID is not an inclusion decision.
// The official XML is fetched and checked before any document enters the frozen input.
const ids = [
  "EP3149425B1","EP4761489A1","EP4231797A1","EP3976726B1","EP4766054A1",
  "EP1993337B1","EP1739844A2","EP2567575B1","EP2802128B1","EP4075113A1",
  "EP2661660B1","EP1026571A2","EP4498205A1","EP0767415A2","EP4697879A1",
  "EP2262354A1","EP3461248A1","EP4476289B1","EP4464131B1","EP3209155A1",
  "EP4015272B1","EP4793571A3","EP4823254A1","EP4822824A1"
];
const queries = ["thermal", "cooling", "heatpipe", "smartphone", "wearable", "graphite", "fan"];
const transport = createRetrievalTransport(await loadRetrievalNetwork());
const searchLog = [], candidates = [], entries = [];
try {
  for (const query of queries) {
    const executedAt = new Date().toISOString();
    try { const result = await searchPatents({ source:"epo", query, page:0 }, { fetchImpl:transport.fetchImpl });
      searchLog.push({query,source:"EPO linked-data title/abstract first page",executedAt,returnedCount:result.records.length,hasNext:result.hasNext,error:null});
    } catch (error) { searchLog.push({query,source:"EPO linked-data title/abstract first page",executedAt,returnedCount:0,hasNext:false,error:String(error.code??error.message??"SEARCH_FAILED")}); }
  }
  for (const id of ids) {
    try {
      const patent = await getPatent({source:"epo",publicationNumber:id},{fetchImpl:transport.fetchImpl});
      if (patent.publicationNumber !== id) throw new Error("IDENTIFIER_MISMATCH");
      const doc = createThermalDocument(patent,["targeted_public_patent_discovery", ...queries.filter(q=>(patent.title??"").toLowerCase().includes(q))]);
      const hasReviewableText = Boolean(doc.title && (doc.abstract || doc.independentClaims.length || doc.description));
      if (!hasReviewableText) { candidates.push({publicationNumber:id,discoveryQueries:doc.discoveryQueries,retrievalStatus:"failed",reason:"source_not_provided_reviewable_text"}); continue; }
      entries.push(doc); candidates.push({publicationNumber:id,discoveryQueries:doc.discoveryQueries,retrievalStatus:"ok",reason:null});
      process.stdout.write(JSON.stringify({id,scope:doc.scope,technology:doc.primaryTechnologyCategory,product:doc.potentialProductApplication,claim:doc.independentClaims.length})+"\n");
    } catch (error) { const reason=String(error.code??error.message??"RETRIEVAL_FAILED"); candidates.push({publicationNumber:id,discoveryQueries:["targeted_public_patent_discovery"],retrievalStatus:"failed",reason});process.stdout.write(JSON.stringify({id,error:reason})+"\n"); }
  }
  const dataset = freezeThermalDataset(entries,searchLog,candidates);
  const path = new URL("../data/smart-device-thermal-v1.json",import.meta.url);
  await writeFile(path,JSON.stringify(dataset,null,2),{flag:"wx"});
  process.stdout.write(JSON.stringify({frozen:dataset.version,count:entries.length,hash:dataset.datasetHash,candidates:candidates.length,searchLog})+"\n");
} finally { await transport.close(); }
