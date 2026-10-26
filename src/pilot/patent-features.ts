import {readFile,mkdir,open,rename,unlink,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Ajv2020} from 'ajv/dist/2020.js';
import featureSchema from '../../schemas/patent-feature-v1.schema.json' with {type:'json'};
import {validateFrozenThermalDataset,type ThermalDataset,type ThermalDocument} from './thermal.ts';

export const FEATURE_SCHEMA_VERSION='patent-feature-v1';
export const SUBJECT_TYPES=['Product','Material / Composition','Apparatus','System','Method','Other / Unknown'] as const;
export const LIMITATION_TYPES=['Material Constraint','Composition Ratio','Numerical Range','Structural Limitation','Functional Limitation','Process Step','Other'] as const;
export const RELATION_TYPES=['contains','connected_to','positioned_between','thermally_coupled_to','controls','other'] as const;
const schemaCheck=new Ajv2020({allErrors:true}).compile(featureSchema);
export type Section='claims'|'description'|'title'|'abstract';
export type FeatureEvidence={section:Section;sourceSpan:string;sourceUrl:string;documentHash:string;locator:string};
export type FeatureElement={elementId:string;elementName:string;elementType:string;originalText:string;evidence:FeatureEvidence;confidenceStatus:'rule_candidate'|'llm_candidate'|'human_reviewed'|'unknown'};
export type FeatureLimitation={limitationId:string;limitationType:typeof LIMITATION_TYPES[number];originalText:string;modifiesElementId:string|null;lowerBound:number|null;upperBound:number|null;unit:string|null;lowerInclusive:boolean|null;upperInclusive:boolean|null;referenceBasis:string|null;numericStatus:'parsed'|'ambiguous'|'not_numeric';evidence:FeatureEvidence};
export type FeatureRelation={relationId:string;relationType:typeof RELATION_TYPES[number];fromElementId:string;toElementId:string;originalText:string;evidence:FeatureEvidence;semanticSupport:'not_assessed'|'supported'|'unsupported'};
export type DescriptionFinding={findingId:string;kind:'technical_problem'|'proposed_solution'|'described_effect'|'application_context';text:string;evidence:FeatureEvidence;claimLimitation:false;semanticSupport:'not_assessed'|'supported'|'unsupported'};
export type FeatureCandidate={schemaVersion:typeof FEATURE_SCHEMA_VERSION;identity:{publicationNumber:string;documentHash:string;sourceUrl:string;claimNumber:'1';sourceLanguage:string};technicalSubject:{type:typeof SUBJECT_TYPES[number];originalText:string;evidence:FeatureEvidence};elements:FeatureElement[];limitations:FeatureLimitation[];relationships:FeatureRelation[];descriptionFindings:DescriptionFinding[];unresolvedSpans:{sourceSpan:string;reason:string}[];extractionMode:'rules'|'mock_llm'|'llm_candidate';reviewStatus:'draft'|'reviewed';provenance:string};
export type Diagnostic={dimension:'schema'|'source_exact'|'numeric_integrity'|'relation_consistency'|'semantic_support'|'coverage';code:string;path:string;pass:boolean;detail:string};
const evidence=(doc:ThermalDocument,section:Section,sourceSpan:string):FeatureEvidence=>({section,sourceSpan,sourceUrl:doc.sourceUrl,documentHash:doc.contentHash,locator:section==='claims'?'Claim 1':section==='description'?descriptionLocator(doc.description??'',sourceSpan):section});
const descriptionLocator=(text:string,span:string)=>{const offset=text.indexOf(span);const markers=[...text.slice(0,Math.max(0,offset)).matchAll(/\[(\d{4})\]/g)];return markers.length?`Description [${markers.at(-1)![1]}] offset ${offset}`:`Description offset ${offset}`;};
const claimText=(doc:ThermalDocument)=>doc.independentClaims[0]??'';
const sectionText=(doc:ThermalDocument,section:Section)=>section==='claims'?claimText(doc):section==='description'?doc.description??'':section==='title'?doc.title??'':doc.abstract??'';
const asObject=(x:unknown):x is Record<string,unknown>=>Boolean(x)&&typeof x==='object'&&!Array.isArray(x);
const isOneOf=(value:unknown,items:readonly string[])=>typeof value==='string'&&items.includes(value);
const segments=(claim:string)=>claim.split(/;\s*\n?|\n(?=wherein\b)/i).map(x=>x.trim()).filter(Boolean);

function numericLimitations(doc:ThermalDocument,parts:string[],elements:FeatureElement[]):FeatureLimitation[]{
  const result:FeatureLimitation[]=[];
  const add=(segment:string,span:string,type:FeatureLimitation['limitationType'],elementId:string|null,lower:number|null,upper:number|null,unit:string|null,lowInclusive:boolean|null,highInclusive:boolean|null,basis:string|null,status:FeatureLimitation['numericStatus'])=>result.push({limitationId:`L-${String(result.length+1).padStart(3,'0')}`,limitationType:type,originalText:span,modifiesElementId:elementId,lowerBound:lower,upperBound:upper,unit,lowerInclusive:lowInclusive,upperInclusive:highInclusive,referenceBasis:basis,numericStatus:status,evidence:evidence(doc,'claims',span)});
  const idFor=(name:string)=>elements.find(x=>x.elementName===name)?.elementId??null;
  for(const segment of parts){
    if(/non-silicone/i.test(segment)&&!result.some(x=>x.originalText==='non-silicone resin')){const span=segment.match(/non-silicone resin/i)?.[0];if(span)add(segment,span,'Material Constraint',idFor('resin'),null,null,null,null,null,null,'not_numeric');}
    const ratio=segment.match(/between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)\s+percent by weight of the ([^;,\n]+)/i);
    if(ratio)add(segment,ratio[0],'Composition Ratio',idFor('plasticizer'),Number(ratio[1]),Number(ratio[2]),'percent by weight',true,true,ratio[3].trim(),'parsed');
    const particle=segment.match(/particle size of less than\s+(\d+(?:\.\d+)?)\s*(µm|μm|um)/i);
    if(particle)add(segment,particle[0],'Numerical Range',idFor('particulate filler'),null,Number(particle[1]),particle[2],null,false,null,'parsed');
    const wettable=segment.match(/particulate filler wettable by the plasticizer/i);
    if(wettable)add(segment,wettable[0],'Functional Limitation',idFor('particulate filler'),null,null,null,null,null,null,'not_numeric');
    for(const [pattern,name,unitPattern] of [
      [/thermal impedance of less than\s+(\d+(?:\.\d+)?)\s*(°C\s*\*\s*cm2\/W)/i,'thermal interface material',true],
      [/melting point of between\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)\s*(°C)/i,'thermal interface material',true],
      [/melt viscosity of less than\s+(\d+(?:\.\d+)?)\s*(Pa\*s)/i,'thermal interface material',true]
    ] as const){const m=segment.match(pattern);if(!m)continue;const between=m.length===4,rawNumber=m[1];const ambiguous=name==='thermal interface material'&&m[0].includes('viscosity')&&/^10[0-9]+$/.test(rawNumber);
      add(segment,m[0],'Numerical Range',idFor(name),between?Number(m[1]):null,ambiguous?null:Number(between?m[2]:m[1]),m[between?3:2],between?true:null,ambiguous?null:between?true:false,null,ambiguous?'ambiguous':'parsed');
    }
  }
  return result;
}

export function extractRuleFeatures(doc:ThermalDocument):FeatureCandidate {
  const claim=claimText(doc);if(!claim)throw new Error('CLAIM_1_UNAVAILABLE');
  const parts=segments(claim),head=parts[0]??claim;
  const subjectType:FeatureCandidate['technicalSubject']['type']=/\bmaterial\b|\bcomposition\b/i.test(head)?'Material / Composition':/\bmethod\b/i.test(head)?'Method':/\bsystem\b/i.test(head)?'System':/\bapparatus\b|\bdevice\b/i.test(head)?'Apparatus':'Other / Unknown';
  const specs:[string,RegExp,string][]=[['resin',/\b(?:non-silicone\s+)?resin\b/i,'material'],['phase change material',/\bphase change material\b/i,'material'],['plasticizer',/\bplasticizer\b/i,'material'],['elastomeric agent',/\belastomeric agent\b/i,'material'],['particulate filler',/\b(?:thermally conductive\s+)?particulate filler\b/i,'material'],['vapor chamber',/\bvapou?r chamber\b/i,'component'],['heat pipe',/\bheat pipe\b/i,'component'],['cooling fan',/\b(?:cooling\s+)?fan\b/i,'component'],['temperature sensor',/\btemperature sensor\b/i,'sensor'],['controller',/\bcontroller\b/i,'controller']];
  const elements:FeatureElement[]=[];
  for(const [name,re,type] of specs){const match=re.exec(claim);if(!match)continue;const part=parts.find(x=>x.includes(match[0]))??match[0];elements.push({elementId:`E-${String(elements.length+1).padStart(3,'0')}`,elementName:name,elementType:type,originalText:match[0],evidence:evidence(doc,'claims',match[0]),confidenceStatus:'rule_candidate'});}
  const limitations=numericLimitations(doc,parts,elements);
  const relationships:FeatureRelation[]=[];
  const resin=elements.find(x=>x.elementName==='resin'),phase=elements.find(x=>x.elementName==='phase change material');
  const resinPhrase=claim.match(/non-silicone resin comprising a phase change material/i);
  if(resin&&phase&&resinPhrase)relationships.push({relationId:'R-001',relationType:'contains',fromElementId:resin.elementId,toElementId:phase.elementId,originalText:resinPhrase[0],evidence:evidence(doc,'claims',resinPhrase[0]),semanticSupport:'not_assessed'});
  const filler=elements.find(x=>x.elementName==='particulate filler'),plasticizer=elements.find(x=>x.elementName==='plasticizer');
  const wettablePhrase=claim.match(/particulate filler wettable by the plasticizer/i);
  if(filler&&plasticizer&&wettablePhrase)relationships.push({relationId:`R-${String(relationships.length+1).padStart(3,'0')}`,relationType:'other',fromElementId:filler.elementId,toElementId:plasticizer.elementId,originalText:wettablePhrase[0],evidence:evidence(doc,'claims',wettablePhrase[0]),semanticSupport:'not_assessed'});
  const sensor=elements.find(x=>x.elementName==='temperature sensor'),controller=elements.find(x=>x.elementName==='controller');
  const sensorConnection=claim.match(/temperature sensor connected to (?:a |the )?controller/i);
  if(sensor&&controller&&sensorConnection)relationships.push({relationId:`R-${String(relationships.length+1).padStart(3,'0')}`,relationType:'connected_to',fromElementId:sensor.elementId,toElementId:controller.elementId,originalText:sensorConnection[0],evidence:evidence(doc,'claims',sensorConnection[0]),semanticSupport:'not_assessed'});
  const descriptionFindings:DescriptionFinding[]=[];
  const description=doc.description??'';
  for(const [kind,re] of [
    ['technical_problem',/conventional compositions often are unable to provide the very low thermal impedance needed for high performance applications/i],
    ['proposed_solution',/A thermal interface material of the present invention is effective in transferring the heat generated by the electronic devices/i],
    ['described_effect',/exhibits low thermal impedance and desirable rheological properties to provide thin bond lines/i],
    ['application_context',/electronic package 10 may be employed to support various functions in a cellular communication device/i]
  ] as const){const match=description.match(re);if(match)descriptionFindings.push({findingId:`D-${String(descriptionFindings.length+1).padStart(3,'0')}`,kind,text:match[0],evidence:evidence(doc,'description',match[0]),claimLimitation:false,semanticSupport:'not_assessed'});}
  const used=limitations.map(x=>x.originalText);
  const unresolvedSpans=parts.filter(part=>!elements.some(x=>part.includes(x.originalText))&&!used.some(x=>part.includes(x))).map(sourceSpan=>({sourceSpan,reason:'No reliable rule recognized a technical element or limitation.'}));
  if(/melt viscosity of less than 10[0-9]+\s*Pa\*s/i.test(claim))unresolvedSpans.push({sourceSpan:claim.match(/melt viscosity of less than 10[0-9]+\s*Pa\*s/i)![0],reason:'Source may have lost exponent formatting; numeric bound intentionally unresolved.'});
  return {schemaVersion:FEATURE_SCHEMA_VERSION,identity:{publicationNumber:doc.publicationNumber,documentHash:doc.contentHash,sourceUrl:doc.sourceUrl,claimNumber:'1',sourceLanguage:'en'},technicalSubject:{type:subjectType,originalText:head,evidence:evidence(doc,'claims',head)},elements,limitations,relationships,descriptionFindings,unresolvedSpans,extractionMode:'rules',reviewStatus:'draft',provenance:'deterministic_rule_candidate_not_gold'};
}

export function validateFeatureCandidate(raw:unknown,doc:ThermalDocument,allowHumanSemantic=false):{schemaValid:boolean;accepted:boolean;diagnostics:Diagnostic[];coverage:{recognized:number;total:number;unresolved:number}}{
  const out:Diagnostic[]=[];const push=(dimension:Diagnostic['dimension'],code:string,path:string,pass:boolean,detail:string)=>out.push({dimension,code,path,pass,detail});
  if(!asObject(raw)){push('schema','INVALID_ROOT','$',false,'Expected object');return {schemaValid:false,accepted:false,diagnostics:out,coverage:{recognized:0,total:0,unresolved:0}};}
  const identity=raw.identity;
  const identityOk=asObject(identity)&&raw.schemaVersion===FEATURE_SCHEMA_VERSION&&identity.publicationNumber===doc.publicationNumber&&identity.documentHash===doc.contentHash&&identity.sourceUrl===doc.sourceUrl&&identity.claimNumber==='1'&&typeof identity.sourceLanguage==='string';
  const lists=['elements','limitations','relationships','descriptionFindings','unresolvedSpans'].every(k=>Array.isArray(raw[k])&&raw[k].length<=200);
  const subject=raw.technicalSubject;
  const jsonSchemaValid=schemaCheck(raw);
  const schemaValid=Boolean(identityOk&&lists&&jsonSchemaValid&&asObject(subject)&&isOneOf(subject.type,SUBJECT_TYPES)&&isOneOf(raw.extractionMode,['rules','mock_llm','llm_candidate'])&&isOneOf(raw.reviewStatus,['draft','reviewed']));
  push('schema','SCHEMA_V1','$',schemaValid,schemaValid?'JSON Schema v1 and frozen identity valid':`Invalid schema or frozen identity: ${schemaCheck.errors?.map(e=>e.instancePath+' '+e.message).slice(0,3).join('; ')??'identity mismatch'}`);
  if(!schemaValid)return {schemaValid:false,accepted:false,diagnostics:out,coverage:{recognized:0,total:0,unresolved:0}};
  const candidate=raw as FeatureCandidate;
  const checkEvidence=(ev:unknown,path:string,expected:Section)=>{const valid=asObject(ev)&&ev.section===expected&&ev.documentHash===doc.contentHash&&ev.sourceUrl===doc.sourceUrl&&typeof ev.sourceSpan==='string'&&ev.sourceSpan.length>0&&sectionText(doc,expected).includes(ev.sourceSpan);
    push('source_exact','EXACT_SOURCE',path,Boolean(valid),valid?'Exact source and identity match':'Span, section, hash or URL differs from frozen source');return Boolean(valid);};
  checkEvidence(candidate.technicalSubject.evidence,'technicalSubject.evidence','claims');
  push('schema','SUBJECT_TEXT','technicalSubject.originalText',candidate.technicalSubject.originalText===candidate.technicalSubject.evidence?.sourceSpan,'Subject text must equal cited Claim 1 span');
  const ids=new Set<string>();
  for(const [i,x] of candidate.elements.entries()){const valid=asObject(x)&&typeof x.elementId==='string'&&!ids.has(x.elementId)&&typeof x.elementName==='string'&&typeof x.elementType==='string'&&typeof x.originalText==='string'&&isOneOf(x.confidenceStatus,['rule_candidate','llm_candidate','human_reviewed','unknown']);
    push('schema','ELEMENT',`elements[${i}]`,Boolean(valid),valid?'Element shape valid':'Invalid or duplicate element');if(valid)ids.add(x.elementId);checkEvidence(x?.evidence,`elements[${i}].evidence`,'claims');push('source_exact','ELEMENT_TEXT',`elements[${i}].originalText`,x?.originalText===x?.evidence?.sourceSpan,'Element text must equal cited Claim 1 span');}
  for(const [i,x] of candidate.limitations.entries()){
    const shape=asObject(x)&&typeof x.limitationId==='string'&&isOneOf(x.limitationType,LIMITATION_TYPES)&&typeof x.originalText==='string'&&isOneOf(x.numericStatus,['parsed','ambiguous','not_numeric'])&&(!x.modifiesElementId||ids.has(x.modifiesElementId));
    push('schema','LIMITATION',`limitations[${i}]`,Boolean(shape),shape?'Limitation shape and element reference valid':'Invalid limitation or element reference');checkEvidence(x?.evidence,`limitations[${i}].evidence`,'claims');
    if(!shape)continue;
    const rawSpan=x.originalText,evSpan=(x.evidence as FeatureEvidence).sourceSpan;
    const exact=evSpan===rawSpan;push('numeric_integrity','LIMITATION_SPAN',`limitations[${i}]`,exact,exact?'Numeric/source expression preserved':'Original expression differs from its evidence');
    if(x.numericStatus==='ambiguous'){push('numeric_integrity','AMBIGUOUS_NUMERIC',`limitations[${i}]`,x.lowerBound===null&&x.upperBound===null,'Ambiguous encoded bound must remain unresolved');continue;}
    if(x.numericStatus==='not_numeric')continue;
    const numericPhrase=rawSpan.split(/percent by weight|µm|μm|um|°C|Pa\*s/i)[0];
    const nums=[...numericPhrase.matchAll(/\d+(?:\.\d+)?/g)].map(m=>Number(m[0]));
    const bounds=[x.lowerBound,x.upperBound].filter((n):n is number=>typeof n==='number');
    const numbersOk=bounds.every(n=>nums.includes(n))&&bounds.length>0&&(!bounds.length||x.lowerBound===null||x.upperBound===null||x.lowerBound<=x.upperBound);
    const unitOk=typeof x.unit==='string'&&rawSpan.includes(x.unit);
    const basisOk=x.limitationType!=='Composition Ratio'||typeof x.referenceBasis==='string'&&rawSpan.includes(x.referenceBasis)&&/percent by weight/i.test(rawSpan);
    const inclusivityOk=/less than/i.test(rawSpan)?x.upperInclusive===false:/between/i.test(rawSpan)?x.lowerInclusive===true&&x.upperInclusive===true:true;
    push('numeric_integrity','NUMERIC_VALUE_UNIT_BASIS',`limitations[${i}]`,numbersOk&&unitOk&&basisOk&&inclusivityOk,numbersOk&&unitOk&&basisOk&&inclusivityOk?'Numbers, unit, endpoints and ratio basis preserved':'Numeric bound, unit, endpoint or reference basis differs from source');
  }
  for(const [i,x] of candidate.relationships.entries()){const semanticOk=x?.semanticSupport==='not_assessed'||allowHumanSemantic&&isOneOf(x?.semanticSupport,['supported','unsupported']);const valid=asObject(x)&&typeof x.relationId==='string'&&isOneOf(x.relationType,RELATION_TYPES)&&ids.has(x.fromElementId as string)&&ids.has(x.toElementId as string)&&x.fromElementId!==x.toElementId&&semanticOk;
    push('relation_consistency','ELEMENT_REFERENCES',`relationships[${i}]`,Boolean(valid),valid?'Endpoints exist; semantic support remains unassessed':'Invalid endpoints or unverified semantic assertion');checkEvidence(x?.evidence,`relationships[${i}].evidence`,'claims');push('source_exact','RELATION_TEXT',`relationships[${i}].originalText`,x?.originalText===x?.evidence?.sourceSpan,'Relation phrase must equal cited Claim 1 span');}
  for(const [i,x] of candidate.descriptionFindings.entries()){const semanticOk=x?.semanticSupport==='not_assessed'||allowHumanSemantic&&isOneOf(x?.semanticSupport,['supported','unsupported']);const valid=asObject(x)&&isOneOf(x.kind,['technical_problem','proposed_solution','described_effect','application_context'])&&x.claimLimitation===false&&semanticOk;push('schema','DESCRIPTION_FINDING',`descriptionFindings[${i}]`,Boolean(valid),valid?'Description kept separate from claim':'Invalid finding or claim/description conflation');checkEvidence(x?.evidence,`descriptionFindings[${i}].evidence`,'description');push('source_exact','FINDING_TEXT',`descriptionFindings[${i}].text`,x?.text===x?.evidence?.sourceSpan,'Finding text must equal cited description span');}
  const partList=segments(claimText(doc));let recognized=0;
  for(const part of partList){const covered=[...candidate.elements.map(x=>x.evidence?.sourceSpan),...candidate.limitations.map(x=>x.evidence?.sourceSpan),...candidate.relationships.map(x=>x.evidence?.sourceSpan)].some(span=>typeof span==='string'&&part.includes(span));
    const declared=candidate.unresolvedSpans.some(x=>x.sourceSpan===part);if(covered)recognized++;if(!covered&&!declared)push('coverage','UNREPORTED_GAP','unresolvedSpans',false,`Unreported Claim 1 segment: ${part.slice(0,100)}`);
  }
  for(const [i,x] of candidate.unresolvedSpans.entries())push('coverage','UNRESOLVED_SPAN',`unresolvedSpans[${i}]`,typeof x.sourceSpan==='string'&&claimText(doc).includes(x.sourceSpan)&&typeof x.reason==='string'&&Boolean(x.reason),'Unresolved content explicitly retained');
  const humanFlags=[...candidate.relationships,...candidate.descriptionFindings].some(x=>x.semanticSupport!=='not_assessed');
  push('semantic_support',humanFlags?'HUMAN_FLAG_NOT_INDEPENDENTLY_VERIFIED':'NOT_ASSESSED','$',true,humanFlags?'A reviewer marked semantic support; the validator does not independently prove it':'Exact source matching does not establish technical meaning; human review required');
  const coverage={recognized,total:partList.length,unresolved:candidate.unresolvedSpans.length};
  const finalSchemaValid=out.filter(x=>x.dimension==='schema').every(x=>x.pass);
  return {schemaValid:finalSchemaValid,accepted:out.every(x=>x.pass),diagnostics:out,coverage};
}

export interface FeatureProvider { readonly mode:'mock_llm'|'llm_candidate'; extract(doc:ThermalDocument):Promise<FeatureCandidate> }
export const mockFeatureProvider:FeatureProvider={mode:'mock_llm',async extract(doc){return {...extractRuleFeatures(doc),extractionMode:'mock_llm',provenance:'synthetic_mock_provider_no_network'};}};
export const disabledLlmFeatureProvider:FeatureProvider={mode:'llm_candidate',async extract(){throw new Error('PAID_FEATURE_EXTRACTION_DISABLED: requires a separately authorized server flow');}};

type Stored={recordId:string;publicationNumber:string;documentHash:string;createdAt:string;updatedAt:string;machineOutput:FeatureCandidate;machineValidation:ReturnType<typeof validateFeatureCandidate>;revisions:{revisionId:string;at:string;reviewer:string;status:'draft'|'reviewed';candidate:FeatureCandidate;validation:ReturnType<typeof validateFeatureCandidate>}[]};
type State={schemaVersion:typeof FEATURE_SCHEMA_VERSION;records:Record<string,Stored>};
export function createPatentFeatureService(options:{datasetPath?:string;storePath?:string;provider?:FeatureProvider}={}){
  const datasetPath=options.datasetPath??process.env.PATENT_THERMAL_DATA??fileURLToPath(new URL('../../data/smart-device-thermal-v1.3.json',import.meta.url));
  const storePath=options.storePath??process.env.PATENT_FEATURE_STORE??fileURLToPath(new URL('../../data/patent-features-v1/state.json',import.meta.url));
  let queue:Promise<unknown>=Promise.resolve();
  const dataset=async()=>{const d=JSON.parse(await readFile(datasetPath,'utf8')) as ThermalDataset;validateFrozenThermalDataset(d);return d;};
  const document=async(id:unknown)=>{if(typeof id!=='string'||!/^EP\d{7,10}[A-Z]\d{1,2}$/.test(id))throw new Error('INVALID_PUBLICATION_NUMBER');const d=await dataset(),doc=d.entries.find(x=>x.publicationNumber===id);if(!doc)throw new Error('DOCUMENT_NOT_IN_FROZEN_DATASET');return doc;};
  const read=async():Promise<State>=>{try{const state=JSON.parse(await readFile(storePath,'utf8')) as State;if(state.schemaVersion!==FEATURE_SCHEMA_VERSION)throw new Error('FEATURE_STORE_VERSION_CONFLICT');return state;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {schemaVersion:FEATURE_SCHEMA_VERSION,records:{}};throw e;}};
  const write=async(state:State)=>{await mkdir(dirname(storePath),{recursive:true});const tmp=storePath+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(state,null,2),{flag:'wx',mode:0o600});await rename(tmp,storePath);}catch(e){await unlink(tmp).catch(()=>{});throw e;}};
  const saveLocked=async(work:(state:State)=>Promise<Stored>)=>{const job=queue.then(async()=>{await mkdir(dirname(storePath),{recursive:true});const lock=storePath+'.lock',file=await open(lock,'wx',0o600);try{const state=await read();const record=await work(state);await write(state);return record;}finally{await file.close();await unlink(lock);}});queue=job.catch(()=>undefined);return job;};
  const list=async()=>{const d=await dataset();return {schemaVersion:FEATURE_SCHEMA_VERSION,items:d.entries.map(x=>({publicationNumber:x.publicationNumber,title:x.title,documentHash:x.contentHash,hasClaim1:Boolean(claimText(x)),sourceUrl:x.sourceUrl}))};};
  const source=async(id:unknown)=>{const doc=await document(id);return {publicationNumber:doc.publicationNumber,documentHash:doc.contentHash,sourceUrl:doc.sourceUrl,claim1:claimText(doc),description:doc.description,descriptionCompleteness:'not_certified_full_text'};};
  const extract=async(id:unknown,mode:'rules'|'mock_llm'='rules')=>{if(!['rules','mock_llm'].includes(mode))throw new Error('PAID_FEATURE_EXTRACTION_DISABLED');const doc=await document(id);const candidate=mode==='rules'?extractRuleFeatures(doc):await (options.provider??mockFeatureProvider).extract(doc);const validation=validateFeatureCandidate(candidate,doc);return {candidate,validation};};
  const create=async(id:unknown,mode:'rules'|'mock_llm'='rules')=>{const doc=await document(id);const output=await extract(id,mode);if(!output.validation.accepted)throw new Error('FEATURE_VALIDATION_FAILED');return saveLocked(async state=>{if(state.records[doc.publicationNumber])throw new Error('FEATURE_RECORD_ALREADY_EXISTS');const now=new Date().toISOString();const record:Stored={recordId:randomUUID(),publicationNumber:doc.publicationNumber,documentHash:doc.contentHash,createdAt:now,updatedAt:now,machineOutput:output.candidate,machineValidation:output.validation,revisions:[]};state.records[doc.publicationNumber]=record;return record;});};
  const load=async(id:unknown)=>{const doc=await document(id),state=await read(),record=state.records[doc.publicationNumber];if(record&&record.documentHash!==doc.contentHash)throw new Error('FEATURE_DOCUMENT_HASH_CONFLICT');return record??null;};
  const saveReview=async(id:unknown,recordId:unknown,reviewer:unknown,status:unknown,candidate:unknown)=>{const doc=await document(id);if(typeof reviewer!=='string'||!reviewer.trim()||reviewer.length>100)throw new Error('REVIEWER_REQUIRED');if(!isOneOf(status,['draft','reviewed'])||!asObject(candidate)||candidate.reviewStatus!==status)throw new Error('INVALID_REVIEW_STATUS');const validation=validateFeatureCandidate(candidate,doc,true);if(!validation.accepted)throw new Error('FEATURE_VALIDATION_FAILED: '+validation.diagnostics.filter(x=>!x.pass).map(x=>x.code+' at '+x.path).join(', '));return saveLocked(async state=>{const record=state.records[doc.publicationNumber];if(!record||record.recordId!==recordId||record.documentHash!==doc.contentHash)throw new Error('FEATURE_RECORD_VERSION_CONFLICT');if(candidate.extractionMode!==record.machineOutput.extractionMode||candidate.provenance!==record.machineOutput.provenance)throw new Error('FEATURE_PROVENANCE_CONFLICT');const now=new Date().toISOString();record.revisions.push({revisionId:randomUUID(),at:now,reviewer:reviewer.trim(),status:status as 'draft'|'reviewed',candidate:candidate as FeatureCandidate,validation});record.updatedAt=now;return record;});};
  const exportRecord=async(id:unknown)=>{const record=await load(id);if(!record)throw new Error('FEATURE_RECORD_NOT_FOUND');const current=record.revisions.at(-1)?.candidate??record.machineOutput;const lines=[`# ${record.publicationNumber} — Technical Feature Candidate`,'',`Schema: ${FEATURE_SCHEMA_VERSION}`,`Status: ${record.revisions.at(-1)?.status??'machine draft'}`,`Document hash: ${record.documentHash}`,'','## Technical subject',current.technicalSubject.type,'','## Elements',...current.elements.map(x=>`- ${x.elementId} ${x.elementName}: ${x.originalText}`),'','## Limitations',...current.limitations.map(x=>`- ${x.limitationId} ${x.limitationType}: ${x.originalText} [${x.numericStatus}]`),'','## Relationships',...current.relationships.map(x=>`- ${x.fromElementId} ${x.relationType} ${x.toElementId}: ${x.originalText}`),'','## Unresolved',...current.unresolvedSpans.map(x=>`- ${x.sourceSpan}: ${x.reason}`),'','Semantic support: not_assessed; not Verified Gold.'];return {json:record,markdown:lines.join('\n')};};
  return {list,source,extract,create,load,saveReview,exportRecord};
}
