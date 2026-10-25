import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
const asScript=source=>source.replace(/^import \{t,term,onLanguageChange,initializeI18n,getLanguage\} from '\.\/i18n\/index\.js';\s*/,'');
const i18nStubs={t:(key,params={})=>key.replace(/\{(\w+)\}/g,(_,name)=>String(params[name]??'')),term:(_,value)=>value,onLanguageChange:()=>{},initializeI18n:()=>{},getLanguage:()=>"zh-CN"};

test("page preflight cannot send a paid request even if a browser auto-accepts native confirms",async()=>{
  const source=await readFile(new URL("../public/pilot-thermal.js",import.meta.url),"utf8");
  const controls=new Map(),calls=[];
  const element=id=>{if(!controls.has(id))controls.set(id,{value:id==="smoke-patent"?"EP4476289B1":"",hidden:true,disabled:false,textContent:"",handlers:{},addEventListener(event,handler){this.handlers[event]=handler;}});return controls.get(id);};
  const fetchImpl=async(url)=>{calls.push(url);if(url==="/api/xai/settings/csrf")return {ok:true,json:async()=>({csrfToken:"fake-csrf"})};if(url==="/api/thermal/smoke-preflight")return {ok:true,json:async()=>({publicationNumber:"EP4476289B1",model:"grok-4.3",quoteId:"fake-free-quote",inputTokensEstimate:5000,descriptionCharsSent:7000,maxOutputTokens:1200,estimatedCostUsd:.01,reservedUsd:.02,singleCapUsd:.10,remainingUsd:4.9})};return new Promise(()=>{});};
  runInNewContext(asScript(source),{...i18nStubs,document:{getElementById:element},fetch:fetchImpl,confirm:()=>true,setTimeout,URL,Blob});
  await element("smoke-start").handlers.click();
  assert.equal(calls.filter(x=>x==="/api/thermal/smoke-preflight").length,1);
  assert.equal(calls.filter(x=>x==="/api/thermal/smoke-run").length,0);
  assert.equal(element("smoke-confirmation").hidden,false);
  assert.equal(typeof element("smoke-confirm").handlers.click,"function");
  element("smoke-cancel").handlers.click();
  assert.equal(element("smoke-confirmation").hidden,true);
  assert.equal(calls.filter(x=>x==="/api/thermal/smoke-run").length,0);
});

test("only the separate execute button obtains a grant and sends one request; refresh and repeated clicks do not",async()=>{
  const source=await readFile(new URL("../public/pilot-thermal.js",import.meta.url),"utf8"),calls=[],controls=new Map();
  const element=id=>{if(!controls.has(id))controls.set(id,{value:id==="smoke-patent"?"EP4476289B1":"",hidden:true,disabled:false,textContent:"",handlers:{},addEventListener(event,handler){this.handlers[event]=handler;}});return controls.get(id);};
  const result=value=>({ok:true,json:async()=>value});
  const fetchImpl=async(url)=>{calls.push(url);if(url==="/api/xai/settings/csrf")return result({csrfToken:"mock-csrf"});if(url==="/api/thermal/smoke-preflight")return result({quoteId:"quote-1",publicationNumber:"EP4476289B1",model:"grok-4.3",inputTokensEstimate:5000,descriptionCharsSent:7000,maxOutputTokens:1200,estimatedCostUsd:.01,reservedUsd:.02,singleCapUsd:.1,remainingUsd:4.9});if(url==="/api/thermal/smoke-authorize")return result({authorizationId:"grant-1",requestNonce:"nonce-1",publicationNumber:"EP4476289B1",model:"grok-4.3",inputHash:"hash",promptHash:"prompt",estimatedCostUsd:.01,reservedUsd:.02,maximumAllowedCostUsd:.1});if(url==="/api/thermal/smoke-run")return result({status:"completed"});return new Promise(()=>{});};
  const context={...i18nStubs,document:{getElementById:element},fetch:fetchImpl,confirm:()=>true,setTimeout,URL,Blob};runInNewContext(asScript(source),context);
  await element("smoke-start").handlers.click();assert.equal(calls.filter(x=>x==="/api/thermal/smoke-run").length,0);
  void element("smoke-confirm").handlers.click();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls.filter(x=>x.startsWith("/api/thermal/smoke-")),["/api/thermal/smoke-preflight","/api/thermal/smoke-authorize","/api/thermal/smoke-run"]);
  void element("smoke-confirm").handlers.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.filter(x=>x==="/api/thermal/smoke-run").length,1);
  const freshControls=new Map(),fresh=id=>{if(!freshControls.has(id))freshControls.set(id,{value:"",hidden:true,disabled:false,textContent:"",handlers:{},addEventListener(event,handler){this.handlers[event]=handler;}});return freshControls.get(id);};
  runInNewContext(asScript(source),{...context,document:{getElementById:fresh}});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.filter(x=>x==="/api/thermal/smoke-run").length,1);
});
