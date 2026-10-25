import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { createApp, isLoopbackAddress } from "../src/server.js";

const datasetPath=fileURLToPath(new URL("../data/smart-device-thermal-v1.3.json",import.meta.url));
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
async function start({envKey,provider}={}){
  const dir=await mkdtemp(join(resolve("data"),"xai-settings-test-"));
  const app=createApp({thermalDatasetPath:datasetPath,thermalReviewPath:join(dir,"reviews.json"),thermalSmokePath:join(dir,"smoke.json"),pilotPath:join(dir,"pilot.json"),getXaiKey:()=>envKey,fetchImpl:provider??(async()=>{throw new Error("provider must not be contacted");})});
  await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
  const base=`http://127.0.0.1:${app.address().port}`;
  const request=async(path,method="GET",body,csrf,origin=base)=>fetch(base+"/api/xai/settings/"+path,{method,headers:{...(origin?{Origin:origin}:{}),...(method!=="GET"?{"X-Patent-Client":"workbench","X-Patent-CSRF":csrf??""}:{}),...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {dir,app,base,request,close:async()=>{await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});}};
}

test("web Key is memory-only, never echoed, cleared, and lost on server restart",async()=>{
  const secret="xai-unit-test-secret-123456",s=await start();
  try{const initial=await (await s.request("status")).json();assert.deepEqual(initial,{configured:false,source:"none",connectionStatus:"Not configured",modelAvailability:"unknown"});const csrf=(await (await s.request("csrf")).json()).csrfToken;assert.equal(typeof csrf,"string");assert.ok(csrf.length>40);
    const saved=await s.request("key","POST",{apiKey:secret},csrf);assert.equal(saved.status,200);assert.ok(!(await saved.text()).includes(secret));const state=await (await s.request("status")).json();assert.equal(state.configured,true);assert.equal(state.source,"memory");assert.ok(!JSON.stringify(state).includes(secret));const page=await (await fetch(s.base+"/pilot-thermal")).text();assert.match(page,/type="password"/);assert.ok(!page.includes(secret));assert.equal((await s.request("key","DELETE",undefined,csrf)).status,200);assert.equal((await (await s.request("status")).json()).source,"none");
  }finally{await s.close();}
  const restarted=await start();try{assert.equal((await (await restarted.request("status")).json()).configured,false);}finally{await restarted.close();}
});

test("memory Key overrides environment but clearing reveals environment source",async()=>{
  const s=await start({envKey:"xai-env-fake-123456"});try{const csrf=(await (await s.request("csrf")).json()).csrfToken;assert.equal((await (await s.request("status")).json()).source,"environment");await s.request("key","POST",{apiKey:"xai-memory-fake-123456"},csrf);assert.equal((await (await s.request("status")).json()).source,"memory");const cleared=await (await s.request("key","DELETE",undefined,csrf)).json();assert.equal(cleared.configured,true);assert.equal(cleared.source,"environment");assert.match(cleared.message,/环境变量/);assert.ok(!JSON.stringify(cleared).includes("xai-env-fake"));}finally{await s.close();}
});

test("model-list connection test is free, reports availability honestly, and does not run Smoke",async()=>{
  let models=0,paid=0,seenKey;const secret="xai-test-connection-123456";const s=await start({provider:async(url,options)=>{if(String(url).endsWith("/models")){models++;seenKey=options.headers.Authorization;return json({data:[{id:"grok-4.3"}]});}paid++;throw new Error("paid path forbidden")}});
  try{const csrf=(await (await s.request("csrf")).json()).csrfToken;await s.request("key","POST",{apiKey:secret},csrf);assert.equal(paid,0);assert.equal(models,0);const testing=await (await s.request("test","POST",{},csrf)).json();assert.equal(testing.connectionStatus,"Connected");assert.equal(testing.modelAvailability,"listed_not_generation_verified");assert.match(testing.message,/not fully verified/);assert.equal(models,1);assert.equal(paid,0);assert.equal(seenKey,"Bearer "+secret);assert.ok(!JSON.stringify(testing).includes(secret));const thermal=await fetch(s.base+"/api/thermal/state",{method:"POST",headers:{"Content-Type":"application/json","X-Patent-Client":"workbench"},body:"{}"});assert.equal((await thermal.json()).smoke.keyConfigured,true);assert.equal(paid,0);assert.ok(!(await readFile(join(s.dir,"pilot.json"),"utf8").catch(()=>"")).includes(secret));}finally{await s.close();}
});

test("connection statuses distinguish invalid, unavailable, limited and network errors",async()=>{
  for(const [name,result,expected] of [["invalid",()=>new Response(null,{status:401}),"Invalid key"],["missing",()=>json({data:[{id:"other"}]}),"Model unavailable"],["limited",()=>new Response(null,{status:429}),"Rate limited"],["offline",()=>{throw new Error("secret connection failure")},"Connection error"]]){
    const s=await start({provider:async()=>result()});try{const csrf=(await (await s.request("csrf")).json()).csrfToken;await s.request("key","POST",{apiKey:"xai-status-secret-123456"},csrf);const reply=await (await s.request("test","POST",{},csrf)).json();assert.equal(reply.connectionStatus,expected,name);assert.ok(!JSON.stringify(reply).includes("xai-status-secret"));assert.ok(!JSON.stringify(reply).includes("secret connection failure"));}finally{await s.close();}
  }
});

test("Origin, CSRF, Host and loopback checks protect Key writes",async()=>{
  const s=await start();try{const csrf=(await (await s.request("csrf")).json()).csrfToken;assert.equal((await s.request("key","POST",{apiKey:"xai-csrf-secret-123456"},csrf,"https://evil.example")).status,403);assert.equal((await s.request("key","POST",{apiKey:"xai-csrf-secret-123456"},csrf,null)).status,403);assert.equal((await s.request("key","POST",{apiKey:"xai-csrf-secret-123456"},"wrong")).status,403);assert.equal((await (await s.request("status")).json()).configured,false);const wrongHost=await new Promise((resolve,reject)=>{http.get({hostname:"127.0.0.1",port:Number(new URL(s.base).port),path:"/api/xai/settings/status",headers:{Host:"evil.example"}},res=>{res.resume();resolve(res.statusCode);}).on("error",reject);});assert.equal(wrongHost,403);const status=await s.request("status");assert.equal(status.headers.get("access-control-allow-origin"),null);assert.equal(status.headers.get("cache-control"),"no-store");assert.equal(isLoopbackAddress("203.0.113.10"),false);assert.equal(isLoopbackAddress("127.0.0.1"),true);}finally{await s.close();}
});

test("provider failure never echoes or logs the submitted Key",async()=>{
  const secret="xai-no-log-secret-123456",logs=[],originalLog=console.log,originalError=console.error;
  const s=await start({provider:async()=>{throw new Error("network failure containing "+secret);}});
  try{console.log=(...args)=>logs.push(args.join(" "));console.error=(...args)=>logs.push(args.join(" "));const csrf=(await (await s.request("csrf")).json()).csrfToken;const saved=await s.request("key","POST",{apiKey:secret},csrf);assert.ok(!(await saved.text()).includes(secret));const tested=await s.request("test","POST",{},csrf);assert.ok(!(await tested.text()).includes(secret));assert.ok(!logs.join("\n").includes(secret));}finally{console.log=originalLog;console.error=originalError;await s.close();}
});
