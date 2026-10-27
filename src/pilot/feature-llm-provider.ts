import {createHash} from 'node:crypto';
import featureSchema from '../../schemas/patent-feature-v1.schema.json' with {type:'json'};
import {buildRequest,readModelText} from '../llm.js';
import {costFromUsage,estimateCost,PRICES} from './benchmark.ts';
import type {ThermalDocument} from './thermal.ts';

export const FEATURE_PROMPT_VERSION='feature-claim1-xai-v1';
export const DEFAULT_FEATURE_MODEL='grok-4.3';
export const FEATURE_PRICE={model:DEFAULT_FEATURE_MODEL,version:PRICES.version,source:PRICES.source,short:PRICES.models[DEFAULT_FEATURE_MODEL]?.short,long:PRICES.models[DEFAULT_FEATURE_MODEL]?.long,longContextThreshold:PRICES.longContextThreshold};
export type ProviderUsage={inputTokens:number|null;outputTokens:number|null;cachedTokens:number|null;reasoningTokens:number|null};
export type ProviderResult={rawText:string;usage:ProviderUsage;resolvedModel:string;httpStatus:number;attempts:1;costUsd:number|null;costKind:'actual_cost'|'estimated_cost'|'unknown';responseStatus:string|null;finishReason?:string};
export type FeatureProviderAdapter={id:'xai';model:string;generate(input:{prompt:string;maxOutputTokens:number;timeoutMs:number},key:string):Promise<ProviderResult>};
export const sha=(text:string)=>createHash('sha256').update(text).digest('hex');

// The historical xAI Responses transport supports JSON Schema, including local $defs.
// Remove only document metadata; the unchanged local Schema v1 validator remains authoritative.
export const featureResponseSchema=Object.fromEntries(Object.entries(featureSchema).filter(([key])=>!['$schema','$id','title'].includes(key))) as {type:string;properties:any;required:string[];additionalProperties:boolean};
export function buildFeaturePrompt(doc:ThermalDocument){
  const claim=doc.independentClaims[0];if(!claim?.trim())throw new Error('CLAIM_1_UNAVAILABLE');
  const description=doc.description??'';
  const context=description.length>3500?description.slice(0,3500):description;
  const identity={publicationNumber:doc.publicationNumber,documentHash:doc.contentHash,sourceUrl:doc.sourceUrl,claimNumber:'1',sourceLanguage:'en'};
  const prompt=[
    `Patent Feature Schema v1. Prompt ${FEATURE_PROMPT_VERSION}. Return exactly one JSON object matching the provided schema.`,
    'Primary scope is Independent Claim 1. Separate technical subject, elements, limitations and relationships. Do not infer unsupported elements, applications, relationships, equivalence, infringement, FTO, validity or patent value.',
    'For claim evidence, originalText and sourceSpan must be one continuous, byte-for-byte Claim 1 substring. Use section="claims", locator="Claim 1", and copy the frozen publicationNumber, documentHash and full sourceUrl exactly. Do not delete reference numbers, rewrite words or merge distant spans.',
    'Description below is context only. Never promote an example or effect in the description into a necessary Claim 1 limitation. If citing a description finding, quote one exact continuous span, use section="description", claimLimitation=false, and a locator such as Description [0003] offset N computed from the complete frozen description. If uncertain, leave descriptionFindings empty.',
    'Preserve negative limitations, every material percentage and its referenceBasis, operators, units, strict bounds and open/closed intervals. Do not repair corrupted superscripts or scientific notation. For "melt viscosity of less than 105 Pa*s", do not turn 105 into 10^5 without source verification: preserve text/unit, set ambiguous bounds to null and list that exact span in unresolvedSpans.',
    'Relationships must point to existing element IDs and quote a directly supporting Claim 1 span. Put unsupported or unparsed text in unresolvedSpans. Set semanticSupport="not_assessed", extractionMode="llm_candidate", reviewStatus="draft", provenance="xai_grok_feature_candidate_unreviewed", and element confidenceStatus="llm_candidate".',
    `Frozen identity: ${JSON.stringify(identity)}`,
    `Title (context only): ${doc.title}`,
    `Independent Claim 1 (exact):\n${claim}`,
    `Description context (exact prefix; truncated=${description.length>context.length}; evidence only from shown text):\n${context}`
  ].join('\n\n');
  return {prompt,promptHash:sha(prompt),identity,inputHash:sha(JSON.stringify({identity,claim,title:doc.title,descriptionContext:context})),descriptionCharsSent:context.length,descriptionTruncated:description.length>context.length};
}
export function createXaiFeatureAdapter(options:{fetchImpl?:typeof fetch}={}):FeatureProviderAdapter{
  const fetchImpl=options.fetchImpl??fetch,model=DEFAULT_FEATURE_MODEL;
  return {id:'xai',model,async generate(input,key){
    if(!key)throw new Error('XAI_API_KEY_NOT_CONFIGURED');
    const request=buildRequest({protocol:'responses',baseUrl:'https://api.x.ai/v1',model,maxOutputTokens:input.maxOutputTokens,format:'schema',reasoningEffort:'none'},input.prompt,{schema:featureResponseSchema,name:'patent_feature_v1'});
    let response:Response;
    try{response=await fetchImpl(request.url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(request.body),signal:AbortSignal.timeout(input.timeoutMs)});}
    catch{throw new Error('PROVIDER_TRANSPORT_UNKNOWN: xAI request may have been delivered; retry forbidden');}
    if(!response.ok){await response.body?.cancel();const code=response.status===401||response.status===403?'PROVIDER_AUTH':response.status===429?'PROVIDER_RATE_LIMIT':response.status>=500?'PROVIDER_UNAVAILABLE':'PROVIDER_REJECTED';throw new Error(`${code}: HTTP ${response.status}`);}
    let raw:Record<string,unknown>;
    try{raw=await response.json() as Record<string,unknown>;}catch{throw new Error('PROVIDER_RESPONSE_UNKNOWN: malformed xAI envelope; retry forbidden');}
    let rawText:string;
    try{rawText=readModelText(raw,'responses');}catch{throw new Error('PROVIDER_RESPONSE_UNKNOWN: incomplete or refused xAI response; retry forbidden');}
    const c=costFromUsage(raw.usage as Parameters<typeof costFromUsage>[0],model);
    return {rawText,usage:{inputTokens:c.input,outputTokens:c.output,cachedTokens:c.cached,reasoningTokens:c.reasoning},resolvedModel:typeof raw.model==='string'?raw.model:model,httpStatus:response.status,attempts:1,costUsd:c.usd,costKind:c.kind==='actual'?'actual_cost':c.kind==='estimated'?'estimated_cost':'unknown',responseStatus:typeof raw.status==='string'?raw.status:null};
  }};
}
export {estimateCost};
