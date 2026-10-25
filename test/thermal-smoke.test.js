import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createThermalSmoke } from "../src/pilot/thermal-smoke.ts";
import { createApp } from "../src/server.js";
import { replayThermalSmoke } from "../src/pilot/thermal-replay.ts";
import { thermalSmokeInputDocument, validateThermalOutput } from "../src/pilot/thermal-benchmark.ts";

const dataset=JSON.parse(await readFile(new URL("../data/smart-device-thermal-v1.3.json",import.meta.url),"utf8"));
const FIRST="EP3149425B1";
const source=dataset.entries.find(x=>x.publicationNumber==="EP3149425B1");
const output={industryScope:source.scope,primaryTechnologyCategory:source.primaryTechnologyCategory,secondaryTechnologyCategories:source.secondaryTechnologyCategories,productApplication:source.potentialProductApplication,technicalRelevance:source.technicalRelevance,potentialProductApplication:source.potentialProductApplication,verifiedCommercialImplementation:"unknown",evidence:[source.supportingSourceSpan[0]]};
const fakeResponse=(usage)=>({model:"grok-4.3",status:"completed",usage,output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const authorize=async(service,preflight)=>service.authorize(dataset,{quoteId:preflight.quoteId,publicationNumber:preflight.publicationNumber});

test("single C request is confirmed, persisted, validated as D and never scored as accuracy",async()=>{
  const dir=await mkdtemp(join(resolve("data"),"thermal-smoke-"));let modelChecks=0,paid=0,requestBody;
  const fetchImpl=async(url,options)=>{if(String(url).endsWith("/models")){modelChecks++;assert.equal(options.method,"GET");return json({data:[{id:"grok-4.3"}]});}paid++;requestBody=JSON.parse(options.body);return json(fakeResponse({input_tokens:3000,output_tokens:400,cost_in_usd_ticks:160000000}));};
  const path=join(dir,"smoke.json"),service=createThermalSmoke({path,fetchImpl,getKey:()=>"test-secret"});
  try{assert.equal((await service.publicState(dataset)).runs.length,0);assert.equal(paid,0);await assert.rejects(service.run(dataset,{authorized:true,preflightId:"invented"}),/一次性执行授权无效/);const preflight=await service.preflight(dataset,FIRST);assert.equal(modelChecks,1);assert.equal(paid,0);assert.equal(preflight.publicationNumber,"EP3149425B1");assert.equal(preflight.model,"grok-4.3");assert.ok(preflight.inputTokensEstimate>0);assert.ok(preflight.reservedUsd<preflight.singleCapUsd);await assert.rejects(service.run(dataset,{authorized:false,preflightId:preflight.preflightId}),/一次性执行授权无效/);assert.equal(paid,0);
    const auth=await authorize(service,preflight),run=await service.run(dataset,auth);assert.equal(paid,1);assert.equal(run.kind,"engineering_smoke_test");assert.equal(run.variant,"C");assert.equal(run.validatorVariant,"D");assert.equal(run.schemaValid,true);assert.equal(run.validator.accepted,true);assert.equal(run.accuracy,null);assert.equal(run.costKind,"actual_cost");assert.equal(run.actualCostUsd,.016);assert.equal(requestBody.model,"grok-4.3");assert.equal(requestBody.text.format.type,"json_schema");assert.equal(requestBody.max_output_tokens,1200);assert.equal(requestBody.reasoning.effort,"none");
    const saved=await readFile(path,"utf8");assert.ok(!saved.includes("test-secret"));assert.equal(JSON.parse(saved).runs[0].usage.input_tokens,3000);assert.equal((await service.publicState(dataset)).attemptedByPublication[FIRST],true);await assert.rejects(service.preflight(dataset,FIRST),/禁止重复/);assert.equal(paid,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("token-only cost is estimated, and failed paid request is not automatically retried",async()=>{
  const dir=await mkdtemp(join(resolve("data"),"thermal-smoke-est-"));try{
    for(const [label,response,expectedCost,expectedPaid] of [["estimated",json(fakeResponse({input_tokens:3000,output_tokens:400})),"estimated_cost",1],["failure",new Response(null,{status:429}),"unknown",1]]){
      let paid=0;const service=createThermalSmoke({path:join(dir,label+".json"),getKey:()=>"fake",fetchImpl:async(url)=>String(url).endsWith("/models")?json({data:[{id:"grok-4.3"}]}):(paid++,response)});
      const p=await service.preflight(dataset,FIRST),auth=await authorize(service,p),run=await service.run(dataset,auth);assert.equal(paid,expectedPaid);assert.equal(run.costKind,expectedCost);assert.equal(run.actualCostUsd,null);assert.equal(run.status,label==="failure"?"failed":"completed");await assert.rejects(service.preflight(dataset,FIRST),/禁止重复/);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("missing key, denied model and single-request cap all block before paid POST",async()=>{
  const dir=await mkdtemp(join(resolve("data"),"thermal-smoke-block-"));let paid=0;try{
    const noKey=createThermalSmoke({path:join(dir,"no-key.json"),getKey:()=>undefined,fetchImpl:async()=>{paid++;throw new Error("must not call")}});await assert.rejects(noKey.preflight(dataset),/XAI_API_KEY/);
    const denied=createThermalSmoke({path:join(dir,"denied.json"),getKey:()=>"fake",fetchImpl:async()=>json({data:[{id:"other-model"}]})});await assert.rejects(denied.preflight(dataset),/grok-4.3 不在/);
    const capped=createThermalSmoke({path:join(dir,"capped.json"),getKey:()=>"fake",singleCapUsd:.001,fetchImpl:async()=>{paid++;throw new Error("must not call")}});await assert.rejects(capped.preflight(dataset),/超出单次限额/);assert.equal(paid,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("HTTP page load and Mock never call xAI; preflight is GET only and paid request needs ticket",async()=>{
  const dir=await mkdtemp(join(resolve("data"),"thermal-smoke-http-"));let paid=0,checks=0;const app=createApp({thermalSmokePath:join(dir,"smoke.json"),thermalDatasetPath:fileURLToPath(new URL("../data/smart-device-thermal-v1.3.json",import.meta.url)),thermalReviewPath:join(dir,"reviews.json"),getXaiKey:()=>"fake",fetchImpl:async(url)=>{if(String(url).endsWith("/models")){checks++;return json({data:[{id:"grok-4.3"}]});}paid++;throw new Error("paid call prohibited in test")}});await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${app.address().port}`,csrf=(await (await fetch(base+"/api/xai/settings/csrf")).json()).csrfToken,post=async(action,body={})=>fetch(base+"/api/thermal/"+action,{method:"POST",headers:{"Content-Type":"application/json","X-Patent-Client":"workbench","Origin":base,"X-Patent-CSRF":csrf},body:JSON.stringify(body)});
  try{assert.equal((await fetch(base+"/pilot-thermal")).status,200);assert.equal((await post("state")).status,200);assert.equal((await post("mock")).status,200);assert.equal(paid,0);assert.equal(checks,0);const run=await post("smoke-run",{authorized:true,preflightId:"none"});assert.equal(run.status,400);assert.equal(paid,0);const pre=await post("smoke-preflight");assert.equal(pre.status,200);const quote=await pre.json();assert.ok(quote.quoteId);const old=await post("smoke-run",{authorized:true,preflightId:quote.quoteId,publicationNumber:quote.publicationNumber});assert.equal(old.status,400);assert.equal(checks,1);assert.equal(paid,0);}finally{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});}
});
test("legacy $5 budget and unknown old charges block the new paid path",async()=>{
  const dir=await mkdtemp(join(resolve("data"),"thermal-smoke-legacy-"));let calls=0;try{
    for(const [name,cost] of [["spent",4.99],["unknown",null]]){const legacyPath=join(dir,name+"-pilot.json");await writeFile(legacyPath,JSON.stringify({pilotV3:{runs:[{mode:"api",apiCostUsd:cost}],reservations:[]}}));const service=createThermalSmoke({path:join(dir,name+"-smoke.json"),legacyPath,getKey:()=>"fake",fetchImpl:async()=>{calls++;throw new Error("network must be blocked")}});await assert.rejects(service.preflight(dataset),/预算|费用未知/);}
    assert.equal(calls,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("two local services cannot each buy the same one-shot smoke request",async()=>{
  const dir=await mkdtemp(join(resolve("data"),"thermal-smoke-race-")),path=join(dir,"smoke.json");let paid=0;const fetchImpl=async url=>String(url).endsWith("/models")?json({data:[{id:"grok-4.3"}]}):(paid++,json(fakeResponse({input_tokens:3000,output_tokens:400})));const a=createThermalSmoke({path,getKey:()=>"fake",fetchImpl}),b=createThermalSmoke({path,getKey:()=>"fake",fetchImpl});
  try{const [pa,pb]=await Promise.all([a.preflight(dataset,FIRST),b.preflight(dataset,FIRST)]);const [aa,ab]=await Promise.all([authorize(a,pa),authorize(b,pb)]);const results=await Promise.allSettled([a.run(dataset,aa),b.run(dataset,ab)]);assert.equal(results.filter(x=>x.status==="fulfilled").length,1);assert.equal(paid,1);}finally{await rm(dir,{recursive:true,force:true});}
});
test("changing the Key after preflight invalidates authorization before paid POST",async()=>{
  const dir=await mkdtemp(join(resolve("data"),"thermal-smoke-key-change-"));let key="first-fake-key",paid=0;const service=createThermalSmoke({path:join(dir,"smoke.json"),getKey:()=>key,fetchImpl:async url=>String(url).endsWith("/models")?json({data:[{id:"grok-4.3"}]}):(paid++,json(fakeResponse({input_tokens:100,output_tokens:100})))});
  try{const p=await service.preflight(dataset);key="second-fake-key";await assert.rejects(authorize(service,p),/Key 已变更/);assert.equal(paid,0);}finally{await rm(dir,{recursive:true,force:true});}
});
test("second sample preflight is bounded, exact-source instructed, and never sends paid request",async()=>{
  const dir=await mkdtemp(join(resolve("data"),"thermal-second-preflight-"));let paid=0;
  try{const service=createThermalSmoke({path:join(dir,"smoke.json"),getKey:()=>"fake",fetchImpl:async url=>String(url).endsWith("/models")?json({data:[{id:"grok-4.3"}]}):(paid++,json({}))});
    const state=await service.publicState(dataset);assert.equal(state.publicationNumber,"EP4015272B1");assert.equal(state.alreadyAttempted,false);
    const p=await service.preflight(dataset);assert.equal(p.publicationNumber,"EP4015272B1");assert.ok(p.descriptionCharsSent>0&&p.descriptionCharsSent<=8000);assert.ok(p.reservedUsd<.10);assert.ok(p.estimatedCostUsd<p.reservedUsd);assert.equal(p.inputSnapshot,undefined);assert.equal(p.promptText,undefined);assert.equal(paid,0);
    await assert.rejects(service.preflight(dataset,"EP9999999B1"),/冻结首轮五篇/);assert.equal(paid,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("second run appends without changing first response, stores sent snapshot, and D rejects unsent description",async()=>{
  const dir=await mkdtemp(join(resolve("data"),"thermal-second-append-")),path=join(dir,"smoke.json");
  const history=JSON.parse(await readFile(new URL("../data/smart-device-thermal-smoke.json",import.meta.url),"utf8"));history.runs=[history.runs.find(x=>x.publicationNumber===FIRST)];await writeFile(path,JSON.stringify(history));
  const firstBefore=JSON.stringify(history.runs[0]);const doc=dataset.entries.find(x=>x.publicationNumber==="EP4015272B1");
  const answer={industryScope:"out_of_scope",primaryTechnologyCategory:doc.primaryTechnologyCategory,secondaryTechnologyCategories:[],productApplication:[],technicalRelevance:true,potentialProductApplication:[],verifiedCommercialImplementation:"unknown",evidence:[{section:"claims",sourceSpan:doc.independentClaims[0].slice(0,45),sourceUrl:doc.sourceUrl}]};
  let paid=0,requestBody;
  const service=createThermalSmoke({path,getKey:()=>"fake",fetchImpl:async(url,options)=>String(url).endsWith("/models")?json({data:[{id:"grok-4.3"}]}):(paid++,requestBody=JSON.parse(options.body),json({model:"grok-4.3",status:"completed",usage:{input_tokens:5800,output_tokens:300,cost_in_usd_ticks:100000000},output:[{content:[{type:"output_text",text:JSON.stringify(answer)}]}]}))});
  try{const p=await service.preflight(dataset);assert.equal(p.publicationNumber,doc.publicationNumber);assert.ok(p.remainingUsd<5);assert.equal(paid,0);const auth=await authorize(service,p),run=await service.run(dataset,auth);assert.equal(paid,1);assert.equal(run.validator.accepted,true);assert.equal(run.inputHash,doc.contentHash);assert.equal(run.inputSnapshot.sourceUrl,doc.sourceUrl);assert.ok(run.promptText.includes(doc.sourceUrl));assert.ok(run.promptText.includes("one continuous, verbatim substring"));assert.ok(run.promptText.includes("Never delete identifiers"));assert.ok(run.inputSnapshot.description.length<=8000);assert.ok(doc.description.length>run.inputSnapshot.description.length);assert.ok(JSON.stringify(requestBody).includes(doc.sourceUrl));
    const saved=JSON.parse(await readFile(path,"utf8"));assert.equal(saved.runs.length,2);assert.equal(JSON.stringify(saved.runs[0]),firstBefore);assert.equal(saved.runs[1].publicationNumber,doc.publicationNumber);const replay=replayThermalSmoke(dataset,run);assert.equal(replay.strictAfter,true);assert.equal(replay.inputSnapshotHashMatch,true);assert.equal(replay.promptHashMatch,true);assert.equal(replay.semanticSupport,"not_assessed");
    const tail=doc.description.slice(-120);const forged={...answer,evidence:[{section:"description",sourceSpan:tail,sourceUrl:doc.sourceUrl}]};assert.ok(doc.description.includes(tail));assert.equal(thermalSmokeInputDocument(doc).description.includes(tail),false);assert.equal(validateThermalOutput(thermalSmokeInputDocument(doc),forged).accepted,false);assert.equal(validateThermalOutput(thermalSmokeInputDocument(doc),forged).evidenceDiagnostics[0].span_exact_match,false);
    await assert.rejects(service.preflight(dataset,doc.publicationNumber),/禁止重复/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
