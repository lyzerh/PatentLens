import { createHash } from "node:crypto";

export const THERMAL_DATASET = "smart-device-thermal-v1";
export const THERMAL_TAXONOMY = "thermal-two-axis-v1";
export const TECHNOLOGIES = ["Passive Cooling Structure", "Thermal Materials & Interfaces", "Temperature Sensing & Monitoring", "Active Cooling", "Software / Dynamic Thermal Control", "Power-Thermal Coordination", "Other", "Uncertain"] as const;
export const PRODUCTS = ["Smartphone", "Tablet", "Laptop", "Wearable", "Earbuds / Headphones", "Smart Device Accessory", "Cross-device / General Portable Electronics", "Non-smart-device", "Unknown"] as const;
export type Scope = "in_scope" | "boundary_case" | "out_of_scope" | "uncertain";
export type Evidence = { section: "title" | "abstract" | "claims" | "description"; sourceSpan: string; sourceUrl: string };
export type FieldProof = { sourceUrl: string; retrievedAt: string; status: "source_verified" | "missing"; missingReason: "source_not_provided" | null };
export type ThermalDocument = {
  publicationNumber: string; publicationVersion: string; title: string | null; applicant: string[]; priorityDate: string | null; publicationDate: string | null;
  abstract: string | null; independentClaims: string[]; description: string | null; cpc: string[]; ipc: string[]; sourceUrl: string; retrievedAt: string;
  fieldProvenance: Record<string, FieldProof>; technicalRelevance: boolean; potentialProductApplication: string[]; verifiedCommercialImplementation: "unknown";
  scope: Scope; detectedDeviceContext: string | null; thermalFunction: string | null; supportingSourceSpan: Evidence[]; classificationBasis: string[]; reviewStatus: "provisional_reference" | "unknown";
  primaryTechnologyCategory: string; secondaryTechnologyCategories: string[]; contentHash: string; discoveryQueries: string[];
};
export type SearchLog = { query: string; source: string; executedAt: string; returnedCount: number; hasNext: boolean; error: string | null };
export type ThermalDataset = { name: typeof THERMAL_DATASET; version: string; parentVersion?: string; taxonomyVersion: typeof THERMAL_TAXONOMY; frozen: true; frozenAt: string; searchLog: SearchLog[]; candidates: { publicationNumber: string; discoveryQueries: string[]; retrievalStatus: "ok" | "failed"; reason: string | null }[]; entries: ThermalDocument[]; datasetHash: string; classificationHash: string; selectionRule: string; goldCandidates: Record<string, { status: "provisional_reference" | "unknown"; scope: Scope; primaryTechnologyCategory: string; secondaryTechnologyCategories: string[]; productApplication: string[]; evidence: Evidence[]; reasons: string[] }> };
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const devices: [RegExp,string][] = [
  [/\b(?:smart\s?phone|cell(?:ular)? phone|mobile phone|mobile terminal)\b/i,"Smartphone"],
  [/\btablet (?:computer|device|pc)\b/i,"Tablet"],
  [/\b(?:laptop|notebook (?:computer|pc)|portable computer|mobile computing device|portable computing device)\b/i,"Laptop"],
  [/\b(?:smart\s?watch|wearable (?:electronic|computing) device)\b/i,"Wearable"],
  [/\b(?:earbud|headphone|headset|in-ear audio)\b/i,"Earbuds / Headphones"],
  [/\b(?:phone case|cooling case|docking sleeve|charging accessory)\b/i,"Smart Device Accessory"],
  [/\b(?:portable electronic (?:device|devices|apparatus)|handheld electronic devices?|handheld devices?|mobile devices?)\b/i,"Cross-device / General Portable Electronics"]
];
const excluded = /\b(?:automobile|automotive|motor vehicle|electric vehicle|vehicle battery|photovoltaic|solar collector|data cent(?:er|re)|server rack|industrial furnace|marx generator|turbine engine|hvac|air conditioning system)\b/i;
const thermal = /\b(?:heat[- ]dissipation|heat[- ]spread(?:er|ing)?|heat pipe|heat exchanger|vapor chamber|thermal management|thermal interface|thermal resistance|cooling|temperature sens(?:or|ing)|temperature control|thermally conduct(?:ive|ing)|thermal polic(?:y|ies)|thermal throttling|heat[- ]transfer|heat conduction|heat generating)\b/i;
const technologies: [RegExp,string][] = [
  [/\b(?:vapor chamber|heat pipe|heat spreader|radiation plate|heat[- ]dissipation structure|heat-transfer unit)\b/i,"Passive Cooling Structure"],
  [/\b(?:graphite|graphene|thermal interface material|thermal gel|phase change material|heat conduction area|thermally conductive (?:sheet|pad|layer))\b/i,"Thermal Materials & Interfaces"],
  [/\b(?:temperature sens(?:or|ing)|thermal sensor|temperature monitor)\b/i,"Temperature Sensing & Monitoring"],
  [/\b(?:fan|blower|pump|forced air|liquid cooling|immersion cooling|active cooling)\b/i,"Active Cooling"],
  [/\b(?:thermal polic(?:y|ies)|thermal throttling|dynamic thermal|thermal control|temperature control|cooling control)\b/i,"Software / Dynamic Thermal Control"],
  [/\b(?:power.?.?thermal|power supply|power consumption|clock frequency|processor performance|frequency scaling)\b/i,"Power-Thermal Coordination"]
];
function findEvidence(parts: { section: Evidence["section"]; text: string }[], re: RegExp, url: string): Evidence | null {
  for (const {section,text} of parts) { const m=re.exec(text); if(m) return {section,sourceSpan:text.slice(Math.max(0,m.index-60),Math.min(text.length,m.index+m[0].length+90)),sourceUrl:url}; }
  return null;
}
export function evidenceIsExact(doc: Pick<ThermalDocument,"title"|"abstract"|"independentClaims"|"description"|"sourceUrl">, e: Evidence): boolean {
  const text=e.section==="title"?doc.title:e.section==="abstract"?doc.abstract:e.section==="claims"?doc.independentClaims.join("\n\n"):doc.description;
  return Boolean(e.sourceUrl===doc.sourceUrl&&e.sourceSpan&&text?.includes(e.sourceSpan));
}
export function classifyThermal(doc: {title?:string|null;abstract?:string|null;independentClaims?:string[];description?:string|null;cpc?:string[];ipc?:string[];sourceUrl:string}) {
  const primary=[{section:"title" as const,text:doc.title??""},{section:"abstract" as const,text:doc.abstract??""},{section:"claims" as const,text:(doc.independentClaims??[]).join("\n\n")}], secondary=doc.description?[{section:"description" as const,text:doc.description}]:[];
  const heat=findEvidence(primary,thermal,doc.sourceUrl)??findEvidence(secondary,thermal,doc.sourceUrl);
  const direct=devices.map(([re,label])=>({label,evidence:findEvidence(primary,re,doc.sourceUrl)})).filter(x=>x.evidence);
  const indirect=direct.length?null:devices.map(([re,label])=>({label,evidence:findEvidence(secondary,re,doc.sourceUrl)})).find(x=>x.evidence)??null;
  const exclusion=findEvidence(primary,excluded,doc.sourceUrl);
  const primaryCats=technologies.map(([re,label])=>({label,evidence:findEvidence(primary,re,doc.sourceUrl)})).filter(x=>x.evidence);
  const cats=(primaryCats.length?primaryCats:technologies.map(([re,label])=>({label,evidence:findEvidence(secondary,re,doc.sourceUrl)})).filter(x=>x.evidence)).sort((a,b)=>{
    const rank=(e:Evidence|null)=>e?.section==="title"?0:e?.section==="claims"?1:e?.section==="abstract"?2:3;
    return rank(a.evidence)-rank(b.evidence);
  });
  const scope:Scope=!heat?"out_of_scope":direct.length?"in_scope":exclusion?"out_of_scope":indirect?"boundary_case":"uncertain";
  const rawEvidence=[heat,direct[0]?.evidence,indirect?.evidence,exclusion,cats[0]?.evidence].filter((x):x is Evidence=>Boolean(x));
  const supportingSourceSpan=rawEvidence.filter((e,i)=>rawEvidence.findIndex(x=>x.section===e.section&&x.sourceSpan===e.sourceSpan)===i);
  return {scope,technicalRelevance:Boolean(heat),potentialProductApplication:direct.length?[...new Set(direct.map(x=>x.label))]:indirect?[indirect.label]:scope==="out_of_scope"?["Non-smart-device"]:["Unknown"],verifiedCommercialImplementation:"unknown" as const,
    detectedDeviceContext:direct[0]?.label??indirect?.label??null,thermalFunction:heat?.sourceSpan??null,supportingSourceSpan,primaryTechnologyCategory:cats[0]?.label??(heat?"Other":"Uncertain"),secondaryTechnologyCategories:cats.slice(1).map(x=>x.label),
    classificationBasis:[heat?"source_text_thermal":"no_thermal_evidence",direct.length?"explicit_device_primary_text":indirect?"device_description_only":exclusion?"excluded_industry_primary_text":"device_not_confirmed",...(doc.cpc?.length||doc.ipc?.length?["official_classification_auxiliary"]:[])],reviewStatus:scope==="uncertain"||scope==="boundary_case"?"unknown" as const:"provisional_reference" as const};
}
export function createThermalDocument(patent: Record<string,unknown>, discoveryQueries: string[]):ThermalDocument {
  const id=String(patent.publicationNumber??""), sourceUrl=String(patent.sourceUrl??""), retrievedAt=String(patent.fetchedAt??"");
  const urlId=sourceUrl.match(/^https:\/\/data\.epo\.org\/publication-server\/rest\/v1\.2\/patents\/(EP\d+)NW([A-Z]\d{0,2})\/document\.xml$/);
  if(!/^EP\d{7,10}[A-Z]\d{0,2}$/.test(id)||!urlId||urlId[1]+urlId[2]!==id||!/^\d{4}-\d\d-\d\dT/.test(retrievedAt))throw new Error("需要编号及来源一致的 EPO 官方 XML");
  const claims=Array.isArray(patent.claims)?patent.claims.filter(c=>c&&typeof c==="object"&&String((c as {number?:unknown}).number)==="1").map(c=>String((c as {text?:unknown}).text??"")).filter(Boolean):[];
  const str=(x:unknown)=>typeof x==="string"&&x.trim()?x:null;
  const core={publicationNumber:id,publicationVersion:id.match(/[A-Z]\d{0,2}$/)?.[0]??"",title:str(patent.title),applicant:typeof patent.assignee==="string"?patent.assignee.split(";").map(x=>x.trim()).filter(Boolean):[],priorityDate:str(patent.priorityDate),publicationDate:str(patent.publicationDate),abstract:str(patent.abstract),independentClaims:claims,description:str(patent.description),cpc:Array.isArray(patent.cpc)?patent.cpc.map(String):[],ipc:Array.isArray(patent.ipc)?patent.ipc.map(String):[],sourceUrl,retrievedAt,discoveryQueries};
  const fieldProvenance=Object.fromEntries(Object.entries(core).filter(([k])=>!["description","discoveryQueries"].includes(k)).map(([k,v])=>[k,{sourceUrl,retrievedAt,status:v===null||Array.isArray(v)&&!v.length?"missing":"source_verified",missingReason:v===null||Array.isArray(v)&&!v.length?"source_not_provided":null}])) as ThermalDocument["fieldProvenance"];
  return {...core,fieldProvenance,...classifyThermal(core),contentHash:digest({publicationNumber:id,title:core.title,abstract:core.abstract,independentClaims:claims,description:core.description,cpc:core.cpc,ipc:core.ipc})};
}
export function freezeThermalDataset(entries:ThermalDocument[], searchLog:SearchLog[], candidates:ThermalDataset["candidates"], version=`${THERMAL_DATASET}-2026-10-24`, parentVersion?:string):ThermalDataset {
  if(new Set(entries.map(e=>e.publicationNumber)).size!==entries.length||entries.some(e=>e.supportingSourceSpan.some(s=>!evidenceIsExact(e,s))))throw new Error("文献去重或精确引文校验失败");
  const datasetHash=digest(entries.map(e=>({id:e.publicationNumber,hash:e.contentHash}))),classificationHash=digest(entries.map(e=>({id:e.publicationNumber,scope:e.scope,primary:e.primaryTechnologyCategory,secondary:e.secondaryTechnologyCategories,product:e.potentialProductApplication})));
  return {name:THERMAL_DATASET,version,...(parentVersion?{parentVersion}:{}),taxonomyVersion:THERMAL_TAXONOMY,frozen:true,frozenAt:new Date().toISOString(),searchLog,candidates,entries,datasetHash,classificationHash,selectionRule:"多检索式发现候选；仅收录 EPO 官方 XML 编号核对成功且含可审原文的文献。跨行业样本单独标记；不为配额强行入选。规则输出不是人工 Gold。",goldCandidates:Object.fromEntries(entries.map(e=>[e.publicationNumber,{status:e.reviewStatus,scope:e.scope,primaryTechnologyCategory:e.primaryTechnologyCategory,secondaryTechnologyCategories:e.secondaryTechnologyCategories,productApplication:e.potentialProductApplication,evidence:e.supportingSourceSpan,reasons:e.classificationBasis}]))};
}
export function validateFrozenThermalDataset(dataset:ThermalDataset):void {
  if(dataset.name!==THERMAL_DATASET||!dataset.frozen||new Set(dataset.entries.map(e=>e.publicationNumber)).size!==dataset.entries.length)throw new Error("专题数据集身份或去重检查失败");
  const input=digest(dataset.entries.map(e=>({id:e.publicationNumber,hash:e.contentHash})));
  const classification=digest(dataset.entries.map(e=>({id:e.publicationNumber,scope:e.scope,primary:e.primaryTechnologyCategory,secondary:e.secondaryTechnologyCategories,product:e.potentialProductApplication})));
  if(input!==dataset.datasetHash||classification!==dataset.classificationHash)throw new Error("专题数据集哈希不符");
  for(const e of dataset.entries){
    const match=e.publicationNumber.match(/^EP(\d{7,10})([A-Z]\d{0,2})$/);
    if(!match||e.sourceUrl!==`https://data.epo.org/publication-server/rest/v1.2/patents/EP${match[1]}NW${match[2]}/document.xml`||!/^\d{4}-\d\d-\d\dT/.test(e.retrievedAt))throw new Error("专题来源与公开版本不符："+e.publicationNumber);
    if(digest({publicationNumber:e.publicationNumber,title:e.title,abstract:e.abstract,independentClaims:e.independentClaims,description:e.description,cpc:e.cpc,ipc:e.ipc})!==e.contentHash||e.supportingSourceSpan.some(s=>!evidenceIsExact(e,s)))throw new Error("专题原文哈希或引文不符："+e.publicationNumber);
  }
}
export function thermalPortfolio(dataset:ThermalDataset) {
  const all=dataset.entries,included=all.filter(e=>e.scope==="in_scope"),count=(values:string[])=>Object.fromEntries([...new Set(values)].sort().map(v=>[v,values.filter(x=>x===v).length]));
  return {sampleSize:all.length,inScope:included.length,boundaryCases:all.filter(e=>e.scope==="boundary_case").length,outOfScopeExcluded:all.filter(e=>e.scope==="out_of_scope").length,uncertain:all.filter(e=>e.scope==="uncertain").length,technology:count(included.map(e=>e.primaryTechnologyCategory)),productApplication:count(included.flatMap(e=>e.potentialProductApplication)),applicants:count(included.flatMap(e=>e.applicant)),publicationYears:count(included.map(e=>e.publicationDate?.slice(0,4)??"Unknown")),jurisdictions:count(included.map(e=>e.publicationNumber.slice(0,2))),sourceStatus:count(all.flatMap(e=>Object.values(e.fieldProvenance).map(f=>f.status))),datasetVersion:dataset.version,datasetHash:dataset.datasetHash,searchScope:"EPO EP 出版物小样本；不代表全球行业份额",classificationScope:THERMAL_TAXONOMY,statisticDate:new Date().toISOString().slice(0,10)};
}
export function thermalMock(dataset:ThermalDataset) {return {mode:"mock",datasetVersion:dataset.version,datasetHash:dataset.datasetHash,realApiCalls:0,accuracy:"unavailable",rows:dataset.entries.map(e=>({publicationNumber:e.publicationNumber,inputHash:e.contentHash,A:{scope:e.scope,technology:e.primaryTechnologyCategory,product:e.potentialProductApplication},B:{inputHash:e.contentHash,output:"MOCK_NOT_MODEL"},C:{inputHash:e.contentHash,schemaValid:true,evidence:e.supportingSourceSpan},D:{inputHash:e.contentHash,reusesC:true,evidenceValid:e.supportingSourceSpan.every(s=>evidenceIsExact(e,s))}}))};}
