import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/server.js";
import { classifyThermal, createThermalDocument, evidenceIsExact, freezeThermalDataset, thermalPortfolio, validateFrozenThermalDataset } from "../src/pilot/thermal.ts";
import { evaluateThermal, mockFourArms, thermalInput, thermalPrompt, validateGoldReview, validateThermalOutput } from "../src/pilot/thermal-benchmark.ts";
import { createThermalService } from "../src/pilot/thermal-service.ts";
import { evaluateBaselines, experimentReport, fixedSample, referencePackets, reportMarkdown } from "../src/pilot/thermal-experiment.ts";

const datasetPath = new URL("../data/smart-device-thermal-v1.3.json",import.meta.url);
const dataset = JSON.parse(await readFile(datasetPath,"utf8"));
const sourceUrl="https://data.epo.org/publication-server/rest/v1.2/patents/EP1234567NWA1/document.xml";
const synthetic=(title,claim,description="")=>({publicationNumber:"EP1234567A1",title,abstract:"",description,claims:[{number:"1",text:claim}],cpc:["H05K 7/20"],ipc:["H05K 7/20"],sourceUrl,fetchedAt:"2026-10-24T00:00:00.000Z"});

test("independent smart-device scope rejects cross-industry heat without device evidence",()=>{
  const car=classifyThermal({title:"Vehicle battery cooling",independentClaims:["A cooling apparatus for an automobile battery"],sourceUrl});
  assert.equal(car.scope,"out_of_scope");assert.equal(car.potentialProductApplication[0],"Non-smart-device");
  const phone=classifyThermal({title:"Mobile phone heat dissipation",independentClaims:["A vapor chamber in a mobile phone"],sourceUrl});
  assert.equal(phone.scope,"in_scope");assert.equal(phone.detectedDeviceContext,"Smartphone");
  const boundary=classifyThermal({title:"Vapor chamber for electronic device",independentClaims:["A vapor chamber for an electronic device"],description:"An example smartphone may use this structure.",sourceUrl});
  assert.equal(boundary.scope,"boundary_case");
});
test("technology is multi-label, independent from product and never proves commercial use",()=>{
  const x=classifyThermal({title:"Laptop vapor chamber and graphene thermal interface",independentClaims:["A laptop having a vapor chamber and a graphene thermal interface material"],sourceUrl});
  assert.equal(x.primaryTechnologyCategory,"Passive Cooling Structure");assert.ok(x.secondaryTechnologyCategories.includes("Thermal Materials & Interfaces"));assert.deepEqual(x.potentialProductApplication,["Laptop"]);assert.equal(x.verifiedCommercialImplementation,"unknown");
});
test("official source material has stable content hash, exact spans and immutable input freeze",()=>{
  const a=createThermalDocument(synthetic("Mobile phone heat dissipation","A vapor chamber in a mobile phone"),["heat"]);
  const b=createThermalDocument(synthetic("Mobile phone heat dissipation","A heat pipe in a mobile phone"),["heat"]);
  assert.throws(()=>createThermalDocument({...synthetic("Mobile phone heat dissipation","A vapor chamber"),sourceUrl:"https://data.epo.org/publication-server/rest/v1.2/patents/EP7654321NWA1/document.xml"},[]),/编号及来源一致/);
  assert.notEqual(a.contentHash,b.contentHash);assert.ok(a.supportingSourceSpan.every(e=>evidenceIsExact(a,e)));
  const frozen=freezeThermalDataset([a],[],[]);validateFrozenThermalDataset(frozen);
  assert.throws(()=>freezeThermalDataset([a,a],[],[]),/去重/);
  frozen.entries[0].title="tampered";assert.throws(()=>validateFrozenThermalDataset(frozen),/哈希/);
});
test("actual thermal dataset is separate, source-verifiable and retains boundary negatives",()=>{
  validateFrozenThermalDataset(dataset);assert.equal(dataset.entries.length,23);assert.equal(dataset.entries.filter(e=>e.scope==="out_of_scope").length,3);
  assert.ok(dataset.entries.every(e=>e.sourceUrl.startsWith("https://data.epo.org/publication-server/")));
  assert.ok(dataset.entries.every(e=>e.verifiedCommercialImplementation==="unknown"));
  assert.equal(dataset.parentVersion,"smart-device-thermal-v1.2-2026-10-24");
});
test("Gold candidates do not become verified without human identity and exact frozen evidence",()=>{
  const d=dataset.entries[0],ev=d.supportingSourceSpan[0];assert.equal(dataset.goldCandidates[d.publicationNumber].status,"provisional_reference");
  const review={status:"verified_gold",industryScope:d.scope,primaryTechnologyCategory:d.primaryTechnologyCategory,secondaryTechnologyCategories:d.secondaryTechnologyCategories,productApplication:d.potentialProductApplication,technicalRelevance:d.technicalRelevance,verifiedCommercialImplementation:"unknown",evidence:[ev],reviewer:"Independent IP reviewer",rationale:"Checked claim 1 against category boundary"};
  const g=validateGoldReview(d,review,dataset.version);assert.equal(g.status,"verified_gold");assert.equal(g.contentHash,d.contentHash);
  assert.throws(()=>validateGoldReview(d,{...review,evidence:[{...ev,sourceSpan:"invented quote"}]},dataset.version),/精确证据/);
  assert.throws(()=>validateGoldReview(d,{...review,verifiedCommercialImplementation:"used in product"},dataset.version),/商业实施/);
});
test("strict structured validator blocks unsupported product implementation and invented evidence",()=>{
  const d=dataset.entries[0],base={industryScope:d.scope,primaryTechnologyCategory:d.primaryTechnologyCategory,secondaryTechnologyCategories:d.secondaryTechnologyCategories,productApplication:d.potentialProductApplication,technicalRelevance:true,potentialProductApplication:d.potentialProductApplication,verifiedCommercialImplementation:"unknown",evidence:[d.supportingSourceSpan[0]]};
  assert.equal(validateThermalOutput(d,base).accepted,true);
  assert.ok(validateThermalOutput(d,{...base,verifiedCommercialImplementation:"commercialized"}).errors.includes("UNSUPPORTED_IMPLEMENTATION_CLAIM"));
  assert.ok(validateThermalOutput(d,{...base,evidence:[{...base.evidence[0],sourceSpan:"false span"}]}).errors.includes("EVIDENCE_NOT_EXACT"));
});
test("A/B/C/D use identical frozen patent input; mock cannot score model accuracy",()=>{
  const d=dataset.entries[0],input=thermalInput(d),smoke=mockFourArms(dataset);
  assert.equal(smoke.rows.length,23);assert.equal(smoke.accuracy,"unavailable");assert.equal(smoke.realApiCalls,0);
  assert.ok(smoke.rows.every(r=>r.inputHash===r.B.inputHash&&r.inputHash===r.C.inputHash&&r.inputHash===r.D.inputHash&&r.D.reusesC));
  assert.ok(thermalPrompt(d,"B").includes(input.contentHash));assert.ok(thermalPrompt(d,"C").includes(input.contentHash));
});
test("portfolio counts are deterministic and all unverified accuracy denominators are unavailable",()=>{
  const p=thermalPortfolio(dataset),q=thermalPortfolio(dataset);assert.deepEqual(p,q);assert.equal(p.sampleSize,23);assert.equal(p.inScope+p.boundaryCases+p.outOfScopeExcluded+p.uncertain,23);
  const evaluation=evaluateThermal(dataset,{});assert.equal(evaluation.baselineA.thermalTechnologyAccuracy.value,null);assert.equal(evaluation.baselineA.inScopePrecision.value,null);assert.equal(evaluation.B,"unavailable");
});
test("review state is separate from frozen dataset and paid benchmark cannot start",async()=>{
  const scratchRoot=resolve("data"),dir=await mkdtemp(join(scratchRoot,"thermal-test-"));try{const rawBefore=await readFile(datasetPath,"utf8"),service=createThermalService({datasetPath:fileURLToPath(datasetPath),reviewPath:join(dir,"reviews.json"),smokePath:join(dir,"smoke.json")});const before=await service.handle("state",{});assert.equal(before.evaluation.verifiedGold,0);assert.equal(before.benchmark.paidEnabled,false);assert.equal((await service.handle("mock",{})).realApiCalls,0);
    const d=dataset.entries[0];await service.handle("review",{publicationNumber:d.publicationNumber,status:"verified_gold",industryScope:d.scope,primaryTechnologyCategory:d.primaryTechnologyCategory,secondaryTechnologyCategories:d.secondaryTechnologyCategories,productApplication:d.potentialProductApplication,technicalRelevance:d.technicalRelevance,verifiedCommercialImplementation:"unknown",evidence:[d.supportingSourceSpan[0]],reviewer:"IP reviewer",rationale:"Checked claim 1"});
    assert.equal((await service.handle("state",{})).evaluation.verifiedGold,1);assert.equal(await readFile(datasetPath,"utf8"),rawBefore);await assert.rejects(service.handle("freeze-gold",{}),/所有样本/);
  }finally{if(!resolve(dir).startsWith(scratchRoot+sep))throw new Error("unsafe scratch path");await rm(dir,{recursive:true,force:true});}
});
test("local HTTP serves thermal review UI and offline state without any provider call",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"patent-thermal-http-"));const app=createApp({fetchImpl:()=>{throw new Error("provider must not be called")},thermalDatasetPath:fileURLToPath(datasetPath),thermalReviewPath:join(dir,"reviews.json"),thermalSmokePath:join(dir,"smoke.json"),pilotPath:join(dir,"pilot.json")});
  await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${app.address().port}`;
  try{const page=await fetch(base+"/pilot-thermal");assert.equal(page.status,200);assert.match(await page.text(),/智能终端热管理/);const response=await fetch(base+"/api/thermal/state",{method:"POST",headers:{"Content-Type":"application/json","X-Patent-Client":"workbench"},body:"{}"});assert.equal(response.status,200);assert.equal((await response.json()).dataset.entries.length,23);}finally{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test("A1/A2/A3 separate code availability from classification and preserve no-Gold denominator",()=>{
  const b=evaluateBaselines(dataset,{});assert.equal(b.A1.applicable,12);assert.equal(b.A2.applicable,21);assert.equal(b.A3.applicable,23);
  assert.equal(b.A1.rows.find(x=>x.publicationNumber==="EP3149425B1").codeSource,null);
  assert.equal(b.A2.rows.find(x=>x.publicationNumber==="EP3149425B1").codeSource,"IPC");
  assert.equal(b.A2.rows.find(x=>x.publicationNumber==="EP1026571A2").classified,false);
  for(const x of Object.values(b)){assert.equal(x.classified+x.unclassified,23);assert.equal(x.verifiedComparison.value,null);}
});
test("reference packets and first-five lock source hashes without promoting provisional candidates",()=>{
  const packets=referencePackets(dataset),fixed=fixedSample(dataset);assert.equal(packets.length,23);assert.equal(fixed.length,5);
  assert.deepEqual(fixed.map(x=>x.scopeAtSelection),["in_scope","in_scope","boundary_case","out_of_scope","uncertain"]);
  assert.ok(packets.every(x=>x.humanGold===false&&x.reviewStatus!=="verified_gold"&&x.evidence.every(e=>e.sourceUrl===x.sourceUrl)));
  assert.ok(packets.find(x=>x.publicationNumber==="EP4793571A3").dispute.includes("Claim 1 缺失"));
});
test("offline report exports all sources and explicitly withholds validated accuracy",async()=>{
  const report=experimentReport(dataset,{}),md=reportMarkdown(report);assert.equal(report.patents.length,23);assert.equal(report.realApiCalls,0);assert.equal(report.validatedClassificationAccuracy,"unavailable");assert.match(md,/Real xAI benchmark not executed/);
  const dir=await mkdtemp(join(tmpdir(),"patent-thermal-report-")),app=createApp({fetchImpl:()=>{throw new Error("network prohibited")},thermalDatasetPath:fileURLToPath(datasetPath),thermalReviewPath:join(dir,"reviews.json"),thermalSmokePath:join(dir,"smoke.json")});await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
  try{const result=await fetch(`http://127.0.0.1:${app.address().port}/api/thermal/report`,{method:"POST",headers:{"Content-Type":"application/json","X-Patent-Client":"workbench"},body:"{}"});assert.equal(result.status,200);const body=await result.json();assert.equal(body.json.patents.length,23);assert.match(body.markdown,/Validated classification accuracy unavailable/);}finally{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test("fixed-five B/C price preflight flags suggested cap and makes no paid request",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"patent-thermal-estimate-"));try{const service=createThermalService({datasetPath:fileURLToPath(datasetPath),reviewPath:join(dir,"reviews.json"),smokePath:join(dir,"smoke.json")});const result=await service.handle("estimate",{model:"grok-4.3",maxOutputTokens:1200});assert.equal(result.tasks.length,10);assert.equal(result.estimateOnly,true);assert.equal(result.withinSuggestedCap,false);assert.equal(result.withinOverallCap,true);assert.ok(result.reservedUsd>=result.estimatedUsd);assert.equal((await service.handle("state")).benchmark.realApiCalls,0);await assert.rejects(service.handle("estimate",{model:"invented"}),/模型或价格/);await assert.rejects(service.handle("run",{authorized:true}),/专题接口不存在/);}finally{await rm(dir,{recursive:true,force:true});}
});
