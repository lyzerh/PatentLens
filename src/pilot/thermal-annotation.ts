import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateFrozenThermalDataset, type ThermalDataset, type ThermalDocument } from "./thermal.ts";

export const TAXONOMY_V2 = "enterprise-thermal-taxonomy-v2-draft";
export const REVIEW_IDS = ["EP3149425B1", "EP4498205A1", "EP4761489A1", "EP4015272B1", "EP4476289B1"] as const;
export const RELEVANCE = ["core_claimed", "explicit_application", "potential_application", "out_of_scope", "insufficient_evidence"] as const;
export const TIERS = ["Core Portfolio", "Extended Portfolio", "Candidate Pool", "Excluded", "Needs Review"] as const;
export const DIMENSIONS = ["technologyPrinciples", "technicalSolutions", "functionalObjectives"] as const;
export const DICTIONARY = {
  technologyPrinciples: [
    ["Heat Transfer", "Phase-change Heat Transfer"], ["Heat Transfer", "Thermal Conduction"], ["Heat Transfer", "Forced Convection"],
    ["Control", "Temperature Feedback Control"], ["", "Unknown"], ["", "Other"]
  ],
  technicalSolutions: [
    ["Passive Structure", "Vapor Chamber"], ["Passive Structure", "Heat Pipe"], ["Material & Interface", "Thermal Interface Material"],
    ["Active Hardware", "Cooling Fan"], ["Sensing", "Temperature Sensor"], ["Control Software", "Thermal Control Algorithm"],
    ["", "Unknown"], ["", "Other"]
  ],
  functionalObjectives: [
    ["Thermal Outcome", "Hotspot Reduction"], ["Thermal Outcome", "Temperature Uniformity"], ["Thermal Outcome", "Heat Dissipation Efficiency"],
    ["System Outcome", "Energy Consumption Control"], ["System Outcome", "Device Performance Stability"], ["", "Unknown"], ["", "Other"]
  ]
} as const;
export const EVIDENCE_LEVELS = ["claim", "embodiment", "general_description", "background_mention", "metadata", "analyst_inference"] as const;
export const SUPPORT_RELATIONS = ["supports", "contradicts", "context_only", "unverifiable"] as const;
export const SEMANTIC_SUPPORT = ["supported", "unsupported", "disputed", "not_assessed"] as const;
export const REVIEW_STATUSES = ["draft", "reviewed", "disputed", "insufficient_evidence"] as const;
const isObject = (x: unknown): x is Record<string,unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x);
const str = (x: unknown, max: number) => typeof x === "string" && x.length <= max;
const sectionText = (doc: ThermalDocument, section: string) =>
  section === "title" ? doc.title : section === "abstract" ? doc.abstract :
  section === "claims" ? doc.independentClaims.join("\n\n") : section === "description" ? doc.description : null;
const checkedDoc = (dataset: ThermalDataset, id: unknown) => {
  if (typeof id !== "string" || !REVIEW_IDS.includes(id as typeof REVIEW_IDS[number])) throw new Error("UNKNOWN_REVIEW_TASK");
  const doc = dataset.entries.find(x => x.publicationNumber === id);
  if (!doc) throw new Error("DOCUMENT_MISSING");
  return doc;
};
const draftKey = (id: string, reviewer: string) => id + ":" + reviewer;
type Label = { code: string; role: "primary"|"secondary"; claimRole: "claimed"|"ancillary"|"unknown"; basis: "explicit"|"inferred"|"unknown"; evidenceIds: string[] };
type Evidence = { evidenceId:string; publicationNumber:string; sourceUrl:string; documentHash:string; section:string; locator:string; sourceSpan:string; evidenceLevel:string; supportsFields:string[]; supportRelation:string; semanticSupport:string; reviewerRationale:string; exactMatch:true; sourceMatch:true };
type Annotation = { annotationId:string; publicationNumber:string; sourceUrl:string; documentHash:string; taxonomyVersion:string; reviewer:string; reviewStatus:string; reviewedAt:string|null; adjudicationStatus:"pending"; industryRelevance:string|null; portfolioTier:string|null; primaryTechnologyCategory:null; legacyMappingStatus:"not_mapped"; technologyPrinciples:Label[]; technicalSolutions:Label[]; functionalObjectives:Label[]; evidence:Evidence[]; annotationRationale:string; uncertaintyNotes:string; createdAt:string; updatedAt:string };
type State = { schemaVersion:"thermal-v2-annotation-pilot-1"; annotations:Record<string,Annotation>; audit:{eventId:string;annotationId:string;event:"created"|"updated"|"reviewed";at:string;reviewer:string;publicationNumber:string}[] };
const emptyState = ():State => ({ schemaVersion:"thermal-v2-annotation-pilot-1", annotations:{}, audit:[] });
function normalizeEvidence(doc:ThermalDocument, raw:unknown):Evidence {
  if (!isObject(raw) || !str(raw.evidenceId,80) || !raw.evidenceId ||
      !["title","abstract","claims","description"].includes(String(raw.section)) ||
      !str(raw.sourceSpan,2000) || !raw.sourceSpan ||
      !EVIDENCE_LEVELS.includes(raw.evidenceLevel as typeof EVIDENCE_LEVELS[number]) ||
      !SUPPORT_RELATIONS.includes(raw.supportRelation as typeof SUPPORT_RELATIONS[number]) ||
      !SEMANTIC_SUPPORT.includes(raw.semanticSupport as typeof SEMANTIC_SUPPORT[number]) ||
      !Array.isArray(raw.supportsFields) || !raw.supportsFields.length ||
      raw.supportsFields.some(x => !["industryRelevance",...DIMENSIONS].includes(x)) ||
      !str(raw.reviewerRationale,1000)) throw new Error("INVALID_EVIDENCE");
  if (raw.publicationNumber !== doc.publicationNumber || raw.documentHash !== doc.contentHash || raw.sourceUrl !== doc.sourceUrl) throw new Error("EVIDENCE_SOURCE_MISMATCH");
  if (raw.evidenceLevel === "claim" && raw.section !== "claims" ||
      ["embodiment","general_description","background_mention"].includes(String(raw.evidenceLevel)) && raw.section !== "description" ||
      raw.evidenceLevel === "metadata" && !["title","abstract"].includes(String(raw.section))) throw new Error("EVIDENCE_LEVEL_SECTION_MISMATCH");
  const text = sectionText(doc,String(raw.section));
  const offset = text?.indexOf(String(raw.sourceSpan)) ?? -1;
  if (offset < 0) throw new Error("EVIDENCE_NOT_EXACT");
  const claimIndex=raw.section==="claims"?doc.independentClaims.findIndex(x=>x.includes(String(raw.sourceSpan))):-1;
  if(raw.section==="claims"&&claimIndex<0)throw new Error("EVIDENCE_CROSSES_CLAIMS");
  let locator = raw.section === "claims" ? "Claim " + (claimIndex+1) : raw.section === "description" ? "Description offset " + offset : String(raw.section);
  if (raw.section === "description") {
    const before = text!.slice(0,offset), markers = [...before.matchAll(/\[(\d{4})\]/g)];
    if (markers.length) locator = "Description [" + markers.at(-1)![1] + "] offset " + offset;
  }
  return { evidenceId:String(raw.evidenceId), publicationNumber:doc.publicationNumber, sourceUrl:doc.sourceUrl, documentHash:doc.contentHash,
    section:String(raw.section), locator, sourceSpan:String(raw.sourceSpan), evidenceLevel:String(raw.evidenceLevel),
    supportsFields:[...new Set(raw.supportsFields as string[])], supportRelation:String(raw.supportRelation),
    semanticSupport:String(raw.semanticSupport), reviewerRationale:String(raw.reviewerRationale), exactMatch:true, sourceMatch:true };
}
function normalizeLabels(raw:unknown, dimension:typeof DIMENSIONS[number], evidence:Evidence[]):Label[] {
  if (!Array.isArray(raw) || raw.length > 12) throw new Error("INVALID_LABELS");
  const allowed = DICTIONARY[dimension].map(x => x[1]);
  const labels = raw.map((x):Label => {
    if (!isObject(x) || !allowed.includes(x.code as never) || !["primary","secondary"].includes(String(x.role)) ||
      !["claimed","ancillary","unknown"].includes(String(x.claimRole)) || !["explicit","inferred","unknown"].includes(String(x.basis)) ||
      !Array.isArray(x.evidenceIds) || x.evidenceIds.some(id => typeof id !== "string" || !evidence.some(e => e.evidenceId === id && e.supportsFields.includes(dimension)))) throw new Error("INVALID_LABEL_BINDING");
    if (x.code === "Unknown" && (x.basis !== "unknown" || x.claimRole !== "unknown")) throw new Error("UNKNOWN_LABEL_CONFLICT");
    return { code:String(x.code), role:x.role as Label["role"], claimRole:x.claimRole as Label["claimRole"], basis:x.basis as Label["basis"], evidenceIds:[...new Set(x.evidenceIds as string[])] };
  });
  if (new Set(labels.map(x=>x.code)).size !== labels.length || labels.filter(x=>x.role==="primary").length > 1 ||
      (labels.some(x=>x.code==="Unknown") && labels.length>1)) throw new Error("DUPLICATE_OR_PRIMARY_LABEL");
  return labels;
}
function normalizeAnnotation(doc:ThermalDocument, body:Record<string,unknown>, prior:Annotation|undefined):Annotation {
  if (body.taxonomyVersion !== TAXONOMY_V2) throw new Error("TAXONOMY_VERSION_CONFLICT");
  if (body.documentHash !== doc.contentHash) throw new Error("DOCUMENT_HASH_CONFLICT");
  if (!str(body.reviewer,100) || !String(body.reviewer).trim()) throw new Error("REVIEWER_REQUIRED");
  if (!REVIEW_STATUSES.includes(body.reviewStatus as typeof REVIEW_STATUSES[number])) throw new Error("INVALID_REVIEW_STATUS");
  if (!str(body.annotationRationale,6000) || !str(body.uncertaintyNotes,4000)) throw new Error("INVALID_NOTES");
  if (!Array.isArray(body.evidence) || body.evidence.length > 30) throw new Error("INVALID_EVIDENCE");
  const evidence = body.evidence.map(x=>normalizeEvidence(doc,x));
  if (new Set(evidence.map(x=>x.evidenceId)).size !== evidence.length) throw new Error("DUPLICATE_EVIDENCE");
  const industryRelevance = body.industryRelevance === null ? null : String(body.industryRelevance);
  if (industryRelevance !== null && !RELEVANCE.includes(industryRelevance as typeof RELEVANCE[number])) throw new Error("INVALID_INDUSTRY_RELEVANCE");
  const portfolioTier = industryRelevance === null ? null : TIERS[RELEVANCE.indexOf(industryRelevance as typeof RELEVANCE[number])];
  const dims = Object.fromEntries(DIMENSIONS.map(dim => [dim,normalizeLabels(body[dim],dim,evidence)])) as Pick<Annotation,typeof DIMENSIONS[number]>;
  if (body.reviewStatus !== "draft") {
    if (!industryRelevance || !String(body.annotationRationale).trim() || DIMENSIONS.some(dim=>!dims[dim].length)) throw new Error("INCOMPLETE_REVIEW");
    if (body.reviewStatus === "reviewed" && !evidence.some(x=>x.supportsFields.includes("industryRelevance") && x.supportRelation==="supports" && !["unsupported","unverifiable"].includes(x.semanticSupport))) throw new Error("INDUSTRY_SUPPORT_REQUIRED");
    if (body.reviewStatus === "reviewed" && ["core_claimed","explicit_application"].includes(industryRelevance!) && !evidence.some(x=>x.supportsFields.includes("industryRelevance") && x.supportRelation==="supports" && x.evidenceLevel===(industryRelevance==="core_claimed"?"claim":"embodiment"))) throw new Error("DIRECT_INDUSTRY_EVIDENCE_REQUIRED");
    if (body.reviewStatus === "reviewed" && DIMENSIONS.some(dim=>dims[dim].some(x=>x.code!=="Unknown" && !x.evidenceIds.some(id=>evidence.some(e=>e.evidenceId===id && e.supportRelation==="supports" && !["unsupported","unverifiable"].includes(e.semanticSupport)))))) throw new Error("LABEL_EVIDENCE_REQUIRED");
    if (["disputed","insufficient_evidence"].includes(String(body.reviewStatus)) && !String(body.uncertaintyNotes).trim()) throw new Error("UNCERTAINTY_REQUIRED");
    if (body.reviewStatus === "insufficient_evidence" && industryRelevance!=="insufficient_evidence") throw new Error("RELEVANCE_STATUS_CONFLICT");
  }
  const now = new Date().toISOString();
  return {annotationId:prior?.annotationId??randomUUID(),publicationNumber:doc.publicationNumber,sourceUrl:doc.sourceUrl,documentHash:doc.contentHash,taxonomyVersion:TAXONOMY_V2,
    reviewer:String(body.reviewer).trim(),reviewStatus:String(body.reviewStatus),reviewedAt:body.reviewStatus==="reviewed"?(prior?.reviewedAt??now):null,
    adjudicationStatus:"pending",industryRelevance,portfolioTier,primaryTechnologyCategory:null,legacyMappingStatus:"not_mapped",...dims,evidence,
    annotationRationale:String(body.annotationRationale),uncertaintyNotes:String(body.uncertaintyNotes),createdAt:prior?.createdAt??now,updatedAt:now};
}
export function createThermalAnnotationService(options:{datasetPath?:string;storePath?:string}={}) {
  const datasetPath = options.datasetPath ?? process.env.PATENT_THERMAL_DATA ?? fileURLToPath(new URL("../../data/smart-device-thermal-v1.3.json",import.meta.url));
  const storePath = options.storePath ?? process.env.PATENT_THERMAL_ANNOTATION_STORE ?? fileURLToPath(new URL("../../data/thermal-v2-annotations/state.json",import.meta.url));
  let queue:Promise<unknown> = Promise.resolve();
  const dataset = async () => { const d=JSON.parse(await readFile(datasetPath,"utf8")) as ThermalDataset; validateFrozenThermalDataset(d); return d; };
  const read = async ():Promise<State> => { try { const s=JSON.parse(await readFile(storePath,"utf8")) as State; if(s.schemaVersion!=="thermal-v2-annotation-pilot-1")throw new Error("ANNOTATION_SCHEMA_CONFLICT");return s; } catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return emptyState();throw e;} };
  const tasks = async () => { const d=await dataset(); return {taxonomyVersion:TAXONOMY_V2,relevance:RELEVANCE,tiers:TIERS,dimensions:DIMENSIONS,dictionary:DICTIONARY,evidenceLevels:EVIDENCE_LEVELS,supportRelations:SUPPORT_RELATIONS,semanticSupport:SEMANTIC_SUPPORT, tasks:REVIEW_IDS.map(id=>{const x=checkedDoc(d,id);return {publicationNumber:id,documentHash:x.contentHash,sourceUrl:x.sourceUrl,title:x.title,availability:{title:Boolean(x.title),abstract:Boolean(x.abstract),claim1:Boolean(x.independentClaims.length),description:Boolean(x.description)},questionCode:id};})}; };
  const source = async (id:unknown) => { const d=await dataset(), x=checkedDoc(d,id); return {publicationNumber:x.publicationNumber,documentHash:x.contentHash,publicationVersion:x.publicationVersion,sourceUrl:x.sourceUrl,retrievedAt:x.retrievedAt,title:x.title,abstract:x.abstract,claim1:x.independentClaims[0]??null,claims:x.independentClaims,description:x.description,descriptionCompleteness:"not_certified_full_text",cpc:x.cpc,ipc:x.ipc}; };
  const load = async (reviewer:unknown) => { if (!str(reviewer,100) || !String(reviewer).trim())throw new Error("REVIEWER_REQUIRED"); const [s,d]=await Promise.all([read(),dataset()]);const annotations=Object.values(s.annotations).filter(x=>x.reviewer===String(reviewer).trim());return {taxonomyVersion:TAXONOMY_V2,annotations,versionConflicts:annotations.filter(x=>x.taxonomyVersion!==TAXONOMY_V2||d.entries.find(e=>e.publicationNumber===x.publicationNumber)?.contentHash!==x.documentHash).map(x=>x.publicationNumber)}; };
  const save = async (body:Record<string,unknown>) => {
    const work = queue.then(async()=>{
      const d=await dataset(), doc=checkedDoc(d,body.publicationNumber), reviewer=String(body.reviewer??"").trim();
      if (!reviewer || reviewer.length>100)throw new Error("REVIEWER_REQUIRED");
      await mkdir(dirname(storePath),{recursive:true});
      const lock=storePath+".lock", file=await open(lock,"wx",0o600);
      try {
        const state=await read(), key=draftKey(doc.publicationNumber,reviewer), prior=state.annotations[key];
        if (prior && (body.annotationId!==prior.annotationId || prior.documentHash!==doc.contentHash || prior.taxonomyVersion!==TAXONOMY_V2)) throw new Error("ANNOTATION_VERSION_OR_OWNER_CONFLICT");
        if (!prior && body.annotationId != null) throw new Error("ANNOTATION_VERSION_OR_OWNER_CONFLICT");
        const item=normalizeAnnotation(doc,body,prior);
        state.annotations[key]=item;
        state.audit.push({eventId:randomUUID(),annotationId:item.annotationId,event:prior?(item.reviewStatus==="reviewed"?"reviewed":"updated"):"created",at:item.updatedAt,reviewer,publicationNumber:doc.publicationNumber});
        const temp=storePath+"."+randomUUID()+".tmp";
        try { await writeFile(temp,JSON.stringify(state,null,2),{flag:"wx",mode:0o600});await rename(temp,storePath); }
        catch(e){await unlink(temp).catch(()=>{});throw e;}
        return item;
      } finally { await file.close();await unlink(lock); }
    });
    queue=work.catch(()=>undefined);return work;
  };
  const exportAnnotations=async(reviewer:unknown) => {
    const result=await load(reviewer);
    const rows=result.annotations.map(x=>({ ...x, evidence:x.evidence.map(e=>({...e})) }));
    const title="Human Annotation — Not Verified Gold";
    const json={title,taxonomyVersion:TAXONOMY_V2,annotations:rows};
    const markdown=["# "+title,"","Taxonomy: "+TAXONOMY_V2,"",...rows.flatMap(x=>[
      "## "+x.publicationNumber,"- Source: "+x.sourceUrl,"- Document hash: "+x.documentHash,"- Reviewer: "+x.reviewer,"- Status: "+x.reviewStatus,"- Reviewed at: "+(x.reviewedAt??"Not reviewed"),
      "- Industry relevance: "+(x.industryRelevance??"Missing"),"- Portfolio tier: "+(x.portfolioTier??"Missing"),
      ...DIMENSIONS.map(k=>"- "+k+": "+x[k].map(v=>v.code+" ("+v.role+", "+v.claimRole+", "+v.basis+") ["+v.evidenceIds.join(", ")+"]").join("; ")),
      "- Rationale: "+x.annotationRationale,"- Uncertainty: "+x.uncertaintyNotes,"- Evidence:",
      ...x.evidence.map(e=>"- "+e.evidenceId+" ["+e.section+" / "+e.locator+"] "+e.sourceSpan+" | "+e.supportsFields.join(", ")+" | "+e.evidenceLevel+" | "+e.supportRelation+" | semantic="+e.semanticSupport+" | "+e.sourceUrl),
      ""
    ])].join("\n");
    return {json,markdown};
  };
  return {tasks,source,load,save,exportAnnotations};
}
