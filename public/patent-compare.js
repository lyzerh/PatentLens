import {t,onLanguageChange} from './i18n/index.js';
import {mountWorkspaceNavigation} from './workspace-nav.js';
import {trustBadge,featureTrust} from './trust-status.js';
import {mountManualResearch} from './manual-research.js';
import {buildComparisonReview} from './claim-coverage.js';

const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
let csrf,items=[],availableRecords=[],comparison=null,record=null,edited=[],sources={a:null,b:null};
const params=new URLSearchParams(location.search);let pinned=null;
if(params.has('aRecord')&&params.has('bRecord'))$('machine-tools').open=true;
const msg=text=>{$('message').textContent=text;};
mountManualResearch(document.querySelector('.warning')).catch(error=>msg(t('manual.error',{reason:error.message})));

async function api(action,body={}){
  const response=await fetch('/api/patent-compare/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Patent-Client':'workbench','X-Patent-CSRF':csrf},body:JSON.stringify(body)});
  const value=await response.json();
  if(!response.ok)throw new Error(value.error?.message??'REQUEST_FAILED');
  return value;
}
const guarded=fn=>async()=>{try{await fn();}catch(error){msg(t('compare.error',{reason:error.message}));}};
const pair=()=>({patentA:$('patent-a').value,patentB:$('patent-b').value,...(pinned?{refA:pinned.a,refB:pinned.b}:{})});

function showEvidence(a,b,featureAId=null,featureBId=null){
  const box=$('evidence');box.replaceChildren();
  for(const [side,ev,featureId,source] of [['A',a,featureAId,sources.a],['B',b,featureBId,sources.b]]){
    if(!ev)continue;
    const row=el('div',undefined,'row');
    row.append(el('strong',side+' · '+ev.publicationNumber+' · '+ev.locator),el('code',ev.sourceSpan),trustBadge(t,source?.revisionId?featureTrust({currentRevisionId:source.revisionId,reviewStatus:source.candidate?.reviewStatus}):'machine'));
    if(featureId){const limits=source?.candidate?.limitations?.filter(x=>x.modifiesElementId===featureId)??[];if(limits.length)row.append(el('small',t('guided.boundLimitations')+': '+limits.map(x=>x.originalText).join(' · ')));}
    const link=el('a',ev.sourceUrl);link.href=ev.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';row.append(link);box.append(row);
  }
  box.scrollIntoView({block:'nearest'});
}
function evidenceForSpan(source,sourceSpan){
  return {publicationNumber:source.doc.publicationNumber,section:'claims',sourceSpan,sourceUrl:source.doc.sourceUrl,documentHash:source.doc.contentHash,locator:'Claim 1'};
}
function addEvidenceButton(row,source,side,evidence){
  if(!evidence)return;
  const button=el('button',t('compare.viewEvidence'));button.type='button';
  button.addEventListener('click',()=>showEvidence(side==='a'?evidence:null,side==='b'?evidence:null));
  row.append(button);
}
function addGroup(root,label,items,renderItem){
  const section=el('section',undefined,'candidate-group');
  section.append(el('h4',t(label)+' ('+items.length+')'));
  if(!items.length)section.append(el('p',t('compare.none')));
  else for(const item of items)section.append(renderItem(item));
  root.append(section);
}
function recordMetadata(source){return availableRecords.find(x=>x.extractionRecordId===source.recordId)??null;}
function candidateRow(title,text,source,side,evidence,extra=[]){
  const row=el('div',undefined,'row candidate-row');row.append(el('strong',title));
  if(text)row.append(el('small',text));
  for(const line of extra)if(line)row.append(el('small',line));
  addEvidenceButton(row,source,side,evidence);return row;
}
function methodLabel(method){return method?t('compare.method.'+method):t('common.unknown');}

function renderSide(side){
  const root=$('side-'+side),source=sources[side];root.replaceChildren();if(!source)return;
  const {doc,candidate,recordId,revisionId}=source,meta=recordMetadata(source);
  const method=meta?.extractionMethod??candidate.extractionMode;
  const model=[meta?.provider,meta?.model].filter(Boolean).join(' / ')||t('compare.none');
  const reviewStatus=meta?.reviewStatus??candidate.reviewStatus??'machine_generated_unreviewed';
  root.append(el('p',doc.publicationNumber+' · '+candidate.technicalSubject.type),trustBadge(t,revisionId?featureTrust({currentRevisionId:revisionId,reviewStatus}):'machine'),el('p',methodLabel(method)+' · '+t('guided.evidenceStatus',{status:reviewStatus})));
  const details=el('details');details.append(el('summary',t('guided.details')));
  details.append(el('small',t('compare.sourceType')+': '+methodLabel(method)),el('small',t('compare.extractor')+': '+(meta?.extractorVersion??candidate.extractionMode??'—')),el('small',t('compare.providerModel')+': '+model),el('small',t('compare.validation')+': '+(source.validation?.accepted?'accepted':'needs review')+' / schema '+(source.validation?.schemaValid?'valid':'invalid')),el('small',t('compare.record')+': '+(recordId??t('guided.freePreview'))),el('small',t('compare.revision')+': '+(revisionId??'—')),el('small',doc.contentHash));
  const link=el('a',doc.sourceUrl);link.href=doc.sourceUrl;link.target='_blank';link.rel='noopener noreferrer';details.append(link);root.append(details);

  const view=buildComparisonReview(side,source,comparison);
  addGroup(root,'compare.subjectCandidate',[candidate.technicalSubject],x=>candidateRow(x.type,x.originalText,source,side,x.evidence));
  const elementById=new Map(view.elements.map(x=>[x.elementId,x]));
  addGroup(root,'compare.elementsGroup',view.elements,x=>candidateRow(x.elementId+' · '+x.elementName+' · '+x.elementType,x.originalText,source,side,x.evidence));
  addGroup(root,'compare.limitationsGroup',view.limitations,x=>{
    const target=elementById.get(x.modifiesElementId);
    const values=[x.lowerBound!==null?'lower '+x.lowerBound:null,x.upperBound!==null?'upper '+x.upperBound:null,x.unit,x.referenceBasis].filter(Boolean).join(' · ');
    return candidateRow(x.limitationId+' · '+x.limitationType,x.originalText,source,side,x.evidence,[target?t('compare.modifies')+': '+target.elementName+' ('+target.elementId+')':t('compare.modifies')+': —',values]);
  });
  addGroup(root,'compare.relationshipsGroup',view.relationships,x=>{
    const from=elementById.get(x.fromElementId),to=elementById.get(x.toElementId);
    return candidateRow(x.relationId+' · '+x.relationType,(from?.elementName??x.fromElementId)+' → '+(to?.elementName??x.toElementId)+' · '+x.originalText,source,side,x.evidence);
  });
  addGroup(root,'compare.unresolvedGroup',view.unresolvedSpans,x=>candidateRow(t('compare.unresolvedReason',{reason:x.reason}),x.sourceSpan,source,side,evidenceForSpan(source,x.sourceSpan)));
  const pending=view.coverage.filter(x=>x.status!=='mapped');
  const coverage=el('details',undefined,'coverage-review');
  coverage.append(el('summary',t('compare.coverageReview')+' · '+pending.length+' '+t('compare.coveragePending')));
  coverage.append(el('p',t('compare.coverageWarning')));
  if(!view.coverage.length)coverage.append(el('p',t('compare.coverageUnavailable')));
  for(const item of view.coverage){
    const status=t('compare.coverage.'+item.status),row=el('div',undefined,'row '+(item.status==='mapped'?'pass':'fail'));
    row.append(el('strong',t('compare.claimSegment',{number:item.claimSegment})+' · '+status),el('small',item.sourceSpan));
    if(item.issues.length)row.append(el('small',t('compare.coverageIssues')+': '+item.issues.join(' · ')));
    addEvidenceButton(row,source,side,evidenceForSpan(source,item.sourceSpan));coverage.append(row);
  }
  root.append(coverage);
}
function renderClaimSide(side){
  const source=sources[side];if(!source)return;
  const root=$('side-'+side),claim=el('details',undefined,'machine-claim');
  claim.append(el('summary',t('compare.readClaim')),el('pre',source.doc.independentClaims?.[0]||t('compare.noClaim')));
  root.prepend(claim,el('h3',source.doc.title+' · '+source.doc.publicationNumber));
}
function renderUnpaired(containerId,label,side,items){
  const root=$(containerId),source=sources[side];
  if(!source)return;
  for(const item of items){
    const row=el('div',undefined,'row');
    const id=item.elementId??item.limitationId??item.relationId??'';
    row.append(el('strong',side.toUpperCase()+(id?' · '+id:'')+' · '+(item.elementName??item.relationType??'')),el('small',item.originalText),el('small',t('compare.unpaired')));
    addEvidenceButton(row,source,side,item.evidence);root.append(row);
  }
}
function render(){
  renderSide('a');renderSide('b');renderClaimSide('a');renderClaimSide('b');
  const root=$('alignments');root.replaceChildren();const selected=$('filter').value;
  for(const id of ['unpaired-limitations','unpaired-relationships'])$(id).replaceChildren();
  if(!comparison){root.append(el('p',t('compare.noRecord')));for(const id of ['ambiguous','limitations','relationships','unmatched','diagnostics'])$(id).replaceChildren();return;}
  for(const [i,x] of edited.entries()){
    if(selected!=='all'&&x.comparisonResult!==selected)continue;
    const row=el('div',undefined,'row '+(x.validationStatus==='passed'?'pass':'fail'));
    row.append(trustBadge(t,'candidate'),el('strong',x.featureAId+' ↔ '+x.featureBId+' · '+t('compare.'+x.comparisonResult)),el('small',x.alignmentRationale+' · '+x.alignmentStatus));
    const quote=el('button',t('compare.exact'));quote.type='button';quote.addEventListener('click',()=>showEvidence(x.evidenceA,x.evidenceB,x.featureAId,x.featureBId));row.append(quote);
    for(const [value,label] of [['accepted','compare.accept'],['rejected','compare.reject'],['candidate','compare.undetermined']]){const button=el('button',t(label));button.type='button';button.setAttribute('aria-pressed',String(x.alignmentStatus===value));button.addEventListener('click',()=>{edited[i].alignmentStatus=value;render();});row.append(button);}
    const select=el('select');for(const key of ['undetermined','similar','different','equivalent','evidence_missing']){const option=el('option',t('compare.'+key));option.value=key;select.append(option);}select.value=x.comparisonResult;select.addEventListener('change',()=>{edited[i].comparisonResult=select.value;edited[i].semanticSupport='human_assessed';render();});row.append(select);
    const rationale=el('input');rationale.value=x.alignmentRationale;rationale.setAttribute('aria-label',t('compare.rationale'));rationale.addEventListener('input',()=>{edited[i].alignmentRationale=rationale.value;});row.append(rationale);root.append(row);
  }
  const ambiguous=$('ambiguous');ambiguous.replaceChildren();for(const x of comparison.ambiguousAlignments)ambiguous.append(el('p',x.featureAId+' ↔ '+x.candidateBIds.join(', ')+' · '+x.reason));if(!comparison.ambiguousAlignments.length)ambiguous.append(el('p',t('compare.none')));
  const limits=$('limitations');limits.replaceChildren();for(const x of comparison.limitationComparisons){const row=el('div',undefined,'row');row.append(el('strong',x.limitationA+' / '+x.limitationB+' · '+t('compare.'+x.comparisonResult)),el('small',x.originalTextA+' ↔ '+x.originalTextB),el('small',x.operatorA+' '+JSON.stringify(x.valueA)+' '+(x.unitA??'')+' / '+x.operatorB+' '+JSON.stringify(x.valueB)+' '+(x.unitB??'')),el('small',t('compare.basis')+': '+(x.referenceBasisA??'—')+' / '+(x.referenceBasisB??'—')),el('small',x.uncertaintyNotes));const button=el('button',t('compare.exact'));button.type='button';button.addEventListener('click',()=>showEvidence(x.evidenceA,x.evidenceB));row.append(button);limits.append(row);}if(!comparison.limitationComparisons.length)limits.append(el('p',t('compare.none')));
  const relations=$('relationships');relations.replaceChildren();for(const x of comparison.relationComparisons){const row=el('div',undefined,'row');row.append(el('strong',x.relationA+' / '+x.relationB+' · '+t('compare.'+x.comparisonResult)),el('small',x.relationTypeA+' / '+x.relationTypeB),el('small',x.uncertaintyNotes));const button=el('button',t('compare.exact'));button.type='button';button.addEventListener('click',()=>showEvidence(x.evidenceA,x.evidenceB));row.append(button);relations.append(row);}if(!comparison.relationComparisons.length)relations.append(el('p',t('compare.none')));
  for(const [side] of [['a'],['b']]){
    if(!sources[side])continue;
    const view=buildComparisonReview(side,sources[side],comparison);
    renderUnpaired('unpaired-limitations','compare.limitations',side,view.unpairedLimitations);
    renderUnpaired('unpaired-relationships','compare.relationships',side,view.unpairedRelationships);
  }
  const unmatched=$('unmatched');unmatched.replaceChildren(trustBadge(t,'unmatched'));
  let unmatchedCount=0;
  for(const side of ['a','b']){
    if(!sources[side])continue;
    const view=buildComparisonReview(side,sources[side],comparison);
    for(const x of view.unmatchedElements){unmatchedCount++;unmatched.append(candidateRow(side.toUpperCase()+' · '+x.elementId+' · '+x.elementName+' · '+x.elementType,x.originalText,sources[side],side,x.evidence,[t('compare.unmatchedNotice')]));}
  }
  if(!unmatchedCount)unmatched.append(el('p',t('compare.none')));
  const diagnostic=$('diagnostics');diagnostic.replaceChildren();for(const d of comparison.diagnostics)diagnostic.append(el('p',(d.pass?'✓ ':'✗ ')+d.dimension+' / '+d.code+' · '+d.detail,d.pass?'pass':'fail'));
  const revisions=$('revisions');revisions.replaceChildren();for(const revision of record?.revisions??[])revisions.append(el('p',revision.at+' · '+revision.reviewer+' · '+revision.status));
  for(const id of ['save','draft','reviewed','export-json','export-md'])$(id).disabled=id==='save'?Boolean(record):!record;
}
async function loadSources(){const {patentA,patentB,refA,refB}=pair();if(!patentA||!patentB||patentA===patentB)throw new Error(t('compare.noPair'));[sources.a,sources.b]=await Promise.all([api('source',{publicationNumber:patentA,ref:refA}),api('source',{publicationNumber:patentB,ref:refB})]);}

const recordSelectors={};
for(const side of ['a','b']){
  const label=el('label'),caption=el('span',t('guided.chooseRecords')+' '+side.toUpperCase()),select=el('select');
  select.id='record-'+side;label.append(caption,select);$('patent-'+side).closest('label').after(label);recordSelectors[side]=select;
  select.addEventListener('change',()=>{pinned={a:recordRef('a'),b:recordRef('b')};sources={a:null,b:null};comparison=null;record=null;render();});
}
const note=el('p',t('guided.versionLimit'),'warning');$('generate').closest('.toolbar').after(note);
const selectionHeading=el('h2',t('guided.chooseRecords'));$('generate').closest('.toolbar').before(selectionHeading);
const supportNote=el('p',t('guided.matchWarning'),'warning');$('alignments').before(supportNote);
onLanguageChange(()=>{
  selectionHeading.textContent=t('guided.chooseRecords');note.textContent=t('guided.versionLimit');supportNote.textContent=t('guided.matchWarning');
  for(const side of ['a','b']){recordSelectors[side].closest('label').firstChild.textContent=t('guided.chooseRecords')+' '+side.toUpperCase();const current=recordSelectors[side].value;fillRecords(side,current?recordRef(side):null);}
  render();
});
function recordRef(side){const id=recordSelectors[side].value;if(!id)return null;const hit=availableRecords.find(x=>x.extractionRecordId===id&&x.publicationNumber===$('patent-'+side).value);return hit?{recordId:hit.extractionRecordId,revisionId:hit.currentRevisionId??null}:null;}
function fillRecords(side,requested=null){
  const select=recordSelectors[side],hits=availableRecords.filter(x=>x.publicationNumber===$('patent-'+side).value);select.replaceChildren();
  const free=el('option',t('guided.freePreview'));free.value='';select.append(free);
  for(const hit of hits){const method=t('compare.method.'+hit.extractionMethod),model=[hit.provider,hit.model].filter(Boolean).join(' / '),option=el('option',t('guided.recordOption',{method,status:hit.reviewStatus,version:hit.extractorVersion})+(model?' · '+model:''));option.value=hit.extractionRecordId;select.append(option);}
  if(requested&&(!hits.some(x=>x.extractionRecordId===requested.recordId&&x.currentRevisionId===(requested.revisionId??null))))throw new Error('FEATURE_REVISION_CONFLICT');
  select.value=requested?.recordId??hits[0]?.extractionRecordId??'';
}
async function refreshHistory(){const history=await api('history');const selection=$('history'),selected=selection.value;selection.replaceChildren(el('option','—'));selection.firstChild.value='';for(const h of history){const option=el('option',h.patentA+' / '+h.patentB+' · '+h.createdAt);option.value=h.comparisonId;selection.append(option);}selection.value=selected;}
function download(name,content,type){const link=el('a');const url=URL.createObjectURL(new Blob([content],{type}));link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

mountWorkspaceNavigation('compare',[['select','/patent-repository?task=compare',false],['compare',null,true],['evidence','#evidence',false],['project',null,false]]);onLanguageChange(()=>render());$('filter').addEventListener('change',render);
const back=el('a',t('workspace.back.results'),'workspace-next');back.href='/patent-repository?task=compare';
const next=el('a',t('workspace.next.project'),'workspace-next');
const returnParams=new URLSearchParams({task:'collections'});
for(const key of ['a','b','aRecord','bRecord','aRevision','bRevision','collectionId'])if(params.has(key))returnParams.set(key,params.get(key));
next.href='/patent-repository?'+returnParams;back.href='/patent-repository?'+new URLSearchParams({...Object.fromEntries(returnParams),task:'compare'});
function updateLinks(){const query=new URLSearchParams({task:'collections'});for(const [side,key] of [['a','a'],['b','b']]){const source=sources[side];if(source?.recordId){query.set(key,source.doc.publicationNumber);query.set(key+'Record',source.recordId);query.set(key+'Revision',source.revisionId??'');}}if(params.has('collectionId'))query.set('collectionId',params.get('collectionId'));next.href='/patent-repository?'+query;query.set('task','compare');back.href='/patent-repository?'+query;}
$('message').after(back,document.createTextNode(' '),next);
onLanguageChange(()=>{back.textContent=t('workspace.back.results');next.textContent=t('workspace.next.project');});
for(const side of ['a','b'])$('patent-'+side).addEventListener('change',()=>{fillRecords(side);pinned={a:recordRef('a'),b:recordRef('b')};sources={a:null,b:null};comparison=null;record=null;render();});
$('generate').addEventListener('click',guarded(async()=>{await loadSources();comparison=await api('generate',pair());record=null;edited=structuredClone(comparison.alignments);render();updateLinks();msg(t('compare.preview'));}));
$('save').addEventListener('click',guarded(async()=>{if(!comparison)throw new Error(t('compare.noRecord'));record=await api('create',pair());comparison=record.machine;edited=structuredClone(comparison.alignments);await refreshHistory();$('history').value=comparison.comparisonId;render();msg(t('compare.saved'));}));
$('history').addEventListener('change',guarded(async()=>{const id=$('history').value;if(!id)return;record=await api('load',{comparisonId:id});$('patent-a').value=record.machine.patentA;$('patent-b').value=record.machine.patentB;for(const side of ['a','b'])fillRecords(side,record.machine.extractionRecordIds[side]?{recordId:record.machine.extractionRecordIds[side],revisionId:record.machine.extractionRevisionIds[side]}:null);pinned={a:recordRef('a'),b:recordRef('b')};await loadSources();comparison=record.machine;const latest=record.revisions.at(-1);edited=structuredClone(latest?.alignments??comparison.alignments);$('reviewer').value=latest?.reviewer??'';$('rationale').value=latest?.rationale??'';render();updateLinks();}));
for(const [id,status] of [['draft','review_draft'],['reviewed','reviewed']])$(id).addEventListener('click',guarded(async()=>{if(!record)throw new Error(t('compare.noRecord'));record=await api('review',{comparisonId:comparison.comparisonId,reviewer:$('reviewer').value.trim(),status,alignments:edited,rationale:$('rationale').value,expectedRevisionId:record.revisions.at(-1)?.revisionId??null});render();msg(t('compare.reviewSaved'));}));
for(const [id,format] of [['export-json','json'],['export-md','markdown']])$(id).addEventListener('click',guarded(async()=>{if(!record)throw new Error(t('compare.noRecord'));const output=await api('export',{comparisonId:comparison.comparisonId});download('patent-compare-'+comparison.patentA+'-'+comparison.patentB+(format==='json'?'.json':'.md'),format==='json'?JSON.stringify(output.json,null,2):output.markdown,format==='json'?'application/json':'text/markdown');}));
try{
  csrf=(await(await fetch('/api/xai/settings/csrf')).json()).csrfToken;items=(await api('list')).items;
  for(const id of ['patent-a','patent-b'])$(id).replaceChildren(...items.map(x=>{const o=el('option',x.publicationNumber+' · '+x.title);o.value=x.publicationNumber;return o;}));
  if(items.length>1)$('patent-b').selectedIndex=1;
  const search=await fetch('/api/patent-repository/search',{method:'POST',headers:{'Content-Type':'application/json','X-Patent-Client':'workbench','X-Patent-CSRF':csrf},body:JSON.stringify({query:{}})});
  if(!search.ok)throw new Error('REPOSITORY_SEARCH_FAILED');availableRecords=(await search.json()).results;
  if(params.has('a')||params.has('b')){if(!params.has('a')||!params.has('b')||!params.has('aRecord')||!params.has('bRecord'))throw new Error('INCOMPLETE_COMPARISON_CONTEXT');if(!items.some(x=>x.publicationNumber===params.get('a'))||!items.some(x=>x.publicationNumber===params.get('b')))throw new Error('COMPARISON_DOCUMENT_NOT_IN_DATASET');$('patent-a').value=params.get('a');$('patent-b').value=params.get('b');}
  for(const side of ['a','b'])fillRecords(side,params.has(side+'Record')?{recordId:params.get(side+'Record'),revisionId:params.get(side+'Revision')||null}:null);
  pinned={a:recordRef('a'),b:recordRef('b')};if(params.has('aRecord')){await loadSources();updateLinks();}
  await refreshHistory();if(!items.length)msg(t('compare.noData'));else render();
}catch(error){sources={a:null,b:null};comparison=null;record=null;render();msg(t('guided.invalidContext')+' '+error.message);}
