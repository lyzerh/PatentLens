import {t,initializeI18n,onLanguageChange} from './i18n/index.js';
import {reviewCoverage,compareCoverage} from './claim-coverage.js';
const $=id=>document.getElementById(id);
const node=(tag,value,className)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=String(value);if(className)el.className=className;return el;};
let csrf,items=[],source=null,candidate=null,validation=null,record=null,repositorySnapshot=null,coverageSnapshots={};
const message=value=>{$('message').textContent=value;};
async function api(action,body={}){const response=await fetch('/api/patent-features/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Patent-Client':'workbench','X-Patent-CSRF':csrf},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.error?.message??result.error?.code??'REQUEST_FAILED');return result;}
async function repositoryRecord(id){const response=await fetch('/api/patent-repository/record',{method:'POST',headers:{'Content-Type':'application/json','X-Patent-Client':'workbench','X-Patent-CSRF':csrf},body:JSON.stringify({extractionRecordId:id})});const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'REPOSITORY_RECORD_FAILED');return result;}
async function loadCoverageSnapshots(){
  const id=currentId(),expected=source?.documentHash;
  coverageSnapshots={};
  if(record?.documentHash===expected)coverageSnapshots.rules={candidate:record.machineOutput,validation:record.machineValidation};
  const response=await fetch('/api/patent-repository/search',{method:'POST',headers:{'Content-Type':'application/json','X-Patent-Client':'workbench','X-Patent-CSRF':csrf},body:JSON.stringify({query:{publicationNumber:id,limit:100}})});
  const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'REPOSITORY_SEARCH_FAILED');
  for(const method of ['rules','llm']){
    const hit=result.results?.filter(x=>x.publicationNumber===id&&x.documentHash===expected&&x.sourceUrl===source.sourceUrl&&x.extractionMethod===method).at(-1);
    if(!hit||method==='rules'&&coverageSnapshots.rules)continue;
    const saved=await repositoryRecord(hit.extractionRecordId);
    if(saved.record.documentHash!==expected||saved.record.sourceUrl!==source.sourceUrl)continue;
    coverageSnapshots[method==='llm'?'grok':'rules']={candidate:saved.record.candidate,validation:saved.record.validation};
  }
  if(currentId()===id&&source?.documentHash===expected)renderCoverage();
}
const guarded=fn=>async()=>{try{await fn();}catch(error){message(t('features.error',{reason:error.message}));}};
const currentId=()=>$('patent').value;
function renderSource(){if(!source)return;const meta=$('source-meta');meta.replaceChildren();const link=node('a',t('features.sourceLink'));link.href=source.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';meta.append(link,node('p',t('features.hash')+': '+source.documentHash));$('claim-text').textContent=source.claim1||t('features.noClaim');$('description-text').textContent=source.description||t('features.none');}
function locate(ev){if(!ev)return;const section=ev.section==='claims'?'claim-text':ev.section==='description'?'description-text':null;if(!section)return;const pre=$(section),raw=section==='claim-text'?source.claim1:source.description,offset=raw?.indexOf(ev.sourceSpan)??-1;if(offset<0)return;const before=raw.slice(0,offset),after=raw.slice(offset+ev.sourceSpan.length),mark=node('mark',ev.sourceSpan);pre.replaceChildren(document.createTextNode(before),mark,document.createTextNode(after));mark.scrollIntoView({block:'center',behavior:'instant'});}
function section(title,entries,format,kind){const root=$('structure-content');root.append(node('h3',title));if(!entries?.length){root.append(node('p',t('features.none')));return;}for(const entry of entries){const button=node('button',undefined,'feature-card');button.type='button';button.dataset.featureKind=kind;button.dataset.featureId=entry.elementId??entry.limitationId??entry.relationId??'';button.append(node('strong',format(entry)),node('small',entry.evidence?.locator??''));button.addEventListener('click',()=>locate(entry.evidence));root.append(button);}}
function renderStructure(){const root=$('structure-content');root.replaceChildren();if(!candidate){root.append(node('p',t('features.noCandidate')));return;}root.append(node('h3',t('features.subject')),node('p',candidate.technicalSubject.type+' · '+candidate.technicalSubject.originalText));
  section(t('features.elements'),candidate.elements,x=>x.elementId+' · '+x.elementName+' — '+x.originalText,'element');
  section(t('features.limitations'),candidate.limitations,x=>{
    const target=candidate.elements.find(e=>e.elementId===x.modifiesElementId)?.elementName??t('features.unknown');
    return x.limitationId+' · '+x.limitationType+' → '+target+'\n'+x.originalText+' ['+x.numericStatus+']'+(x.unit?' · '+t('features.unit')+': '+x.unit:'')+(x.referenceBasis?' · '+t('features.basis')+': '+x.referenceBasis:'');
  },'limitation');
  section(t('features.relationships'),candidate.relationships,x=>x.fromElementId+' '+x.relationType+' '+x.toElementId+' — '+x.originalText+' · '+x.semanticSupport,'relationship');
  section(t('features.findings'),candidate.descriptionFindings,x=>x.kind+' — '+x.text,'finding');
  root.append(node('h3',t('features.unresolved')));for(const x of candidate.unresolvedSpans)root.append(node('p',x.sourceSpan+' — '+x.reason));if(!candidate.unresolvedSpans.length)root.append(node('p',t('features.none')));
}
function renderCoverage(){
  const root=$('coverage-review');root.replaceChildren();if(!source?.claim1)return;
  const views=[];if(coverageSnapshots.rules)views.push(['rules',coverageSnapshots.rules]);if(coverageSnapshots.grok)views.push(['grok',coverageSnapshots.grok]);
  if(candidate&&validation&&!views.some(([,saved])=>JSON.stringify(saved.candidate)===JSON.stringify(candidate)))views.unshift(['current',{candidate,validation}]);
  if(!views.length){root.append(node('p',t('features.coverageNoRecord')));return;}
  const comparison=coverageSnapshots.rules&&coverageSnapshots.grok?compareCoverage(source,coverageSnapshots.rules,coverageSnapshots.grok):[];
  root.append(node('p',t('features.coverageHelp')));
  const grid=node('div',undefined,'coverage-grid');root.append(grid);
  for(const [name,snapshot] of views){const column=node('div',undefined,'coverage-column');column.append(node('h3',t('features.coverage.'+name)));grid.append(column);
    for(const item of reviewCoverage(source,snapshot.candidate,snapshot.validation)){
      const box=node('div',undefined,'coverage-item '+item.status);box.append(node('strong',`Claim 1 · ${item.claimSegment} · ${t('features.coverage.status.'+item.status)}`));
      const excerpt=node('button',item.sourceSpan,'coverage-excerpt');excerpt.type='button';excerpt.addEventListener('click',()=>locate({section:'claims',sourceSpan:item.sourceSpan}));box.append(excerpt);
      for(const field of item.fields){const button=node('button',`${t('features.coverage.kind.'+field.kind)} ${field.id} · ${field.label}`,'coverage-field');button.type='button';button.addEventListener('click',()=>{
        if(candidate===snapshot.candidate){const card=[...document.querySelectorAll('[data-feature-kind]')].find(x=>x.dataset.featureKind===field.kind&&x.dataset.featureId===field.id);if(card){card.scrollIntoView({block:'center'});card.focus();return;}}
        locate({section:'claims',sourceSpan:field.sourceSpan});
      });box.append(button);}
      for(const issue of item.issues)box.append(node('small',issue.startsWith('unresolved:')?t('features.coverage.issue.unresolved')+issue.slice(11):t('features.coverage.issue.'+issue.split(':')[0])+(issue.includes(':')?' · '+issue.split(':').slice(1).join(':'):''),'coverage-issue'));
      const diff=comparison.find(x=>x.claimSegment===item.claimSegment);const only=name==='rules'?diff?.rulesOnly:diff?.grokOnly;
      if(only?.length)box.append(node('small',t('features.coverage.onlyHere')+': '+only.map(x=>x.id).join(', '),'coverage-issue'));
      if(diff?.grouped)box.append(node('small',t('features.coverage.grouped'),'coverage-issue'));
      column.append(box);
    }
  }
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
function render(){renderSource();renderStructure();renderCoverage();renderDiagnostics();renderHistory();$('create').disabled=!candidate||Boolean(record)||Boolean(repositorySnapshot);$('save-draft').disabled=!record;$('save-reviewed').disabled=!record;$('export-json').disabled=!record&&!repositorySnapshot;$('export-md').disabled=!record&&!repositorySnapshot;}
function setCandidate(next,report,edit=true){candidate=next;validation=report;if(edit)$('editor').value=JSON.stringify(next,null,2);render();}
function download(name,content,type){const a=node('a');const url=URL.createObjectURL(new Blob([content],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
initializeI18n();onLanguageChange(()=>render());
$('patent').addEventListener('change',guarded(async()=>{repositorySnapshot=null;coverageSnapshots={};source=await api('source',{publicationNumber:currentId()});record=await api('load',{publicationNumber:currentId()});const params=new URLSearchParams(location.search),requested=params.get('record');if(requested&&params.get('patent')===currentId()){const pinned=await repositoryRecord(requested);if(pinned.record.publicationNumber!==currentId()||pinned.currentRevisionId!==(params.get('revision')||null))throw new Error('FEATURE_REVISION_CONFLICT');if(!pinned.record.featureStoreRecordId){repositorySnapshot=pinned;record=null;setCandidate(pinned.candidate,pinned.validation);message(t('features.repositorySnapshot'));await loadCoverageSnapshots();return;}}if(record){const current=record.revisions.at(-1);setCandidate(current?.candidate??record.machineOutput,current?.validation??record.machineValidation);}else{candidate=null;validation=null;$('editor').value='';render();}message(source.claim1?'':t('features.noClaim'));await loadCoverageSnapshots();}));
for(const [id,mode] of [['extract','rules'],['mock','mock_llm']])$(id).addEventListener('click',guarded(async()=>{const result=await api('extract',{publicationNumber:currentId(),mode});setCandidate(result.candidate,result.validation);message(t('features.candidateReady'));}));
$('create').addEventListener('click',guarded(async()=>{if(!candidate)throw new Error(t('features.noCandidate'));record=await api('create',{publicationNumber:currentId(),mode:candidate.extractionMode==='mock_llm'?'mock_llm':'rules'});setCandidate(record.machineOutput,record.machineValidation);message(t('features.saved'));}));
for(const [id,status] of [['save-draft','draft'],['save-reviewed','reviewed']])$(id).addEventListener('click',guarded(async()=>{if(!record)throw new Error(t('features.noRecord'));const reviewer=$('reviewer').value.trim();if(!reviewer)throw new Error(t('features.missingReviewer'));const edited=JSON.parse($('editor').value);edited.reviewStatus=status;record=await api('review',{publicationNumber:currentId(),recordId:record.recordId,reviewer,status,candidate:edited});const last=record.revisions.at(-1);setCandidate(last.candidate,last.validation);message(t('features.reviewSaved'));}));
for(const [id,format] of [['export-json','json'],['export-md','markdown']])$(id).addEventListener('click',guarded(async()=>{const result=repositorySnapshot?{json:repositorySnapshot,markdown:`# ${currentId()} — Repository Feature Snapshot\n\nRecord: ${repositorySnapshot.record.extractionRecordId}\nExtractor: ${repositorySnapshot.record.extractorVersion}\nStatus: ${repositorySnapshot.reviewStatus}\n\n## Elements\n${repositorySnapshot.candidate.elements.map(x=>'- '+x.elementName+': '+x.originalText).join('\n')}\n\nMachine candidate; not Verified Gold.`}:await api('export',{publicationNumber:currentId()});download('patent-features-'+currentId()+(format==='json'?'.json':'.md'),format==='json'?JSON.stringify(result.json,null,2):result.markdown,format==='json'?'application/json':'text/markdown');}));
try{csrf=(await(await fetch('/api/xai/settings/csrf')).json()).csrfToken;const list=await api('list');items=list.items;$('patent').replaceChildren(...items.map(x=>{const opt=node('option',x.publicationNumber+(x.hasClaim1?'':' · '+t('features.noClaim')));opt.value=x.publicationNumber;return opt;}));
  const requested=new URLSearchParams(location.search).get('patent');const preferred=items.find(x=>x.publicationNumber===requested)??items.find(x=>x.publicationNumber==='EP4476289B1'&&x.hasClaim1);if(preferred)$('patent').value=preferred.publicationNumber;
  if(items.length)$('patent').dispatchEvent(new Event('change'));else message(t('features.noData'));
}catch(error){message(t('features.noData')+' '+error.message);}
