import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createThermalDocument, freezeThermalDataset } from "../src/pilot/thermal.ts";
import { createThermalAnnotationService, DICTIONARY, RELEVANCE, TAXONOMY_V2, TIERS } from "../src/pilot/thermal-annotation.ts";
import { createApp } from "../src/server.js";

// Synthetic-only public fixture: the five IDs exercise the task gate, not real text.
const ids=["EP3149425B1","EP4498205A1","EP4761489A1","EP4015272B1","EP4476289B1"];
const docs=ids.map(id=>{
  const [,number,kind]=id.match(/^EP(\d+)([A-Z]\d+)$/);
  return createThermalDocument({publicationNumber:id,title:"Synthetic vapor chamber",abstract:"Synthetic portable heat management.",
    claims:[{number:"1",text:"A synthetic portable device with a vapor chamber."}],
    description:"[0003] The chamber moves heat.\n[0004] Synthetic details only.",
    sourceUrl:`https://data.epo.org/publication-server/rest/v1.2/patents/EP${number}NW${kind}/document.xml`,
    fetchedAt:"2026-01-01T00:00:00.000Z"},["synthetic_mock_fixture"]);
});
const dataset=freezeThermalDataset(docs,[],[],"synthetic-v2-annotation-fixture");
async function fixture(){
  await mkdir(resolve("data"),{recursive:true});
  const dir=await mkdtemp(join(resolve("data"),"annotation-public-"));
  const datasetPath=join(dir,"dataset.json"),storePath=join(dir,"annotations","state.json");
  await writeFile(datasetPath,JSON.stringify(dataset));
  return {dir,datasetPath,storePath,service:createThermalAnnotationService({datasetPath,storePath})};
}
const evidence=(doc,extra={})=>({evidenceId:"E1",publicationNumber:doc.publicationNumber,sourceUrl:doc.sourceUrl,documentHash:doc.contentHash,
  section:"claims",locator:"untrusted-client-locator",sourceSpan:"a vapor chamber",evidenceLevel:"claim",
  supportsFields:["industryRelevance","technicalSolutions"],supportRelation:"supports",semanticSupport:"not_assessed",
  reviewerRationale:"Synthetic source evidence.",...extra});
const base=(doc,extra={})=>({publicationNumber:doc.publicationNumber,documentHash:doc.contentHash,taxonomyVersion:TAXONOMY_V2,reviewer:"Reviewer A",
  reviewStatus:"draft",industryRelevance:"core_claimed",technologyPrinciples:[{code:"Unknown",role:"primary",claimRole:"unknown",basis:"unknown",evidenceIds:[]}],
  technicalSolutions:[{code:"Vapor Chamber",role:"primary",claimRole:"claimed",basis:"explicit",evidenceIds:["E1"]}],
  functionalObjectives:[{code:"Unknown",role:"primary",claimRole:"unknown",basis:"unknown",evidenceIds:[]}],
  evidence:[evidence(doc)],annotationRationale:"Synthetic independent assessment.",uncertaintyNotes:"",...extra});
const close=s=>new Promise(resolve=>{s.closeAllConnections();s.close(resolve);});

test("v2 dictionary has five exclusive relevance values, deterministic tiers and three independent dimensions",()=>{
  assert.deepEqual([...RELEVANCE],["core_claimed","explicit_application","potential_application","out_of_scope","insufficient_evidence"]);
  assert.deepEqual([...TIERS],["Core Portfolio","Extended Portfolio","Candidate Pool","Excluded","Needs Review"]);
  assert.ok(DICTIONARY.technologyPrinciples.some(x=>x[1]==="Unknown"));
  assert.ok(DICTIONARY.technicalSolutions.some(x=>x[1]==="Other"));
  assert.ok(DICTIONARY.functionalObjectives.some(x=>x[1]==="Unknown"));
});
test("synthetic exact evidence is located in Claim 1 with source and hash bound",async()=>{
  const f=await fixture(),doc=docs[0];try{
    const item=await f.service.save(base(doc));
    assert.equal(item.portfolioTier,"Core Portfolio");assert.equal(item.evidence[0].locator,"Claim 1");
    assert.equal(item.sourceUrl,doc.sourceUrl);assert.equal(item.reviewedAt,null);
    assert.equal(item.evidence[0].exactMatch,true);assert.equal(item.evidence[0].sourceMatch,true);
    for(const invalid of [{sourceSpan:"not present"},{sourceUrl:"EP3149425B1"},{documentHash:"wrong"}]){
      await assert.rejects(f.service.save(base(doc,{annotationId:item.annotationId,evidence:[evidence(doc,invalid)]})));
    }
    const description=await f.service.save(base(doc,{annotationId:item.annotationId,evidence:[evidence(doc,{section:"description",sourceSpan:"The chamber moves heat.",evidenceLevel:"embodiment"})]}));
    assert.match(description.evidence[0].locator,/Description \[0003\] offset/);
    await assert.rejects(f.service.save(base(doc,{annotationId:item.annotationId,evidence:[evidence(doc,{section:"description",sourceSpan:"The chamber moves heat.",evidenceLevel:"claim"})]})),/LEVEL_SECTION/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test("multi-label rules reject duplicate, two primary, Unknown conflict and missing field binding",async()=>{
  const f=await fixture(),doc=docs[0];try{
    const one=base(doc).technicalSolutions[0],two={...one,code:"Heat Pipe"};
    await assert.rejects(f.service.save(base(doc,{technicalSolutions:[one,one]})),/DUPLICATE/);
    await assert.rejects(f.service.save(base(doc,{technicalSolutions:[one,two]})),/PRIMARY/);
    await assert.rejects(f.service.save(base(doc,{technicalSolutions:[one,{...one,code:"Unknown",basis:"unknown",claimRole:"unknown"}]})),/DUPLICATE/);
    await assert.rejects(f.service.save(base(doc,{technicalSolutions:[{...one,evidenceIds:["missing"]}]})),/BINDING/);
    await assert.rejects(f.service.save(base(doc,{industryRelevance:"invented"})),/INDUSTRY/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test("draft survives restart, reviewer is isolated, hash and taxonomy conflicts are rejected",async()=>{
  const f=await fixture(),doc=docs[0];try{
    const item=await f.service.save(base(doc));
    const restarted=createThermalAnnotationService({datasetPath:f.datasetPath,storePath:f.storePath});
    assert.equal((await restarted.load("Reviewer A")).annotations[0].annotationId,item.annotationId);
    assert.equal((await restarted.load("Reviewer B")).annotations.length,0);
    await assert.rejects(restarted.save(base(doc,{reviewer:"Reviewer B",annotationId:item.annotationId})),/OWNER_CONFLICT/);
    await assert.rejects(restarted.save(base(doc,{annotationId:item.annotationId,taxonomyVersion:"old"})),/TAXONOMY/);
    await assert.rejects(restarted.save(base(doc,{annotationId:item.annotationId,documentHash:"changed"})),/DOCUMENT_HASH/);
    const state=JSON.parse(await readFile(f.storePath,"utf8"));assert.equal(state.audit.length,1);assert.equal(state.audit[0].event,"created");
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test("Reviewed requires evidence and rationale; verified_gold cannot be created",async()=>{
  const f=await fixture(),doc=docs[0];try{
    await assert.rejects(f.service.save(base(doc,{reviewStatus:"verified_gold"})),/INVALID_REVIEW_STATUS/);
    await assert.rejects(f.service.save(base(doc,{reviewStatus:"reviewed",evidence:[]})),/BINDING|EVIDENCE/);
    await assert.rejects(f.service.save(base(doc,{reviewStatus:"reviewed",annotationRationale:""})),/INCOMPLETE/);
    await assert.rejects(f.service.save(base(doc,{reviewStatus:"reviewed",evidence:[evidence(doc,{supportRelation:"context_only"})]})),/INDUSTRY_SUPPORT/);
    await assert.rejects(f.service.save(base(doc,{reviewStatus:"reviewed",evidence:[evidence(doc,{semanticSupport:"unsupported"})]})),/INDUSTRY_SUPPORT/);
    await assert.rejects(f.service.save(base(doc,{reviewStatus:"reviewed",industryRelevance:"explicit_application"})),/DIRECT_INDUSTRY_EVIDENCE/);
    const done=await f.service.save(base(doc,{reviewStatus:"reviewed"}));
    assert.equal(done.reviewStatus,"reviewed");assert.equal(done.adjudicationStatus,"pending");
    assert.ok(done.reviewedAt);assert.equal(done.primaryTechnologyCategory,null);assert.equal(done.legacyMappingStatus,"not_mapped");
    await assert.rejects(f.service.save(base(doc,{annotationId:done.annotationId,reviewStatus:"insufficient_evidence",uncertaintyNotes:"Text missing"})),/RELEVANCE_STATUS_CONFLICT/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test("blind API sends source only, enforces same origin/CSRF and never calls a provider",async()=>{
  const f=await fixture();let paid=0;const app=createApp({thermalDatasetPath:f.datasetPath,thermalAnnotationPath:f.storePath,
    fetchImpl:async()=>{paid++;throw new Error("network forbidden");}});
  await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
  const root=`http://127.0.0.1:${app.address().port}`;
  const request=(action,body={},headers={})=>fetch(root+"/api/review-thermal/"+action,{method:"POST",headers:{"Content-Type":"application/json","X-Patent-Client":"workbench","Origin":root,...headers},body:JSON.stringify(body)});
  try{
    const token=(await (await fetch(root+"/api/xai/settings/csrf")).json()).csrfToken;
    assert.equal((await fetch(root+"/review-thermal")).status,200);
    assert.equal((await request("tasks")).status,403);
    assert.equal((await request("tasks",{},{"X-Patent-CSRF":token,"Origin":"https://evil.example"})).status,403);
    const tasks=await (await request("tasks",{},{"X-Patent-CSRF":token})).json();
    const source=await (await request("source",{publicationNumber:ids[0]},{"X-Patent-CSRF":token})).json();
    assert.equal(tasks.tasks.length,5);assert.equal(source.claim1,docs[0].independentClaims[0]);
    for(const forbidden of ["scope","primaryTechnologyCategory","goldCandidates","smoke","grok","classificationBasis","supportingSourceSpan"]){
      assert.equal(Object.hasOwn(source,forbidden),false);assert.equal(Object.hasOwn(tasks,forbidden),false);
    }
    assert.equal(paid,0);
  }finally{await close(app);await rm(f.dir,{recursive:true,force:true});}
});
test("browser-facing HTTP draft, review and export flow stays offline with synthetic data",async()=>{
  const f=await fixture();let external=0;
  const app=createApp({thermalDatasetPath:f.datasetPath,thermalAnnotationPath:f.storePath,
    fetchImpl:async()=>{external++;throw new Error("external provider forbidden");}});
  await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
  const root=`http://127.0.0.1:${app.address().port}`;
  try{
    const token=(await (await fetch(root+"/api/xai/settings/csrf")).json()).csrfToken;
    const post=async(action,body)=>{
      const response=await fetch(root+"/api/review-thermal/"+action,{method:"POST",headers:{"Content-Type":"application/json",
        "X-Patent-Client":"workbench","X-Patent-CSRF":token,Origin:root},body:JSON.stringify(body)});
      return {status:response.status,data:await response.json()};
    };
    const draft=await post("save",base(docs[0]));assert.equal(draft.status,200);
    assert.equal(draft.data.reviewStatus,"draft");
    const restored=await post("load",{reviewer:"Reviewer A"});assert.equal(restored.status,200);
    assert.equal(restored.data.annotations[0].annotationId,draft.data.annotationId);
    const wrongSource=await post("save",{...draft.data,evidence:[evidence(docs[0],{sourceUrl:"https://wrong.invalid"})]});
    assert.equal(wrongSource.status,400);assert.match(wrongSource.data.error.message,/EVIDENCE_SOURCE_MISMATCH/);
    const reviewed=await post("save",{...draft.data,reviewStatus:"reviewed"});assert.equal(reviewed.status,200);
    assert.equal(reviewed.data.adjudicationStatus,"pending");assert.ok(reviewed.data.reviewedAt);
    const exportData=await post("export",{reviewer:"Reviewer A"});assert.equal(exportData.status,200);
    assert.equal(exportData.data.json.annotations[0].reviewStatus,"reviewed");
    assert.match(exportData.data.markdown,/Not Verified Gold/);
    assert.equal(external,0);
  }finally{await close(app);await rm(f.dir,{recursive:true,force:true});}
});
test("export is explicitly non-Gold and contains annotations without bulk patent text",async()=>{
  const f=await fixture();try{
    await f.service.save(base(docs[0],{reviewStatus:"reviewed"}));
    const exportData=await f.service.exportAnnotations("Reviewer A");
    assert.equal(exportData.json.title,"Human Annotation — Not Verified Gold");
    assert.equal(exportData.json.taxonomyVersion,TAXONOMY_V2);
    assert.match(exportData.markdown,/Document hash:/);
    assert.match(exportData.markdown,/E1/);
    assert.ok(!JSON.stringify(exportData).includes("[0004] Synthetic details only."));
    assert.equal((await f.service.exportAnnotations("Reviewer B")).json.annotations.length,0);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test("review page and both locale catalogs expose the same human workflow without paid controls",async()=>{
  const html=await readFile(new URL("../public/review-thermal.html",import.meta.url),"utf8");
  const js=await readFile(new URL("../public/review-thermal.js",import.meta.url),"utf8");
  const locale=(await import("../public/i18n/review.js")).default;
  for(const key of ["review.title","review.industry","review.evidence","review.save","review.submit","review.notGold"])assert.ok(locale.zh[key]&&locale.en[key]);
  assert.ok(locale.zh["review.claims"]&&locale.en["review.claims"]);
  assert.match(html,/id="use-selection"/);assert.match(html,/id="save-draft"/);
  assert.doesNotMatch(js,/smoke-run|api\.x\.ai|verified_gold/);
});
test("synthetic evidence library saves multiple links, edited spans and independent reasons",async()=>{
  const f=await fixture(),doc=docs[0];try{
    const e1=evidence(doc,{evidenceId:"EV-001",sourceSpan:"a vapor chamber"});
    const e2=evidence(doc,{evidenceId:"EV-002",section:"description",sourceSpan:"The chamber moves heat.",evidenceLevel:"embodiment",supportsFields:["technologyPrinciples","technicalSolutions"]});
    const label={code:"Vapor Chamber",role:"primary",claimRole:"claimed",basis:"explicit",evidenceIds:["EV-001","EV-002"],
      evidenceLinks:[{evidenceId:"EV-001",supportRelation:"supports",rationale:"Claimed structure."},{evidenceId:"EV-002",supportRelation:"context_only",rationale:"Description context, not claim limitation."}]};
    const saved=await f.service.save(base(doc,{evidence:[e1,e2],technicalSolutions:[label]}));
    assert.equal(saved.evidence.length,2);assert.equal(saved.technicalSolutions[0].evidenceLinks[1].supportRelation,"context_only");
    const changed=await f.service.save({...saved,evidence:[e1,{...e2,sourceSpan:"moves heat"}]});
    assert.equal(changed.evidence[1].sourceSpan,"moves heat");assert.equal(changed.evidence[1].exactMatch,true);
    await assert.rejects(f.service.save({...changed,technicalSolutions:[{...label,evidenceLinks:[{...label.evidenceLinks[0],rationale:""},label.evidenceLinks[1]]}]}),/INVALID_EVIDENCE_LINK/);
    await assert.rejects(f.service.save({...changed,technicalSolutions:[{...label,evidenceLinks:[label.evidenceLinks[0]]}]}),/INVALID_EVIDENCE_LINK/);
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test("synthetic AI-assisted draft retains provenance and cannot become Reviewed or Gold",async()=>{
  const f=await fixture(),doc=docs[4];try{
    const item=await f.service.save(base(doc,{reviewer:"AI-assisted Codex",annotationMethod:"AI-assisted human-review draft"}));
    assert.equal(item.reviewStatus,"draft");assert.equal(item.reviewedAt,null);assert.equal(item.annotationMethod,"AI-assisted human-review draft");
    assert.equal((await f.service.exportAnnotations("AI-assisted Codex")).json.annotations[0].annotationMethod,item.annotationMethod);
    await assert.rejects(f.service.save({...item,reviewStatus:"reviewed"}),/AI_DRAFT_CANNOT_BE_REVIEWED/);
    await assert.rejects(f.service.save({...item,annotationMethod:"human_independent"}),/ANNOTATION_METHOD_CONFLICT/);
    await assert.rejects(f.service.save({...item,reviewStatus:"verified_gold"}),/INVALID_REVIEW_STATUS/);
    assert.equal((await f.service.load("AI-assisted Codex")).annotations[0].reviewStatus,"draft");
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
