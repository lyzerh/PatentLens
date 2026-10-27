import {createHash} from 'node:crypto';
import featureSchema from '../../schemas/patent-feature-v1.schema.json' with {type:'json'};
import type {ThermalDocument} from './thermal.ts';

export const FEATURE_PROMPT_VERSION='feature-claim1-v1';
export const DEFAULT_FEATURE_MODEL='gemini-2.5-flash-lite';
export const FEATURE_PRICE={model:DEFAULT_FEATURE_MODEL,inputUsdPerMillion:0.10,outputUsdPerMillion:0.40,source:'https://ai.google.dev/gemini-api/docs/pricing',tier:'paid-standard'} as const;
export type ProviderUsage={inputTokens:number|null;outputTokens:number|null;thoughtTokens:number|null;totalTokens:number|null};
export type ProviderResult={rawText:string;usage:ProviderUsage;resolvedModel:string;httpStatus:number;attempts:number;finishReason?:string};
export type FeatureProviderAdapter={id:'gemini';model:string;generate(input:{prompt:string;maxOutputTokens:number;timeoutMs:number},key:string):Promise<ProviderResult>};
export const sha=(text:string)=>createHash('sha256').update(text).digest('hex');

// Gemini accepts a JSON Schema subset. Expand local references and replace const with enum.
function providerSchema(value:unknown,definitions=(featureSchema as { $defs:Record<string,unknown> }).$defs):unknown{
  if(Array.isArray(value))return value.map(x=>providerSchema(x,definitions));
  if(!value||typeof value!=='object')return value;
  const input=value as Record<string,unknown>;
  if(typeof input.$ref==='string')return providerSchema(definitions[input.$ref.split('/').at(-1)!],definitions);
  const output:Record<string,unknown>={};
  for(const [key,item] of Object.entries(input)){
    if(['$schema','$id','$defs','title','minLength'].includes(key))continue;
    if(key==='const'){output.enum=[item];continue;}
    output[key]=providerSchema(item,definitions);
  }
  return output;
}
export const featureResponseSchema=providerSchema(featureSchema);

export function buildFeaturePrompt(doc:ThermalDocument){
  const claim=doc.independentClaims[0];if(!claim?.trim())throw new Error('CLAIM_1_UNAVAILABLE');
  const identity={publicationNumber:doc.publicationNumber,documentHash:doc.contentHash,sourceUrl:doc.sourceUrl,claimNumber:'1',sourceLanguage:'en'};
  const prompt=[
    `Patent Feature Schema v1. Prompt ${FEATURE_PROMPT_VERSION}. Return one JSON object only, matching the provided JSON schema.`,
    'Extract only what Independent Claim 1 explicitly supports. Technical subject, elements, limitations, and element relationships are different fields. Do not infer an element, relationship, commercial application, equivalence or infringement.',
    'Every originalText and evidence.sourceSpan must be the same continuous, byte-for-byte substring of Claim 1. Every claim evidence uses section="claims", locator="Claim 1", and the exact publicationNumber, documentHash and sourceUrl below. Never omit device numbers, rewrite words or join distant spans.',
    'Use descriptionFindings: [] because no description is supplied. Set semanticSupport="not_assessed" on every relationship. Set extractionMode="llm_candidate", reviewStatus="draft", provenance="llm_candidate_unreviewed"; element confidenceStatus="llm_candidate".',
    'For an ambiguous number such as 105 Pa*s with potentially lost exponent formatting, preserve originalText and unit, use numericStatus="ambiguous", null numeric bounds, and list the exact span in unresolvedSpans. Never silently convert it to 10^5.',
    'For percentages, retain the exact referenceBasis. Preserve strict less-than with upperInclusive=false. An unsupported relationship belongs in unresolvedSpans rather than relationships. Report unparsed Claim 1 fragments in unresolvedSpans.',
    `Frozen identity: ${JSON.stringify(identity)}`,
    `Title (context only, not evidence): ${doc.title}`,
    `Independent Claim 1, exact text follows:\n${claim}`
  ].join('\n\n');
  return {prompt,promptHash:sha(prompt),identity,inputHash:sha(JSON.stringify({identity,claim,title:doc.title}))};
}
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
export function createGeminiFeatureAdapter(options:{model?:string;fetchImpl?:typeof fetch;maxRetries?:number}={}):FeatureProviderAdapter{
  const model=options.model??DEFAULT_FEATURE_MODEL;
  if(!/^gemini-[a-z0-9.-]{3,60}$/.test(model))throw new Error('INVALID_FEATURE_MODEL');
  const fetchImpl=options.fetchImpl??fetch,maxRetries=options.maxRetries??1;
  return {id:'gemini',model,async generate(input,key){
    if(!key)throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body={contents:[{role:'user',parts:[{text:input.prompt}]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:featureResponseSchema,maxOutputTokens:input.maxOutputTokens,temperature:0}};
    for(let attempt=0;attempt<=maxRetries;attempt++){
      let response:Response;
      try{response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(input.timeoutMs)});}
      catch{throw new Error('PROVIDER_TRANSPORT_UNKNOWN: request may have reached Gemini; automatic retry forbidden');}
      if(response.status===429&&attempt<maxRetries){await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**attempt,4000)));continue;}
      if(!response.ok){const code=response.status===401||response.status===403?'PROVIDER_AUTH':response.status===429?'PROVIDER_RATE_LIMIT':response.status>=500?'PROVIDER_UNAVAILABLE':'PROVIDER_REJECTED';throw new Error(`${code}: HTTP ${response.status}`);}
      let data:Record<string,unknown>;
      try{data=await response.json() as Record<string,unknown>;}catch{throw new Error('PROVIDER_INVALID_JSON_ENVELOPE');}
      const candidate=(data.candidates as Array<{content?:{parts?:Array<{text?:string}>};finishReason?:string}>|undefined)?.[0];
      const rawText=candidate?.content?.parts?.map(x=>x.text??'').join('')??'';
      if(!rawText)throw new Error('PROVIDER_INCOMPLETE_RESPONSE');
      const usage=data.usageMetadata as Record<string,unknown>|undefined;
      return {rawText,usage:{inputTokens:integer(usage?.promptTokenCount),outputTokens:integer(usage?.candidatesTokenCount),thoughtTokens:integer(usage?.thoughtsTokenCount),totalTokens:integer(usage?.totalTokenCount)},resolvedModel:typeof data.modelVersion==='string'?data.modelVersion:model,httpStatus:response.status,attempts:attempt+1,finishReason:candidate?.finishReason};
    }
    throw new Error('PROVIDER_RATE_LIMIT');
  }};
}
