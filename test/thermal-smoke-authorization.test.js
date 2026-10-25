import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createThermalSmoke } from "../src/pilot/thermal-smoke.ts";
import { createApp } from "../src/server.js";

const dataset=JSON.parse(await readFile(new URL("../data/smart-device-thermal-v1.3.json",import.meta.url),"utf8"));
const patent="EP4476289B1";
const document=dataset.entries.find(x=>x.publicationNumber===patent);
const output={industryScope:"uncertain",primaryTechnologyCategory:document.primaryTechnologyCategory,secondaryTechnologyCategories:[],productApplication:[],technicalRelevance:true,potentialProductApplication:[],verifiedCommercialImplementation:"unknown",evidence:[{section:"title",sourceSpan:document.title,sourceUrl:document.sourceUrl}]};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
const providerResponse=()=>json({model:"grok-4.3",status:"completed",usage:{input_tokens:2000,output_tokens:300,cost_in_usd_ticks:10000000},output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
async function fixture(options={}){
  const dir=await mkdtemp(join(resolve("data"),"thermal-authorization-")),path=join(dir,"smoke.json"),clock={value:1_000_000},counts={models:0,paid:0};
  const fetchImpl=options.fetchImpl??(async url=>String(url).endsWith("/models")?(counts.models++,json({data:[{id:"grok-4.3"}]})):(counts.paid++,providerResponse()));
  const service=createThermalSmoke({path,fetchImpl,getKey:()=>"mock-only-key",now:()=>clock.value,...options});
  return {dir,path,clock,counts,service,cleanup:()=>rm(dir,{recursive:true,force:true})};
}
const quote=service=>service.preflight(dataset,patent);
const grant=(service,p)=>service.authorize(dataset,{quoteId:p.quoteId,publicationNumber:patent});

test("free quote is not an execution ticket; only a separate one-time grant permits one mock POST",async()=>{
  const f=await fixture();try{
    const p=await quote(f.service);assert.equal(f.counts.models,1);assert.equal(f.counts.paid,0);assert.equal(p.preflightId,undefined);assert.ok(p.quoteId);
    await assert.rejects(f.service.run(dataset,{authorized:true,preflightId:p.quoteId,publicationNumber:patent}),/一次性执行授权/);
    const a=await grant(f.service,p);assert.ok(a.authorizationId&&a.requestNonce);assert.equal(a.inputHash,document.contentHash);assert.equal(a.model,"grok-4.3");assert.equal(a.maximumAllowedCostUsd,.10);assert.equal(f.counts.paid,0);
    const r=await f.service.run(dataset,a);assert.equal(r.status,"completed");assert.equal(f.counts.paid,1);assert.equal(r.authorizationId,a.authorizationId);assert.equal(r.requestNonceHash,createHash("sha256").update(a.requestNonce).digest("hex"));assert.ok(!JSON.stringify(r).includes(a.requestNonce));
    await assert.rejects(f.service.run(dataset,a),/一次性执行授权/);await assert.rejects(f.service.preflight(dataset,patent),/禁止重复/);assert.equal(f.counts.paid,1);
    const restarted=createThermalSmoke({path:f.path,fetchImpl:async()=>{throw new Error("network prohibited")},getKey:()=>"mock-only-key"});await assert.rejects(restarted.run(dataset,a),/一次性执行授权/);
  }finally{await f.cleanup();}
});

test("quote and execution authorization expire independently",async()=>{
  const f=await fixture();try{
    const p=await quote(f.service);f.clock.value+=300_001;await assert.rejects(grant(f.service,p),/报价已失效/);assert.equal(f.counts.paid,0);
    const fresh=await quote(f.service),a=await grant(f.service,fresh);f.clock.value+=60_001;await assert.rejects(f.service.run(dataset,a),/授权无效或已过期/);assert.equal(f.counts.paid,0);
  }finally{await f.cleanup();}
});

test("binding rejects altered patent, model, hashes, nonce and any cost field",async()=>{
  const f=await fixture();try{
    const p=await quote(f.service),a=await grant(f.service,p);
    for(const [field,value] of [["publicationNumber","EP4015272B1"],["model","other"],["inputHash","wrong"],["promptHash","wrong"],["requestNonce","wrong"],["estimatedCostUsd",0],["reservedUsd",0],["maximumAllowedCostUsd",1]])await assert.rejects(f.service.run(dataset,{...a,[field]:value}),/一次性执行授权/);
    const altered=structuredClone(dataset);altered.entries.find(x=>x.publicationNumber===patent).title="changed after grant";await assert.rejects(f.service.run(altered,a),/输入、模型、Key 或费用已变化/);assert.equal(f.counts.paid,0);
    await assert.rejects(f.service.run(dataset,a),/一次性执行授权/);
    const p2=await quote(f.service),a2=await grant(f.service,p2);const changedHash=structuredClone(dataset);changedHash.entries.find(x=>x.publicationNumber===patent).contentHash="changed";await assert.rejects(f.service.run(changedHash,a2),/输入、模型、Key 或费用已变化/);assert.equal(f.counts.paid,0);
  }finally{await f.cleanup();}
});

test("timeout after dispatch is recorded as unknown and never automatically retried",async()=>{
  let paid=0;const f=await fixture({fetchImpl:async url=>String(url).endsWith("/models")?json({data:[{id:"grok-4.3"}]}):(paid++,Promise.reject(new DOMException("timed out","TimeoutError")))});
  try{const a=await grant(f.service,await quote(f.service)),r=await f.service.run(dataset,a);assert.equal(paid,1);assert.equal(r.status,"failed");assert.equal(r.errorCode,"TIMEOUT");assert.equal(r.costKind,"unknown");assert.equal(r.costUsd,null);assert.equal((await readFile(f.path,"utf8")).includes('"status": "failed"'),true);await assert.rejects(f.service.preflight(dataset,"EP4498205A1"),/费用未知/);await assert.rejects(f.service.run(dataset,a),/一次性执行授权/);assert.equal(paid,1);}finally{await f.cleanup();}
});

test("HTTP smoke routes reject absent Origin, CSRF, replay and old request format",async()=>{
  const f=await fixture();const app=createApp({thermalSmokePath:f.path,getXaiKey:()=>"mock-only-key",fetchImpl:async url=>String(url).endsWith("/models")?(f.counts.models++,json({data:[{id:"grok-4.3"}]})):(f.counts.paid++,providerResponse())});
  await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));const base=`http://127.0.0.1:${app.address().port}`;
  const token=(await (await fetch(base+"/api/xai/settings/csrf")).json()).csrfToken;
  const post=(action,body={},headers={})=>fetch(base+"/api/thermal/"+action,{method:"POST",headers:{"Content-Type":"application/json","X-Patent-Client":"workbench",...headers},body:JSON.stringify(body)});
  const valid={Origin:base,"X-Patent-CSRF":token};
  try{
    assert.equal((await fetch(base+"/pilot-thermal")).status,200);assert.equal(f.counts.paid,0);
    assert.equal((await post("smoke-preflight",{publicationNumber:patent})).status,403);
    assert.equal((await post("smoke-preflight",{publicationNumber:patent},{Origin:base})).status,403);
    assert.equal((await post("smoke-preflight",{publicationNumber:patent},{...valid,Origin:"http://evil.example"})).status,403);
    assert.equal((await post("smoke-run",{authorized:true,preflightId:"old"},valid)).status,400);assert.equal(f.counts.paid,0);
    const response=await post("smoke-preflight",{publicationNumber:patent},valid);assert.equal(response.status,200);const p=await response.json();assert.equal(f.counts.models,1);assert.equal(f.counts.paid,0);
    assert.equal((await post("smoke-run",{authorized:true,preflightId:p.quoteId},valid)).status,400);
    assert.equal((await post("smoke-authorize",{quoteId:p.quoteId,publicationNumber:patent},{Origin:base})).status,403);
    const authorization=await post("smoke-authorize",{quoteId:p.quoteId,publicationNumber:patent},valid);assert.equal(authorization.status,200);const a=await authorization.json();
    assert.equal((await post("smoke-run",a,{Origin:base})).status,403);assert.equal(f.counts.paid,0);
    assert.equal((await post("smoke-run",a,valid)).status,200);assert.equal(f.counts.paid,1);
    assert.equal((await post("smoke-run",a,valid)).status,400);assert.equal(f.counts.paid,1);
  }finally{await new Promise(resolve=>app.close(resolve));await f.cleanup();}
});

test("the three saved real runs remain byte-for-byte unchanged by authorization tests",async()=>{
  const bytes=await readFile(new URL("../data/smart-device-thermal-smoke.json",import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),"8e1cd05e4ffb56383940ee7adb7a92893cd2ccf029002d04c8a4ad1213af5434");
  assert.deepEqual(JSON.parse(bytes).runs.map(r=>r.publicationNumber),["EP3149425B1","EP4015272B1","EP4761489A1"]);
});
