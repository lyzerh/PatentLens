import {t,initializeI18n,onLanguageChange} from './i18n/index.js';
const $=id=>document.getElementById(id);
const node=(tag,value,className)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=String(value);if(className)el.className=className;return el;};
let csrf,items=[],source=null,candidate=null,validation=null,record=null;
const message=value=>{$('message').textContent=value;};
async function api(action,body={}){const response=await fetch('/api/patent-features/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Patent-Client':'workbench','X-Patent-CSRF':csrf},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error?.message??result.error?.code??'REQUEST_FAILED');return result;}
const guarded=fn=>async()=>{try{await fn();}catch(error){message(t('features.error',{reason:error.message}));}};
const currentId=()=>$('patent').value;
function renderSource(){if(!source)return;const meta=$('source-meta');meta.replaceChildren();const link=node('a',t('features.sourceLink'));link.href=source.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';meta.append(link,node('p',t('features.hash')+': '+source.documentHash));$('claim-text').textContent=source.claim1||t('features.noClaim');$('description-text').textContent=source.description||t('features.none');}
function locate(ev){if(!ev)return;const section=ev.section==='claims'?'claim-text':ev.section==='description'?'description-text':null;if(!section)return;const pre=$(section),raw=section==='claim-text'?source.claim1:source.description,offset=raw?.indexOf(ev.sourceSpan)??-1;if(offset<0)return;const before=raw.slice(0,offset),after=raw.slice(offset+ev.sourceSpan.length),mark=node('mark',ev.sourceSpan);pre.replaceChildren(document.createTextNode(before),mark,document.createTextNode(after));mark.scrollIntoView({block:'center',behavior:'instant'});}
function section(title,entries,format){const root=$('structure-content');root.append(node('h3',title));if(!entries?.length){root.append(node('p',t('features.none')));return;}for(const entry of entries){const button=node('button',undefined,'feature-card');button.type='button';button.append(node('strong',format(entry)),node('small',entry.evidence?.locator??''));button.addEventListener('click',()=>locate(entry.evidence));root.append(button);}}
function renderStructure(){const root=$('structure-content');root.replaceChildren();if(!candidate){root.append(node('p',t('features.noCandidate')));return;}root.append(node('h3',t('features.subject')),node('p',candidate.technicalSubject.type+' · '+candidate.technicalSubject.originalText));
  section(t('features.elements'),candidate.elements,x=>x.elementId+' · '+x.elementName+' — '+x.originalText);
  section(t('features.limitations'),candidate.limitations,x=>{
    const target=candidate.elements.find(e=>e.elementId===x.modifiesElementId)?.elementName??t('features.unknown');
    return x.limitationId+' · '+x.limitationType+' → '+target+'\n'+x.originalText+' ['+x.numericStatus+']'+(x.unit?' · '+t('features.unit')+': '+x.unit:'')+(x.referenceBasis?' · '+t('features.basis')+': '+x.referenceBasis:'');
  });
  section(t('features.relationships'),candidate.relationships,x=>x.fromElementId+' '+x.relationType+' '+x.toElementId+' — '+x.originalText+' · '+x.semanticSupport);
  section(t('features.findings'),candidate.descriptionFindings,x=>x.kind+' — '+x.text);
  root.append(node('h3',t('features.unresolved')));for(const x of candidate.unresolvedSpans)root.append(node('p',x.sourceSpan+' — '+x.reason));if(!candidate.unresolvedSpans.length)root.append(node('p',t('features.none')));
}
function renderDiagnostics(){const summary=$('diagnostic-summary'),list=$('diagnostic-list');summary.replaceChildren();list.replaceChildren();if(!validation)return;summary.append(node('p',t('features.coverage',validation.coverage)),node('p',t('features.notGold')));
  for(const dimension of ['schema','source_exact','numeric_integrity','relation_consistency','semantic_support']){
    const rows=validation.diagnostics.filter(d=>d.dimension===dimension);
    summary.append(node('p',dimension+': '+rows.filter(d=>d.pass).length+'/'+rows.length+(dimension==='semantic_support'?' · '+t('features.semanticPending'):'')));
  }
  summary.append(node('h3',t('features.coverageItems')));
  for(const item of validation.coverageItems??[]){const button=node('button',undefined,'feature-card');button.type='button';button.append(node('strong',`Claim 1 · ${item.claimSegment} · ${t('features.coverage.'+item.status)}`),node('small',item.sourceSpan),node('small',[...item.elementIds,...item.limitationIds,...item.relationIds].join(', ')||t('features.none')));if(item.unresolvedReasons.length)button.append(node('small',item.unresolvedReasons.join('; ')));button.addEventListener('click',()=>locate({section:'claims',sourceSpan:item.sourceSpan}));summary.append(button);}
  for(const d of validation.diagnostics){const box=node('div',undefined,'diagnostic-row '+(d.pass?'pass':'fail'));box.append(node('strong',(d.pass?'✓ ':'✗ ')+d.code+' · '+d.path),node('small',d.detail));list.append(box);}
}
function renderHistory(){const root=$('history');root.replaceChildren();if(!record){root.append(node('p',t('features.none')));return;}root.append(node('p',t('features.machineUnreviewed')+': '+record.createdAt+' · '+record.machineOutput.extractionMode));for(const revision of record.revisions)root.append(node('p',revision.at+' · '+revision.reviewer+' · '+revision.status));}
function render(){renderSource();renderStructure();renderDiagnostics();renderHistory();$('create').disabled=!candidate||Boolean(record);$('save-draft').disabled=!record;$('save-reviewed').disabled=!record;$('export-json').disabled=!record;$('export-md').disabled=!record;}
function setCandidate(next,report,edit=true){candidate=next;validation=report;if(edit)$('editor').value=JSON.stringify(next,null,2);render();}
function download(name,content,type){const a=node('a');const url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
initializeI18n();onLanguageChange(()=>render());
$('patent').addEventListener('change',guarded(async()=>{source=await api('source',{publicationNumber:currentId()});record=await api('load',{publicationNumber:currentId()});if(record){const current=record.revisions.at(-1);setCandidate(current?.candidate??record.machineOutput,current?.validation??record.machineValidation);}else{candidate=null;validation=null;$('editor').value='';render();}message(source.claim1?'':t('features.noClaim'));}));
for(const [id,mode] of [['extract','rules'],['mock','mock_llm']])$(id).addEventListener('click',guarded(async()=>{const result=await api('extract',{publicationNumber:currentId(),mode});setCandidate(result.candidate,result.validation);message(t('features.candidateReady'));}));
$('create').addEventListener('click',guarded(async()=>{if(!candidate)throw new Error(t('features.noCandidate'));record=await api('create',{publicationNumber:currentId(),mode:candidate.extractionMode==='mock_llm'?'mock_llm':'rules'});setCandidate(record.machineOutput,record.machineValidation);message(t('features.saved'));}));
for(const [id,status] of [['save-draft','draft'],['save-reviewed','reviewed']])$(id).addEventListener('click',guarded(async()=>{if(!record)throw new Error(t('features.noRecord'));const reviewer=$('reviewer').value.trim();if(!reviewer)throw new Error(t('features.missingReviewer'));const edited=JSON.parse($('editor').value);edited.reviewStatus=status;record=await api('review',{publicationNumber:currentId(),recordId:record.recordId,reviewer,status,candidate:edited});const last=record.revisions.at(-1);setCandidate(last.candidate,last.validation);message(t('features.reviewSaved'));}));
for(const [id,format] of [['export-json','json'],['export-md','markdown']])$(id).addEventListener('click',guarded(async()=>{const result=await api('export',{publicationNumber:currentId()});download('patent-features-'+currentId()+(format==='json'?'.json':'.md'),format==='json'?JSON.stringify(result.json,null,2):result.markdown,format==='json'?'application/json':'text/markdown');}));
try{csrf=(await(await fetch('/api/xai/settings/csrf')).json()).csrfToken;const list=await api('list');items=list.items;$('patent').replaceChildren(...items.map(x=>{const opt=node('option',x.publicationNumber+(x.hasClaim1?'':' · '+t('features.noClaim')));opt.value=x.publicationNumber;return opt;}));
  const preferred=items.find(x=>x.publicationNumber==='EP4476289B1'&&x.hasClaim1);if(preferred)$('patent').value=preferred.publicationNumber;
  if(items.length)$('patent').dispatchEvent(new Event('change'));else message(t('features.noData'));
}catch(error){message(t('features.noData')+' '+error.message);}
