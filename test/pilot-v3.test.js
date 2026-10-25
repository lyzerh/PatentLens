import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { PilotStore, normalizePatent } from "../src/pilot/records.ts";
import { createPilotService } from "../src/pilot/service.ts";
import { CANDIDATES, SIBLING_SOURCES, PRODUCT_CATEGORIES, ensureV3, inputHash, mapFreeform, ruleOnly, freezeSuccessorDataset, freezeSupplementDataset, validateGold, freeformPrompt } from "../src/pilot/value-data.ts";
import { evaluateVariant } from "../src/pilot/value-metrics.ts";
import { sourceAudit, sourceFailure, supplementSource, readinessReport, generateGoldCandidates } from "../src/pilot/readiness.ts";
import { classificationPrompt } from "../src/pilot/classification.ts";
import { createApp } from "../src/server.js";
import { createValueService } from "../src/pilot/value-service.ts";
import { mockClassification } from "../src/pilot/classification.ts";

async function setup(t, fetchImpl = async () => { throw new Error("unexpected external request"); }) {
  const parent = join(process.cwd(), "data"); await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, "v3-test-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PilotStore(join(dir, "state.json"));
  await store.transaction(s => { for (const c of CANDIDATES) s.records.push(normalizePatent({ publicationNumber: c.publicationNumber, title: `${c.theme} system`, abstract: `A ${c.theme} system includes a controller and sensor.`, sourceUrl: "https://data.epo.org/example" }, { sourceVerified: true, sourceKind: "test_fixture" })); });
  return { store, service: createPilotService({ path: store.path, fetchImpl, retrievalFetchImpl: fetchImpl }) };
}
test("v0.3 fixes 10 records and hashes frozen input; no missing source is invented", async t => {
  const {store, service}=await setup(t); const preview=await service.handle("v3-state",{});
  assert.equal(preview.preview.length,10);assert.equal(preview.dataset,null);
  const ds=await service.handle("v3-freeze-dataset",{});assert.equal(ds.entries.length,10);
  assert.equal(ds.entries[0].inputHash,inputHash(ds.entries[0].snapshot));
  assert.equal(ds.entries.filter(e=>e.completeness.cpc).length,0);
  assert.deepEqual(await service.handle("v3-freeze-dataset",{}),ds);
  await assert.rejects(service.handle("v3-enrich",{publicationNumber:CANDIDATES[0].publicationNumber}),/已冻结/);
  const report=await service.handle("v3-report",{format:"json"});
  assert.equal(report.report.realModelBenchmarkExecuted,false);
  assert.equal(report.report.benchmarkStatus,"Real model benchmark not executed.");
  assert.equal(report.report.evaluation.variants[0].accuracy.denominator,0);
  assert.match((await service.handle("v3-report",{format:"markdown"})).text,/Real model benchmark not executed/);
  assert.equal((await store.read()).records.length,10);
});
test("Gold requires exact source quote; freeze requires independent human entries",async t=>{
  const {service}=await setup(t);const ds=await service.handle("v3-freeze-dataset",{}),id=ds.entries[0].recordId;
  await assert.rejects(service.handle("v3-gold",{recordId:id,status:"human_verified",technicalDomain:"Battery Management",reviewer:"Analyst",rationale:"Based on abstract",potentialProductCategories:[],supportingEvidence:[{section:"abstract",sourceSpan:"fabricated"}]}),/引文/);
  await service.handle("v3-gold",{recordId:id,status:"provisional",technicalDomain:"Battery Management",reviewer:"Analyst",rationale:"Pending",potentialProductCategories:[],supportingEvidence:[]});
  await assert.rejects(service.handle("v3-freeze-gold",{}),/10条/);
  const gold=await service.handle("v3-gold",{recordId:id,status:"human_verified",technicalDomain:"Battery Management",reviewer:"Analyst",rationale:"Cannot confidently classify",ambiguousOrUncertain:true,potentialProductCategories:[],supportingEvidence:[]});
  assert.equal(gold.verifiedCommercialImplementation,"unknown");
});
test("B free text mapping is strict; D reuses C response and excludes Mock",async t=>{
  const {store,service}=await setup(t);const ds=await service.handle("v3-freeze-dataset",{});
  assert.equal(mapFreeform("technical domain: Battery Management").domain,"Battery Management");
  assert.equal(mapFreeform("Battery Management and Thermal Management").error,"MULTIPLE_DOMAIN_LABELS");
  const entry=ds.entries[0];assert.equal(ruleOnly(entry).basis,"title_abstract_keyword");
  const mock=await service.handle("v3-run",{recordId:entry.recordId,variant:"C",model:"grok-4.3",mock:true});assert.equal(mock.mode,"mock");
  assert.equal((await service.handle("v3-state",{})).evaluation.variants.length,1);
  await assert.rejects(service.handle("v3-run",{recordId:entry.recordId,variant:"C",model:"grok-4.3",authorized:true}),/Gold/);
  const v3=ensureV3(await store.read());
  v3.runs.push({...mock,mode:"api",taskId:"controlled-api",apiCostUsd:.004,costKind:"actual",mappedDomain:"Battery Management"});
  await store.transaction(s=>{s.pilotV3=v3;s.pilotV3.goldFrozenAt="2026-10-23T00:00:00Z";s.pilotV3.gold[entry.recordId]={technicalDomain:"Battery Management",technicalSubdomain:null,primaryFunction:null,potentialProductCategories:[],supportingEvidence:[],ambiguousOrUncertain:false,verifiedCommercialImplementation:"unknown",reviewer:"Test",rationale:"Fixture",reviewedAt:"2026-10-23T00:00:00Z",status:"human_verified",version:"fixture"}});
  const latest=await store.read(),c=evaluateVariant(latest,"C","grok-4.3"),d=evaluateVariant(latest,"D","grok-4.3");
  assert.equal(c.rows[0].sharedRunTaskId,d.rows[0].sharedRunTaskId);assert.equal(d.totalCostUsd,c.totalCostUsd);assert.equal(d.rows[0].costUsd,0);
  assert.equal(d.accuracy.denominator,1);assert.equal(d.accuracy.numerator,0);assert.equal(d.coverage.denominator,10);
});
test("v0.3 HTTP page and API work offline",async t=>{
  const {store}=await setup(t);const server=createApp({pilotPath:store.path,fetchImpl:async()=>{throw new Error("no external")}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const page=await fetch(base+"/pilot-v3");assert.equal(page.status,200);const html=await page.text();assert.match(html,/验证 LLM 的增量价值/);assert.match(html,/id="run-batch"/);
  const js=await fetch(base+"/pilot-v3.js");assert.equal(js.status,200);
  const taxonomy=await fetch(base+"/pilot-v3-taxonomy");assert.equal(taxonomy.status,200);assert.match(await taxonomy.text(),/技术分类规范/);
  const state=await fetch(base+"/api/pilot/v3-state",{method:"POST",headers:{"X-Patent-Client":"workbench","Content-Type":"application/json"},body:"{}"});assert.equal(state.status,200);assert.equal((await state.json()).preview.length,10);
  const quality=await fetch(base+"/api/pilot/v3-data-report",{method:"POST",headers:{"X-Patent-Client":"workbench","Content-Type":"application/json"},body:"{}"});assert.equal(quality.status,200);assert.equal((await quality.json()).report.totalDocuments,0);
});
test("fake paid v0.3 flow requires frozen human Gold, honors authorization and shares C with D",async t=>{
  const {store,service}=await setup(t);const ds=await service.handle("v3-freeze-dataset",{});
  for(const e of ds.entries) await service.handle("v3-gold",{recordId:e.recordId,status:"human_verified",technicalDomain:"Unknown",reviewer:"Independent test analyst",rationale:"Uncertain fixture for transport test",ambiguousOrUncertain:true,potentialProductCategories:[],supportingEvidence:[]});
  await service.handle("v3-freeze-gold",{});
  let calls=0;const key="FAKE-LOCAL-KEY";
  const fakeFetch=async(url,init)=>{calls++;assert.equal(url,"https://api.x.ai/v1/responses");assert.equal(init.headers.Authorization,"Bearer "+key);assert.equal(JSON.parse(init.body).text.format.name,"patent_portfolio_classification");
    return new Response(JSON.stringify({model:"grok-4.3",output_text:JSON.stringify(mockClassification(ds.entries[0].snapshot)),usage:{input_tokens:300,output_tokens:150,cost_in_usd_ticks:1234567}}),{status:200});};
  const v3=createValueService(store,fakeFetch,async()=>{throw new Error("no EPO fetch")},()=>key);
  const task={recordId:ds.entries[0].recordId,variant:"C",model:"grok-4.3",maxOutputTokens:1200};
  await assert.rejects(v3.handle("run",task),/授权/);assert.equal(calls,0);
  const estimate=await v3.handle("estimate",{...task,recordIds:[task.recordId]});assert.ok(estimate.reservedUsd>0);
  const first=await v3.handle("run",{...task,authorized:true});assert.equal(first.costKind,"actual");assert.equal(first.apiCostUsd,.0001234567);
  const cached=await v3.handle("run",{...task,authorized:true});assert.equal(cached.cached,true);assert.equal(calls,1);
  const evaluation=await v3.handle("state",{});assert.equal(evaluation.evaluation.variants.length,4);
  const c=evaluation.evaluation.variants.find(x=>x.variant==="C"),d=evaluation.evaluation.variants.find(x=>x.variant==="D");
  assert.equal(c.rows[0].sharedRunTaskId,d.rows[0].sharedRunTaskId);assert.equal(d.costKind,"shared_with_C_no_new_call");
  assert.ok(!JSON.stringify(await store.read()).includes(key));
});
test("v0.3 blocks new requests with unknown prior cost or exhausted reservation",async t=>{
  const {store,service}=await setup(t);const ds=await service.handle("v3-freeze-dataset",{});
  await store.transaction(s=>{const v=ensureV3(s);v.goldFrozenAt="2026-10-23T00:00:00Z";v.runs.push({taskId:"unknown",datasetVersion:ds.version,recordId:ds.entries[1].recordId,publicationNumber:ds.entries[1].publicationNumber,inputHash:ds.entries[1].inputHash,variant:"B",mode:"api",model:"grok-4.3",promptVersion:"test",startedAt:"2026-10-23T00:00:00Z",latencyMs:1,inputTokens:null,outputTokens:null,cachedTokens:null,reasoningTokens:null,apiCostUsd:null,costKind:"unknown",retries:0,errorType:"HTTP_503",mappingError:null,rawText:null,mappedDomain:null,output:null,validation:null,cached:false});});
  let calls=0;const v3=createValueService(store,async()=>{calls++;throw new Error("unexpected")},fetch,()=>"fake");
  await assert.rejects(v3.handle("run",{recordId:ds.entries[0].recordId,variant:"B",model:"grok-4.3",authorized:true}),/费用未知/);assert.equal(calls,0);
  await store.transaction(s=>{const v=ensureV3(s);v.runs=[];v.reservations.push({taskId:"reserved",reservedUsd:5,startedAt:"2026-10-23T00:00:00Z"});});
  await assert.rejects(v3.handle("run",{recordId:ds.entries[0].recordId,variant:"B",model:"grok-4.3",authorized:true}),/预算预留/);assert.equal(calls,0);
});
test("D reports accepted-only accuracy together with rejection, false acceptance and false rejection",async t=>{
  const {store,service}=await setup(t);const ds=await service.handle("v3-freeze-dataset",{});
  const [one,two]=ds.entries;
  await store.transaction(s=>{const v=ensureV3(s);v.goldFrozenAt="2026-10-23T00:00:00Z";
    for(const e of [one,two])v.gold[e.recordId]={technicalDomain:"Battery Management",technicalSubdomain:null,primaryFunction:null,potentialProductCategories:[],supportingEvidence:[],ambiguousOrUncertain:false,verifiedCommercialImplementation:"unknown",reviewer:"Fixture",rationale:"Controlled metrics fixture",reviewedAt:"2026-10-23T00:00:00Z",status:"human_verified",version:"fixture"};
    for(const [i,e] of [one,two].entries()){const taskId="metric-"+i;v.runs.push({taskId,datasetVersion:ds.version,recordId:e.recordId,publicationNumber:e.publicationNumber,inputHash:e.inputHash,variant:"C",mode:"api",model:"grok-4.3",promptVersion:"fixture",startedAt:"2026-10-23T00:00:00Z",latencyMs:100+i*100,inputTokens:100,outputTokens:100,cachedTokens:0,reasoningTokens:null,apiCostUsd:.001,costKind:"actual",retries:0,errorType:null,mappingError:null,rawText:"fixture",mappedDomain:i?"Battery Management":"Thermal Management",output:null,validation:{schemaValid:true,evidenceValid:i===0,status:i?"rejected":"needs_review",errors:[],spans:[]},cached:false});
      v.assessments[taskId]={model:"grok-4.3",recordId:e.recordId,variant:"C",correctDomain:i===1,functionCorrect:null,productCategoryCorrect:null,evidenceSupports:i===1,validatorShouldAccept:i===1,reviewer:"Fixture",notes:"Independent synthetic judgment",reviewedAt:"2026-10-23T00:00:00Z"};}
  });
  const d=evaluateVariant(await store.read(),"D","grok-4.3");
  assert.deepEqual([d.falseAcceptance.numerator,d.falseAcceptance.denominator,d.falseRejection.numerator,d.falseRejection.denominator],[1,1,1,1]);
  assert.deepEqual([d.acceptedAccuracy.numerator,d.acceptedAccuracy.denominator,d.rejectedCount,d.coverage.denominator],[0,1,1,10]);
});
test("cross-source audit retains conflicting original and records both provenance values",async t=>{
  const {store,service}=await setup(t);const frozen=await service.handle("v3-freeze-dataset",{}),entry=frozen.entries[0];
  const audit=await store.transaction(s=>sourceAudit(s,entry.publicationNumber,{publicationNumber:entry.publicationNumber,title:"A different official title",abstract:entry.snapshot.abstract,cpc:["H01M 10/613"],ipc:["H01M 10/613"],assignee:"Acme",sourceUrl:entry.sourceUrl,fetchedAt:"2026-10-24T01:00:00Z",claims:[],classificationDiagnostics:{cpc:{rawCount:1,unparsed:[]},ipc:{rawCount:1,unparsed:[]}}}));
  assert.equal(audit.fields.title.conflictFlag,true);assert.equal(audit.fields.title.status,"needs_review");assert.equal(audit.fields.title.observations.length,2);
  const state=await store.read(),live=state.records.find(r=>r.id===entry.recordId);assert.equal(live.title,entry.snapshot.title);assert.deepEqual(live.cpc,["H01M 10/613"]);
  assert.equal(frozen.entries[0].snapshot.cpc.length,0);assert.equal(audit.fields.independentClaims.missingReason,"source_not_provided");
  assert.equal(readinessReport(state,false).conflictingFields.count,1);
});
test("supplement changes hash only in a new dataset version and verifies sibling identity",async t=>{
  const {store,service}=await setup(t);const original=await service.handle("v3-freeze-dataset",{});
  await store.transaction(s=>{for(const c of CANDIDATES){const record=s.records.find(r=>r.publicationNumber===c.publicationNumber);sourceAudit(s,c.publicationNumber,{publicationNumber:c.publicationNumber,title:record.title,abstract:record.abstract,cpc:["H01M 10/613"],ipc:["H01M 10/613"],sourceUrl:record.sourceUrl,fetchedAt:"2026-10-24T01:00:00Z",claims:[]})}});
  const intermediate=await store.transaction(s=>freezeSuccessorDataset(s));assert.equal(intermediate.parentVersion,original.version);
  await assert.rejects(store.transaction(s=>supplementSource(s,"EP3836293B1","EP1111111A1",{publicationNumber:"EP1111111A1"})),/不匹配/);
  await store.transaction(s=>{for(const [target,sibling] of Object.entries(SIBLING_SOURCES))supplementSource(s,target,sibling,{publicationNumber:sibling,abstract:"A full application abstract from the earlier publication.",claims:[{number:"1",text:"A first independent claim in the application publication."}],sourceUrl:"https://data.epo.org/sibling.xml",fetchedAt:"2026-10-24T02:00:00Z"})});
  const final=await store.transaction(s=>freezeSupplementDataset(s));assert.equal(final.parentVersion,intermediate.version);assert.equal(final.entries.length,10);
  assert.notEqual(final.entries[0].inputHash,original.entries[0].inputHash);
  const stored=await store.read();assert.equal(stored.pilotV3.datasetHistory.length,2);assert.equal(stored.pilotV3.datasetHistory[0].entries[0].inputHash,original.entries[0].inputHash);
  const report=readinessReport(stored,false);assert.equal(report.before.version,original.version);assert.equal(report.after.version,final.version);assert.equal(report.stages.length,3);
});
test("candidate remains provisional until independent human review; taxonomy and common input are enforced",async t=>{
  const {store,service}=await setup(t);const ds=await service.handle("v3-freeze-dataset",{});
  const candidates=await store.transaction(s=>generateGoldCandidates(s));assert.equal(Object.keys(candidates).length,10);assert.equal(Object.keys((await store.read()).pilotV3.gold).length,0);
  const entry=ds.entries[0],candidate=candidates[entry.recordId];assert.ok(["provisional","needs_review"].includes(candidate.status));
  for(const section of [entry.snapshot.title,entry.snapshot.abstract,entry.snapshot.independentClaims.join("\n\n")])if(section){assert.ok(freeformPrompt(entry).includes(section));assert.ok(classificationPrompt(entry.snapshot).includes(section.replaceAll('"','\\"')));}
  assert.ok(PRODUCT_CATEGORIES.includes("Unknown"));
  assert.throws(()=>validateGold(entry,{recordId:entry.recordId,status:"human_verified",technicalDomain:"Battery Management",reviewer:"Human",rationale:"Reason",potentialProductCategories:["Actual shipped product"],supportingEvidence:[{section:"title",sourceSpan:entry.snapshot.title}]}),/产品类别/);
  const reviewed=await service.handle("v3-gold",{recordId:entry.recordId,status:"human_verified",technicalDomain:"Battery Management",reviewer:"Human",rationale:"Independently checked title",potentialProductCategories:["Unknown"],supportingEvidence:[{section:"title",sourceSpan:entry.snapshot.title}]});assert.equal(reviewed.status,"human_verified");assert.equal(reviewed.verifiedCommercialImplementation,"unknown");
});
test("missing reason distinguishes parser failure, identifier mismatch and retrieval failure",async t=>{
  const {store,service}=await setup(t);await service.handle("v3-freeze-dataset",{});
  const first=CANDIDATES[0].publicationNumber,second=CANDIDATES[1].publicationNumber;
  const parser=await store.transaction(s=>sourceAudit(s,first,{publicationNumber:first,title:s.records.find(r=>r.publicationNumber===first).title,cpc:[],ipc:[],abstract:null,claims:[],sourceUrl:"https://data.epo.org/example",classificationDiagnostics:{cpc:{rawCount:1,unparsed:["BAD"]},ipc:{rawCount:0,unparsed:[]}}}));
  assert.equal(parser.fields.cpc.missingReason,"parser_failed");assert.equal(parser.fields.ipc.missingReason,"source_not_provided");
  const mismatch=await store.transaction(s=>sourceFailure(s,second,{code:"EPO_DOCUMENT_MISMATCH"}));
  assert.equal(mismatch.fields.cpc.missingReason,"identifier_mismatch");
  const failed=await store.transaction(s=>sourceFailure(s,second,{code:"EPO_HTTP_503"}));
  assert.equal(failed.fields.cpc.missingReason,"retrieval_failed");
});
test("offline A/B/C/D smoke uses one frozen input per record and cannot create real benchmark",async t=>{
  let calls=0;const {store,service}=await setup(t,async()=>{calls++;throw new Error("network must not run")});const ds=await service.handle("v3-freeze-dataset",{});
  const result=await service.handle("v3-mock-smoke",{});assert.equal(result.mode,"mock");assert.equal(result.rows.length,10);assert.equal(result.realModelBenchmarkExecuted,false);
  for(const [i,row] of result.rows.entries()){assert.equal(row.inputHash,ds.entries[i].inputHash);assert.equal(row.D.reusesC,true);assert.equal(row.D.validatorStatus,row.C.status);}
  assert.equal(calls,0);assert.equal((await store.read()).pilotV3.runs.length,0);
});
