import { access, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildRequest, readModelText } from "../llm.js";
import { checkXaiModel } from "../xai-key-session.js";
import { costFromUsage, estimateCost, PRICES } from "./benchmark.ts";
import { THERMAL_SCHEMA, thermalInput, thermalPrompt, thermalSmokeInputDocument, validateThermalOutput } from "./thermal-benchmark.ts";
import { fixedSample } from "./thermal-experiment.ts";
import type { ThermalDataset } from "./thermal.ts";

const DEFAULT_DOCUMENT="EP4015272B1", MODEL="grok-4.3", MAX_OUTPUT=1200, SINGLE_CAP=.10, TOTAL_CAP=5;
type SmokeRun={id:string;kind:"engineering_smoke_test";datasetVersion:string;publicationNumber:string;inputHash:string;inputSnapshot?:ReturnType<typeof thermalInput>;inputSnapshotHash?:string;promptText?:string;promptHash?:string;promptVersion?:string;authorizationId?:string;requestNonceHash?:string;maximumAllowedCostUsd?:number;model:string;variant:"C";validatorVariant:"D";startedAt:string;finishedAt:string|null;status:"reserved"|"completed"|"failed";inputTokensEstimate:number;maxOutputTokens:number;estimatedCostUsd:number;reservedUsd:number;actualCostUsd:number|null;costKind:"actual_cost"|"estimated_cost"|"unknown";costUsd:number|null;usage:unknown;latencyMs:number|null;httpStatus:number|null;resolvedModel:string|null;rawText:string|null;output:unknown;schemaValid:boolean|null;validator:{accepted:boolean;errors:string[];evidenceSupportRate:number|null}|null;errorCode:string|null;accuracy:null};
type SmokeState={datasetVersion:string;runs:SmokeRun[]};
type Binding={publicationNumber:string;expiresAt:number;datasetVersion:string;inputHash:string;inputSnapshotHash:string;promptHash:string;model:string;estimatedCostUsd:number;reservedUsd:number;maximumAllowedCostUsd:number;keyFingerprint:string};
type Quote=Binding&{quoteId:string};
type Authorization=Binding&{authorizationId:string;requestNonce:string};
type Options={path?:string;legacyPath?:string;fetchImpl?:typeof fetch;getKey?:()=>string|undefined;singleCapUsd?:number;now?:()=>number};
const safeError=(e:unknown)=>e instanceof Error&&e.name==="AbortError"?"ABORTED":e instanceof Error&&e.name==="TimeoutError"?"TIMEOUT":e instanceof SyntaxError?"INVALID_JSON":"REQUEST_FAILED";
export function createThermalSmoke(options:Options={}){
  const path=options.path??fileURLToPath(new URL("../../data/smart-device-thermal-smoke.json",import.meta.url));
  const claimPath=(id:string)=>path+"."+id+".claim";
  const activePath=path+".active";
  const legacyPath=options.legacyPath??fileURLToPath(new URL("../../data/pilot.json",import.meta.url));
  const fetchImpl=options.fetchImpl??fetch,getKey=options.getKey??(()=>process.env.XAI_API_KEY);
  const now=options.now??Date.now;
  const fingerprint=(key:string)=>createHash("sha256").update(key).digest("hex");
  const singleCap=options.singleCapUsd??SINGLE_CAP;if(!Number.isFinite(singleCap)||singleCap<=0||singleCap>TOTAL_CAP)throw new Error("单次预算限额配置无效");
  let busy=false,quote:Quote|null=null,authorization:Authorization|null=null,queue:Promise<unknown>=Promise.resolve();
  const doc=(d:ThermalDataset,id:string)=>{if(!fixedSample(d).some(x=>x.publicationNumber===id))throw new Error("Smoke Test 仅允许冻结首轮五篇文献");const entry=d.entries.find(x=>x.publicationNumber===id);if(!entry)throw new Error("冻结数据缺少 Smoke Test 文献");return entry;};
  const read=async(version:string):Promise<SmokeState>=>{try{const state=JSON.parse(await readFile(path,"utf8")) as SmokeState;if(state.datasetVersion!==version)throw new Error("Smoke Test 记录版本不符");return state;}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {datasetVersion:version,runs:[]};throw e;}};
  const claimed=async(id:string)=>{for(const target of [claimPath(id),...(id==="EP3149425B1"?[path+".claim"]:[])]){try{await access(target);return true;}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}return false;};
  const save=async(state:SmokeState)=>{const temp=path+"."+randomUUID()+".tmp";await writeFile(temp,JSON.stringify(state,null,2),{flag:"wx",mode:0o600});await rename(temp,path);};
  const mutate=<T>(version:string,fn:(s:SmokeState)=>Promise<T>|T):Promise<T>=>{const next=queue.then(async()=>{const s=await read(version),result=await fn(s);await save(s);return result;});queue=next.catch(()=>undefined);return next;};
  const forecast=(d:ThermalDataset,id:string)=>{const entry=doc(d,id),sent=thermalSmokeInputDocument(entry),inputSnapshot=thermalInput(sent),promptText=thermalPrompt(sent,"C"),inputSnapshotHash=createHash("sha256").update(JSON.stringify(inputSnapshot)).digest("hex"),promptHash=createHash("sha256").update(promptText).digest("hex"),inputTokensEstimate=Math.ceil(promptText.length/2),estimatedCostUsd=estimateCost(MODEL,inputTokensEstimate,MAX_OUTPUT);return {datasetVersion:d.version,publicationNumber:id,inputHash:entry.contentHash,inputSnapshotHash,promptHash,descriptionCharsSent:sent.description?.length??0,model:MODEL,variant:"C",validatorVariant:"D",inputTokensEstimate,maxOutputTokens:MAX_OUTPUT,estimatedCostUsd,reservedUsd:Math.max(.002,estimatedCostUsd*2),singleCapUsd:singleCap,totalCapUsd:TOTAL_CAP,priceVersion:PRICES.version,inputSnapshot,promptText,sent};};
  const legacy=async()=>{try{const data=JSON.parse(await readFile(legacyPath,"utf8")) as {pilotV3?:{runs?:{mode?:string;apiCostUsd?:number|null}[];reservations?:{reservedUsd?:number}[]}};const v=data.pilotV3;if(!v)return {spent:0,outstanding:0,unknown:0};const api=(v.runs??[]).filter(x=>x.mode==="api");return {spent:api.reduce((n,x)=>n+(typeof x.apiCostUsd==="number"?x.apiCostUsd:0),0),outstanding:(v.reservations??[]).reduce((n,x)=>n+(x.reservedUsd??0),0),unknown:api.filter(x=>x.apiCostUsd==null).length};}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return {spent:0,outstanding:0,unknown:0};throw new Error("旧版预算记录无法读取；禁止付费请求");}};
  const budget=(state:SmokeState,prior:{spent:number;outstanding:number;unknown:number})=>{const spent=prior.spent+state.runs.reduce((n,r)=>n+(r.costUsd??0),0),outstanding=prior.outstanding+state.runs.filter(r=>r.status==="reserved"||r.costKind==="unknown").reduce((n,r)=>n+r.reservedUsd,0);return {spentUsd:spent,outstandingUsd:outstanding,remainingUsd:Math.max(0,TOTAL_CAP-spent-outstanding),unknownCostRequests:prior.unknown+state.runs.filter(r=>r.status!=="reserved"&&r.costKind==="unknown").length};};
  const publicState=async(d:ThermalDataset)=>{const state=await read(d.version),attemptedByPublication=Object.fromEntries(await Promise.all(fixedSample(d).map(async x=>[x.publicationNumber,state.runs.some(r=>r.publicationNumber===x.publicationNumber)||await claimed(x.publicationNumber)] as const)));return {kind:"engineering_smoke_test",publicationNumber:DEFAULT_DOCUMENT,model:MODEL,alreadyAttempted:attemptedByPublication[DEFAULT_DOCUMENT],attemptedByPublication,runs:state.runs,budget:budget(state,await legacy()),keyConfigured:Boolean(getKey()),singleCapUsd:singleCap,totalCapUsd:TOTAL_CAP,accuracy:null};};
  const preflight=async(d:ThermalDataset,id:string=DEFAULT_DOCUMENT,signal?:AbortSignal)=>{
    const key=getKey();if(!key)throw new Error("未配置服务端 XAI_API_KEY");
    const f=forecast(d,id),state=await read(d.version);if(state.runs.some(r=>r.publicationNumber===id)||busy||await claimed(id))throw new Error("该专利的单次 Smoke Test 已执行或预留；禁止重复付费请求");
    const b=budget(state,await legacy());
    if(b.unknownCostRequests)throw new Error("已有费用未知的请求；须核实账单后才能预留新请求");
    if(f.reservedUsd>singleCap)throw new Error(`预算预留 $${f.reservedUsd.toFixed(4)} 超出单次限额 $${singleCap.toFixed(2)}；未发起付费请求`);
    if(f.reservedUsd>b.remainingUsd)throw new Error("预算预留超过剩余累计预算；未发起付费请求");
    const checked=await checkXaiModel(key,{fetchImpl,signal});
    if(checked.connectionStatus!=="Connected"||checked.modelAvailability!=="listed_not_generation_verified")throw new Error(checked.message+" 未发起付费请求。");
    quote={quoteId:randomUUID(),publicationNumber:id,expiresAt:now()+5*60_000,datasetVersion:d.version,inputHash:f.inputHash,inputSnapshotHash:f.inputSnapshotHash,promptHash:f.promptHash,model:MODEL,estimatedCostUsd:f.estimatedCostUsd,reservedUsd:f.reservedUsd,maximumAllowedCostUsd:singleCap,keyFingerprint:fingerprint(key)};
    authorization=null;
    const {inputSnapshot,promptText,sent,...publicForecast}=f;return {...publicForecast,...b,modelAvailability:"listed_not_generation_verified",expiresAt:new Date(quote.expiresAt).toISOString(),quoteId:quote.quoteId,requiresUserConfirmation:true,accuracy:null,warning:"预检只查询模型列表，不能证明生成权限。金额是估算和预留，不是账单硬上限。此报价不能执行付费请求；须另行点击执行按钮。"};
  };
  const authorize=async(d:ThermalDataset,body:Record<string,unknown>)=>{
    const q=quote;
    if(!q||typeof body.quoteId!=="string"||body.quoteId!==q.quoteId||body.publicationNumber!==q.publicationNumber||now()>q.expiresAt)throw new Error("报价已失效；请重新预检并查看费用");
    quote=null;
    const key=getKey();if(!key||q.keyFingerprint!==fingerprint(key))throw new Error("API Key 已变更；请重新预检");
    const f=forecast(d,q.publicationNumber),state=await read(d.version),b=budget(state,await legacy());
    if(q.datasetVersion!==d.version||q.inputHash!==f.inputHash||q.inputSnapshotHash!==f.inputSnapshotHash||q.promptHash!==f.promptHash||q.model!==MODEL||q.estimatedCostUsd!==f.estimatedCostUsd||q.reservedUsd!==f.reservedUsd||q.maximumAllowedCostUsd!==singleCap)throw new Error("输入、模型或费用已变化；请重新预检");
    if(state.runs.some(r=>r.publicationNumber===q.publicationNumber)||busy||await claimed(q.publicationNumber))throw new Error("该专利已执行或预留；禁止重复付费请求");
    if(b.unknownCostRequests||f.reservedUsd>singleCap||f.reservedUsd>b.remainingUsd)throw new Error("预算不足或有未知费用；未发起付费请求");
    authorization={...q,authorizationId:randomUUID(),requestNonce:randomUUID(),expiresAt:Math.min(q.expiresAt,now()+60_000)};
    return {authorizationId:authorization.authorizationId,requestNonce:authorization.requestNonce,publicationNumber:q.publicationNumber,model:q.model,inputHash:q.inputHash,promptHash:q.promptHash,estimatedCostUsd:q.estimatedCostUsd,reservedUsd:q.reservedUsd,maximumAllowedCostUsd:q.maximumAllowedCostUsd,expiresAt:new Date(authorization.expiresAt).toISOString()};
  };
  const run=async(d:ThermalDataset,body:Record<string,unknown>,signal?:AbortSignal)=>{
    if(busy)throw new Error("已有 Smoke Test 正在运行");
    const active=authorization;
    if(!active||typeof body.authorizationId!=="string"||typeof body.requestNonce!=="string"||body.authorizationId!==active.authorizationId||body.requestNonce!==active.requestNonce||body.publicationNumber!==active.publicationNumber||body.model!==active.model||body.inputHash!==active.inputHash||body.promptHash!==active.promptHash||body.estimatedCostUsd!==active.estimatedCostUsd||body.reservedUsd!==active.reservedUsd||body.maximumAllowedCostUsd!==active.maximumAllowedCostUsd||now()>active.expiresAt)throw new Error("一次性执行授权无效或已过期；请重新预检");
    authorization=null;busy=true;
    let activeLocked=false;
    try{
      const key=getKey();if(!key)throw new Error("XAI_API_KEY 已移除；未发起付费请求");
      const id=active.publicationNumber,f=forecast(d,id);
      if(active.datasetVersion!==d.version||active.inputHash!==f.inputHash||active.inputSnapshotHash!==f.inputSnapshotHash||active.promptHash!==f.promptHash||active.model!==MODEL||active.estimatedCostUsd!==f.estimatedCostUsd||active.reservedUsd!==f.reservedUsd||active.maximumAllowedCostUsd!==singleCap||active.keyFingerprint!==fingerprint(key))throw new Error("授权绑定的输入、模型、Key 或费用已变化；未发起付费请求");
      try{await writeFile(activePath,JSON.stringify({publicationNumber:id,claimedAt:new Date().toISOString()}),{flag:"wx",mode:0o600});activeLocked=true;}catch(e){if((e as NodeJS.ErrnoException).code==="EEXIST")throw new Error("另一个本地服务正在执行 Smoke Test；禁止并发请求");throw e;}
      if(await claimed(id))throw new Error("该专利已有 Smoke Test 记录或预留；禁止重复请求");
      const prior=await legacy(),latest=await read(d.version),latestBudget=budget(latest,prior);
      if(latest.runs.some(r=>r.publicationNumber===id)||latestBudget.unknownCostRequests||f.reservedUsd>singleCap||f.reservedUsd>latestBudget.remainingUsd)throw new Error("预算不足、费用未知或该专利已执行；未发起付费请求");
      try{await writeFile(claimPath(id),JSON.stringify({datasetVersion:d.version,inputHash:f.inputHash,promptHash:f.promptHash,authorizationId:active.authorizationId,reservedUsd:f.reservedUsd,claimedAt:new Date().toISOString()}),{flag:"wx",mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code==="EEXIST")throw new Error("另一个本地服务已预留本次 Smoke Test；禁止重复请求");throw e;}
      const runId=randomUUID(),startedAt=new Date().toISOString();
      const initial:SmokeRun={id:runId,kind:"engineering_smoke_test",datasetVersion:d.version,publicationNumber:id,inputHash:f.inputHash,inputSnapshot:f.inputSnapshot,inputSnapshotHash:f.inputSnapshotHash,promptText:f.promptText,promptHash:f.promptHash,promptVersion:"thermal-smoke-c-v2-bounded-evidence",authorizationId:active.authorizationId,requestNonceHash:fingerprint(active.requestNonce),maximumAllowedCostUsd:singleCap,model:MODEL,variant:"C",validatorVariant:"D",startedAt,finishedAt:null,status:"reserved",inputTokensEstimate:f.inputTokensEstimate,maxOutputTokens:MAX_OUTPUT,estimatedCostUsd:f.estimatedCostUsd,reservedUsd:f.reservedUsd,actualCostUsd:null,costKind:"unknown",costUsd:null,usage:null,latencyMs:null,httpStatus:null,resolvedModel:null,rawText:null,output:null,schemaValid:null,validator:null,errorCode:null,accuracy:null};
      await mutate(d.version,s=>{if(s.runs.some(r=>r.publicationNumber===id))throw new Error("该专利已存在 Smoke Test 记录；禁止重复付费请求");const b=budget(s,prior);if(b.unknownCostRequests||f.reservedUsd>singleCap||f.reservedUsd>b.remainingUsd)throw new Error("预算不足或有未知费用；未发起付费请求");s.runs.push(initial);});
      const request=buildRequest({protocol:"responses",baseUrl:"https://api.x.ai/v1",model:MODEL,maxOutputTokens:MAX_OUTPUT,format:"schema",reasoningEffort:"none"},f.promptText,{schema:{...THERMAL_SCHEMA,required:[...THERMAL_SCHEMA.required]},name:"thermal_smoke_classification"});
      const start=performance.now();let patch:Partial<SmokeRun>={};
      try{
        const response=await fetchImpl(request.url,{method:"POST",redirect:"error",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(request.body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});
        patch.httpStatus=response.status;
        if(!response.ok){await response.body?.cancel();patch.errorCode="HTTP_"+response.status;}
        else {
          const raw=await response.json() as {model?:string;usage?:Parameters<typeof costFromUsage>[0]};
          patch.usage=raw.usage??null;patch.resolvedModel=raw.model??null;
          const cost=costFromUsage(raw.usage,MODEL);patch.costUsd=cost.usd;patch.actualCostUsd=cost.kind==="actual"?cost.usd:null;patch.costKind=cost.kind==="actual"?"actual_cost":cost.kind==="estimated"?"estimated_cost":"unknown";
          if(raw.model&&raw.model!==MODEL)patch.errorCode="MODEL_MISMATCH";
          else {const rawText=readModelText(raw,"responses").replaceAll(key,"[REDACTED]");patch.rawText=rawText.slice(0,100000);const output=JSON.parse(rawText);patch.output=output;const validation=validateThermalOutput(f.sent,output);patch.schemaValid=validation.errors.every(x=>x==="EVIDENCE_NOT_EXACT");patch.validator=validation;}
        }
      }catch(e){patch.errorCode=safeError(e);}
      patch.status=patch.errorCode?"failed":"completed";patch.finishedAt=new Date().toISOString();patch.latencyMs=Math.round(performance.now()-start);
      return mutate(d.version,s=>{const target=s.runs.find(x=>x.id===runId);if(!target)throw new Error("Smoke Test 预留记录丢失");Object.assign(target,patch);return target;});
    }finally{if(activeLocked)await unlink(activePath);busy=false;}
  };
  return {publicState,preflight,authorize,run};
}
