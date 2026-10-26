import { t, initializeI18n, onLanguageChange, getLanguage } from "./i18n/index.js";

const $ = id => document.getElementById(id);
const element = (tag,text,className) => { const x=document.createElement(tag); if(text!==undefined)x.textContent=String(text); if(className)x.className=className; return x; };
const option = (value,label) => { const x=element("option",label);x.value=value;return x; };
const fields = ["industryRelevance","technologyPrinciples","technicalSolutions","functionalObjectives"];
const dimensionTitles = { technologyPrinciples:"review.principles",technicalSolutions:"review.solutions",functionalObjectives:"review.objectives" };
const tierFor = value => !value ? null : config.tiers[config.relevance.indexOf(value)];
let config,csrf,currentId=null,currentSource=null,active=null,loadedReviewer="",dirty=false;
const sources=new Map(),saved=new Map(),cache=new Map(),unsaved=new Set();
const message = text => { $("message").textContent=text; };
const tr = (kind,value) => t("review."+value) === "review."+value ? value : t("review."+value);
const statusText = status => status ? tr("status",status) : t("review.pending");
const blank = (id) => ({publicationNumber:id,documentHash:config.tasks.find(x=>x.publicationNumber===id).documentHash,
  taxonomyVersion:config.taxonomyVersion,annotationId:null,reviewStatus:"draft",industryRelevance:null,
  technologyPrinciples:[],technicalSolutions:[],functionalObjectives:[],evidence:[],annotationRationale:"",uncertaintyNotes:""});
async function api(action,body={}) {
  const response=await fetch("/api/review-thermal/"+action,{method:"POST",headers:{"Content-Type":"application/json","X-Patent-Client":"workbench","X-Patent-CSRF":csrf},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error?.message??data.error?.code??"REQUEST_FAILED");
  return data;
}
function selectedEvidence(select){return [...select.selectedOptions].map(x=>x.value);}
function collect(){
  if(!active)return;
  active.industryRelevance=$("industry").value||null;
  active.annotationRationale=$("rationale").value;active.uncertaintyNotes=$("uncertainty").value;
  for(const dim of config.dimensions) active[dim]=[...document.querySelectorAll('[data-dimension="'+dim+'"] .dimension-row')].map(row=>({
    code:row.querySelector(".code").value,role:row.querySelector(".role").value,claimRole:row.querySelector(".claim-role").value,
    basis:row.querySelector(".basis").value,evidenceIds:selectedEvidence(row.querySelector(".evidence-ids"))
  }));
  cache.set(currentId,structuredClone(active));
}
function markDirty(collectForm=true){dirty=true;if(currentId)unsaved.add(currentId);if(collectForm)collect();else if(currentId)cache.set(currentId,structuredClone(active));}
function makeSelect(choices,value,className){const select=element("select");select.className=className;for(const [v,label] of choices)select.append(option(v,label));select.value=value;select.addEventListener("change",markDirty);return select;}
function renderDimensions(){
  const root=$("dimensions");root.replaceChildren();
  for(const dim of config.dimensions){
    const box=element("div",undefined,"dimension");box.dataset.dimension=dim;
    box.append(element("h3",t(dimensionTitles[dim])));
    for(const [index,label] of active[dim].entries()){
      const row=element("div",undefined,"dimension-row"),controls=element("div",undefined,"controls");
      const codes=config.dictionary[dim].map(([parent,code])=>[code,(parent?parent+" / ":"")+t("review.code."+code)]);
      const code=makeSelect(codes,label.code,"code");
      const role=makeSelect([["primary",t("review.primary")],["secondary",t("review.secondary")]],label.role,"role");
      const claim=makeSelect([["claimed",t("review.claimed")],["ancillary",t("review.ancillary")],["unknown",t("review.unknown")]],label.claimRole,"claim-role");
      const basis=makeSelect([["explicit",t("review.explicit")],["inferred",t("review.inferred")],["unknown",t("review.unknown")]],label.basis,"basis");
      controls.append(code,role,claim,basis);row.append(controls);
      const binding=element("label",t("review.evidence"));
      const ids=element("select");ids.className="evidence-ids";ids.multiple=true;
      for(const e of active.evidence.filter(x=>x.supportsFields.includes(dim))){const o=option(e.evidenceId,e.evidenceId.slice(0,8)+" · "+e.locator);o.selected=label.evidenceIds.includes(e.evidenceId);ids.append(o);}
      ids.addEventListener("change",markDirty);binding.append(ids);row.append(binding);
      const remove=element("button",t("review.remove"));remove.type="button";remove.addEventListener("click",()=>{collect();active[dim].splice(index,1);markDirty(false);renderDimensions();});
      row.append(remove);box.append(row);
    }
    const add=element("button",t("review.addLabel"));add.type="button";add.addEventListener("click",()=>{collect();active[dim].push({code:"Unknown",role:active[dim].some(x=>x.role==="primary")?"secondary":"primary",claimRole:"unknown",basis:"unknown",evidenceIds:[]});markDirty(false);renderDimensions();});
    box.append(add);root.append(box);
  }
}
function renderEvidence(){
  const root=$("evidence-list");root.replaceChildren();
  for(const e of active.evidence){
    const card=element("div",undefined,"evidence-item");
    card.append(element("strong",e.evidenceId+" · "+e.locator),element("blockquote",e.sourceSpan),element("small",t("review.exact")+" ✓ · "+t("review.fields")+": "+e.supportsFields.map(x=>x==="industryRelevance"?t("review.industry"):t("review."+x)).join(", ")+" · "+t("review.semantic")+": "+tr("semantic",e.semanticSupport)));
    const remove=element("button",t("review.remove"));remove.type="button";remove.addEventListener("click",()=>{collect();active.evidence=active.evidence.filter(x=>x.evidenceId!==e.evidenceId);for(const dim of config.dimensions)for(const label of active[dim])label.evidenceIds=label.evidenceIds.filter(id=>id!==e.evidenceId);markDirty(false);renderEvidence();renderDimensions();});
    card.append(remove);root.append(card);
  }
}
function renderTasks(){
  const root=$("tasks");root.replaceChildren();
  let count=0,disputed=0,missing=0;
  for(const task of config.tasks){
    const item=saved.get(task.publicationNumber), status=item?.reviewStatus;
    if(status==="reviewed")count++;if(status==="disputed")disputed++;if(status==="insufficient_evidence")missing++;
    const button=element("button");button.type="button";button.classList.toggle("active",task.publicationNumber===currentId);
    button.append(element("strong",task.publicationNumber),element("small",(status?statusText(status):t("review.pending"))+(unsaved.has(task.publicationNumber)?" • *":"")+
      " · "+(task.availability.claim1?t("review.available"):t("review.missing"))));
    button.addEventListener("click",()=>selectTask(task.publicationNumber));root.append(button);
  }
  $("progress").textContent=t("review.progress",{count,disputed,missing});
}
function renderSource(doc){
  const meta=$("source-meta"),root=$("source-content");meta.replaceChildren();root.replaceChildren();
  const link=element("a",t("review.sourceLink"));link.href=doc.sourceUrl;link.target="_blank";link.rel="noopener noreferrer";
  meta.append(link,element("p",t("review.version")+": "+doc.publicationVersion),element("p",t("review.hash")+": "+doc.documentHash));
  const sections=[["title",t("review.titleField"),doc.title],["abstract",t("review.abstract"),doc.abstract],
    ["claims",t("review.claim1"),doc.claim1],["claims",t("review.claims"),doc.claims.join("\n\n")],["description",t("review.description"),doc.description]];
  for(const [name,label,text] of sections){root.append(element("h3",label));const pre=element("pre",text||t("review.missing"));pre.dataset.section=name;root.append(pre);
    if(name==="description")root.append(element("p",t("review.partial"),"note"));}
  root.append(element("h3",t("review.codes")),element("p","CPC: "+(doc.cpc.join(", ")||t("review.missing"))+" · IPC: "+(doc.ipc.join(", ")||t("review.missing"))));
  root.append(element("h3",t("review.question")),element("p",t("review.question."+config.tasks.find(x=>x.publicationNumber===currentId).questionCode)));
}
function renderForm(){
  $("industry").value=active.industryRelevance??"";$("tier").textContent=active.industryRelevance?t("review."+tierFor(active.industryRelevance)):"—";
  $("rationale").value=active.annotationRationale;$("uncertainty").value=active.uncertaintyNotes;
  renderDimensions();renderEvidence();renderTasks();
}
async function selectTask(id){
  if(id===currentId&&currentSource)return;
  if(currentId&&active){collect();if(dirty)unsaved.add(currentId);}
  currentId=id;active=structuredClone(cache.get(id)??saved.get(id)??blank(id));dirty=unsaved.has(id);
  try{currentSource=sources.get(id)??await api("source",{publicationNumber:id});sources.set(id,currentSource);renderSource(currentSource);renderForm();message("");}
  catch(e){currentSource=null;message(t("review.error",{reason:e.message}));renderTasks();}
}
function fillSelect(id,values,mapper){const el=$(id);el.replaceChildren();for(const x of values)el.append(option(x,mapper(x)));}
function renderOptions(){
  const selected=$("industry").value,level=$("evidence-level").value,relation=$("evidence-relation").value,
    semantic=$("evidence-semantic").value,checked=new Set([...$("evidence-fields").querySelectorAll("input:checked")].map(x=>x.value));
  fillSelect("industry",["",...config.relevance],x=>x?t("review."+x):t("review.choose"));$("industry").value=selected;
  fillSelect("evidence-level",config.evidenceLevels,x=>t("review."+x));
  fillSelect("evidence-relation",config.supportRelations,x=>t("review."+x));
  fillSelect("evidence-semantic",config.semanticSupport,x=>t("review."+x));
  if(level)$("evidence-level").value=level;if(relation)$("evidence-relation").value=relation;
  $("evidence-semantic").value=semantic||"not_assessed";
  const root=$("evidence-fields");root.replaceChildren();
  for(const field of fields){const label=element("label");const check=element("input");check.type="checkbox";check.value=field;check.checked=checked.has(field);label.append(check,element("span",field==="industryRelevance"?t("review.industry"):t("review."+field)));root.append(label);}
}
function availableText(){if(!currentSource)return null;const section=$("evidence-section").value;return section==="claims"?currentSource.claims.join("\n\n"):currentSource[section];}
function matchesSection(span){const text=availableText();return !!text&&!!span&&($("evidence-section").value!=="claims"?text.includes(span):currentSource.claims.some(claim=>claim.includes(span)));}
function checkMatch(){const text=availableText(),span=$("evidence-span").value;$("match-status").textContent=!text?t("review.noSource"):matchesSection(span)?t("review.exact")+" ✓":span?t("review.notExact"):"";}
function download(name,content,type){const a=element("a");const url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function save(status){
  try{
    if(!loadedReviewer || loadedReviewer!==$("reviewer").value.trim())throw new Error(t("review.enterReviewer"));
    collect();const body={...active,reviewer:loadedReviewer,reviewStatus:status};
    const item=await api("save",body);saved.set(currentId,item);cache.set(currentId,structuredClone(item));active=structuredClone(item);dirty=false;unsaved.delete(currentId);
    renderForm();message(t("review.saved",{status:statusText(status)}));
  }catch(e){message(t("review.error",{reason:e.message}));}
}
initializeI18n();
onLanguageChange(()=>{if(!config)return;collect();renderOptions();if(currentSource)renderSource(currentSource);if(active)renderForm();});
$("industry").addEventListener("change",()=>{$("tier").textContent=$("industry").value?t("review."+tierFor($("industry").value)):"—";markDirty();});
for(const id of ["rationale","uncertainty"])$(id).addEventListener("input",markDirty);
for(const id of ["evidence-section","evidence-span"])$(id).addEventListener(id==="evidence-span"?"input":"change",checkMatch);
$("use-selection").addEventListener("click",()=>{const selection=window.getSelection();if(!selection||selection.isCollapsed)return;
  const a=selection.anchorNode?.parentElement?.closest("pre[data-section]"),b=selection.focusNode?.parentElement?.closest("pre[data-section]");
  if(a&&a===b&&a.closest("#source-content")&&currentSource){$("evidence-section").value=a.dataset.section;$("evidence-span").value=selection.toString();checkMatch();}
});
$("add-evidence").addEventListener("click",()=>{
  if(!currentSource)return;const section=$("evidence-section").value,span=$("evidence-span").value,text=availableText();
  if(!matchesSection(span)){checkMatch();return;}
  const supportsFields=[...$("evidence-fields").querySelectorAll("input:checked")].map(x=>x.value);if(!supportsFields.length){message(t("review.fields"));return;}
  collect();const offset=text.indexOf(span),before=text.slice(0,offset),markers=[...before.matchAll(/\[(\d{4})\]/g)];
  const locator=section==="claims"?"Claim "+(currentSource.claims.findIndex(claim=>claim.includes(span))+1):section==="description"?(markers.length?"Description ["+markers.at(-1)[1]+"] offset "+offset:"Description offset "+offset):section;
  active.evidence.push({evidenceId:crypto.randomUUID(),publicationNumber:currentId,documentHash:currentSource.documentHash,sourceUrl:currentSource.sourceUrl,
    section,locator,sourceSpan:span,evidenceLevel:$("evidence-level").value,supportsFields,supportRelation:$("evidence-relation").value,
    semanticSupport:$("evidence-semantic").value,reviewerRationale:$("evidence-explain").value,exactMatch:true,sourceMatch:true});
  $("evidence-span").value="";$("evidence-explain").value="";checkMatch();markDirty(false);renderEvidence();renderDimensions();
});
for(const [id,status] of [["save-draft","draft"],["submit-reviewed","reviewed"],["save-disputed","disputed"],["save-insufficient","insufficient_evidence"]])$(id).addEventListener("click",()=>save(status));
$("load").addEventListener("click",async()=>{
  const reviewer=$("reviewer").value.trim();if(!reviewer){message(t("review.enterReviewer"));return;}
  if(unsaved.size&&!confirm(t("review.unsaved")))return;
  try{const result=await api("load",{reviewer});loadedReviewer=reviewer;saved.clear();cache.clear();unsaved.clear();for(const item of result.annotations)saved.set(item.publicationNumber,item);
    active=null;currentId=null;dirty=false;await selectTask(config.tasks[0].publicationNumber);message(result.versionConflicts.length?t("review.versionConflict",{ids:result.versionConflicts.join(", ")}):t("review.existing"));}
  catch(e){message(t("review.error",{reason:e.message}));}
});
for(const [id,format] of [["export-json","json"],["export-md","markdown"]])$(id).addEventListener("click",async()=>{
  if(!loadedReviewer){message(t("review.enterReviewer"));return;}
  try{const value=await api("export",{reviewer:loadedReviewer});download("thermal-human-annotation."+ (format==="json"?"json":"md"),format==="json"?JSON.stringify(value.json,null,2):value.markdown,format==="json"?"application/json":"text/markdown");}
  catch(e){message(t("review.error",{reason:e.message}));}
});
window.addEventListener("beforeunload",e=>{if(unsaved.size){e.preventDefault();e.returnValue="";}});
try {
  csrf=(await (await fetch("/api/xai/settings/csrf")).json()).csrfToken;
  config=await api("tasks");renderOptions();await selectTask(config.tasks[0].publicationNumber);
}catch(e){message(t("review.noData")+" "+e.message);}
