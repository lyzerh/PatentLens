// Isolated capability experiment. No real-provider execution is exposed here.
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,appendFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {estimateCost} from '../src/pilot/benchmark.ts';

const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const MODEL='grok-4.3', VERSION='capability-check-v1', CAP=0.10;
const tasks=new Set(['patent_summary','patent_comparison_summary']);
function exact(span,doc){return typeof span==='string'&&span.length>0&&doc.independentClaims[0].includes(span);}
function check(task,value,docs){
  if(!value||typeof value!=='object')return false;
  if(task==='patent_summary')return typeof value.shortName==='string'&&value.shortName.length<=20&&typeof value.summary==='string'&&Array.isArray(value.tags)&&value.tags.length<=5&&Array.isArray(value.evidence)&&value.evidence.every(e=>e.sourceUrl===docs[0].sourceUrl&&exact(e.sourceSpan,docs[0]));
  return Array.isArray(value.differences)&&value.differences.length<=5&&value.differences.every(d=>d.a?.sourceUrl===docs[0].sourceUrl&&d.b?.sourceUrl===docs[1].sourceUrl&&exact(d.a?.sourceSpan,docs[0])&&exact(d.b?.sourceSpan,docs[1]));
}
export function createCapabilityGate({provider,auditPath,clock=Date.now}){
  if(typeof provider!=='function'||!auditPath)throw Error('MOCK_PROVIDER_AND_PRIVATE_AUDIT_PATH_REQUIRED');
  let quote=null,ticket=null,busy=false;
  const history=async()=>{try{const rows=new Map();for(const line of (await readFile(auditPath,'utf8')).trim().split('\n')){if(line){const row=JSON.parse(line);rows.set(row.id,row);}}return [...rows.values()];}catch(e){if(e.code==='ENOENT')return [];throw e;}};
  const save=async row=>{await mkdir(dirname(auditPath),{recursive:true});await appendFile(auditPath,JSON.stringify(row)+'\n');};
  function plan(task,docs){
    if(!tasks.has(task)||docs.length!==(task==='patent_summary'?1:2)||docs.some(d=>!d?.publicationNumber||!d.contentHash||!d.sourceUrl||!d.independentClaims?.[0]))throw Error('INVALID_TASK_INPUT');
    const input=docs.map(d=>({id:d.publicationNumber,hash:d.contentHash,url:d.sourceUrl,title:d.title,abstract:task==='patent_summary'?d.abstract:null,claim:d.independentClaims[0]}));
    const instructions=task==='patent_summary'?'shortName <=20 Chinese characters; summary 50-100 Chinese characters; <=5 tags; evidence as exact Claim 1 spans; unknowns; no unsupported effects or uses.':'common theme; <=5 differences with exact A/B Claim 1 spans; unknowns and questions; do not infer equivalence, infringement or superiority.';
    const prompt=`${VERSION} / ${task}\n${instructions}\n${JSON.stringify(input)}`;
    const estimatedInputTokens=Buffer.byteLength(prompt,'utf8')*2,maxOutputTokens=900,estimatedCostUsd=estimateCost(MODEL,estimatedInputTokens,maxOutputTokens),reservedUsd=Math.max(0.01,estimatedCostUsd*2);
    return {task,model:MODEL,promptVersion:VERSION,inputHash:hash(input),promptHash:hash(prompt),identity:input.map(({id,hash,url})=>({id,hash,url})),prompt,estimatedInputTokens,maxOutputTokens,estimatedCostUsd,reservedUsd};
  }
  async function preflight(task,docs){const p=plan(task,docs);if(p.reservedUsd>CAP)throw Error('PER_RUN_BUDGET_EXCEEDED');if((await history()).some(x=>x.task===task&&x.inputHash===p.inputHash&&x.status!=='definitely_not_sent'))throw Error('TASK_ALREADY_ATTEMPTED');quote={id:randomUUID(),expires:clock()+120000,p};ticket=null;return {quoteId:quote.id,expiresAt:quote.expires,...Object.fromEntries(Object.entries(p).filter(([k])=>k!=='prompt')),capUsd:CAP,paid:false,authorization:false};}
  function authorize(quoteId,task,docs,confirmed){if(!quote||quote.id!==quoteId||quote.expires<clock()||!confirmed)throw Error('EXPLICIT_COST_CONFIRMATION_REQUIRED');const p=plan(task,docs);if(p.task!==quote.p.task||p.inputHash!==quote.p.inputHash||p.promptHash!==quote.p.promptHash||p.reservedUsd!==quote.p.reservedUsd)throw Error('TASK_INPUT_VERSION_CONFLICT');ticket={id:randomUUID(),nonce:randomUUID(),expires:Math.min(quote.expires,clock()+60000),p};quote=null;return {authorizationId:ticket.id,requestNonce:ticket.nonce,task:p.task,expiresAt:ticket.expires};}
  async function execute(auth,task,docs){if(busy||!ticket||auth.authorizationId!==ticket.id||auth.requestNonce!==ticket.nonce||task!==ticket.p.task||ticket.expires<clock())throw Error('ONE_TIME_TASK_AUTHORIZATION_REQUIRED');const t=ticket;ticket=null;const p=plan(task,docs);if(p.inputHash!==t.p.inputHash||p.promptHash!==t.p.promptHash)throw Error('TASK_INPUT_VERSION_CONFLICT');busy=true;try{const rows=await history();if(rows.some(x=>x.task===task&&x.inputHash===p.inputHash&&x.status!=='definitely_not_sent'))throw Error('TASK_ALREADY_ATTEMPTED');const audit={id:randomUUID(),task,model:MODEL,promptVersion:VERSION,inputHash:p.inputHash,promptHash:p.promptHash,identity:p.identity,reservedUsd:p.reservedUsd,estimatedCostUsd:p.estimatedCostUsd,status:'unknown',startedAt:new Date(clock()).toISOString(),rawResponse:null,validation:null};await save(audit);try{const raw=await provider({task,model:MODEL,prompt:p.prompt,maxOutputTokens:p.maxOutputTokens});audit.rawResponse=raw;const value=JSON.parse(raw);audit.validation={shapeAndExactEvidence:check(task,value,docs),semanticSupport:'not_assessed'};audit.status=audit.validation.shapeAndExactEvidence?'completed_mock':'validation_failed';}catch(e){audit.status='unknown';audit.errorCode=e instanceof SyntaxError?'INVALID_JSON':'PROVIDER_OR_TRANSPORT_UNKNOWN';}await save(audit);return audit;}finally{busy=false;}}
  return {preflight,authorize,execute,history};
}
