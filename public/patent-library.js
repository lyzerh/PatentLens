import {t,onLanguageChange} from './i18n/index.js';
import {mountWorkspaceNavigation} from './workspace-nav.js';

mountWorkspaceNavigation('library');

const $=id=>document.getElementById(id);
const node=(tag,text='',className='')=>{const item=document.createElement(tag);item.textContent=text;if(className)item.className=className;return item;};
const button=(text,handler)=>{const item=node('button',text);item.type='button';item.addEventListener('click',handler);return item;};
const link=(text,href)=>{const item=node('a',text);item.href=href;return item;};
const unavailable=()=>t('common.notProvided');
const display=value=>Array.isArray(value)?(value.join(' · ')||unavailable()):(value||unavailable());
const normalize=value=>String(value??'').replace(/[\s\-‐‑–—]/g,'').toUpperCase();
const editable=['title','assignees','priorityDate','filingDate','publicationDate','jurisdiction','cpc','ipc'];
const secondary=['inventors','priorityDate','filingDate','publicationDate','jurisdiction','cpc','ipc','familyId','legalStatus'];
let state=null,selectedId=null,requestSequence=0;

async function api(action,body={}){
  const response=await fetch('/api/pilot/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Patent-Client':'workbench'},body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error?.message||result.message||t('pilot.requestFailed',{status:response.status}));
  return result;
}
function notice(message='',error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
async function run(message,action){notice(message);try{await action();}catch(error){notice(error.message||t('common.operationFailed'),true);}}
function current(){return state?.records.find(record=>record.id===selectedId)||null;}
async function refresh(preferredId){
  state=await api('state');
  if(preferredId&&state.records.some(record=>record.id===preferredId))selectedId=preferredId;
  if(!current())selectedId=state.records[0]?.id||null;
  $('record-total').textContent=String(state.records.length);
  renderList();renderDetail();
}

function renderList(){
  const list=$('registry-list');list.replaceChildren();
  $('registry-count').textContent=t('pilot.recordCount',{count:state.records.length});
  const query=normalize($('registry-search').value);
  const matches=state.records.filter(record=>normalize(record.publicationNumber).includes(query));
  $('registry-match-count').textContent=t('pilot.registryMatches',{count:matches.length});
  if(!matches.length){list.append(node('p',state.records.length?t('pilot.registryNoMatches'):t('library.empty'),'library-empty'));return;}
  for(const record of matches){
    const card=node('article','','library-record'+(record.id===selectedId?' is-active':''));
    const open=button('',()=>{selectedId=record.id;renderList();renderDetail();$('detail').scrollIntoView({block:'start',behavior:'smooth'});});
    open.setAttribute('aria-label',t('library.open',{patentId:record.publicationNumber}));
    open.append(node('span',record.publicationNumber,'library-record-number'));
    open.append(node('strong',record.title||t('pilot.titleMissing'),'library-record-title'));
    open.append(node('span',display(record.assignees),'library-record-meta'));
    if(record.researchSummary?.shortName)open.append(node('span',t('library.internalName')+'：'+record.researchSummary.shortName,'library-record-meta'));
    open.append(node('span',record.researchSummary?.summary||record.abstract||t('pilot.abstractMissing'),'library-record-summary'));
    open.append(node('span',t('library.sourceStatus')+'：'+record.sourceKind+(record.metadataCorrections?.length?' · '+t('pilot.metadataCorrected'):''),'library-record-status'));
    card.append(open);list.append(card);
  }
}

function field(record,key){
  const box=node('div','','library-fact'+(['abstract','independentClaims'].includes(key)?' wide':''));
  box.append(node('span',t('pilot.field.'+key),'library-fact-label'),node('span',display(record[key]),'library-fact-value'));
  const source=record.fields?.[key];
  box.append(node('small',source?t('pilot.provenance.'+source.status):t('pilot.noSource'),'library-fact-note'));
  if(source?.sourceUrl){const origin=link(t('pilot.fieldSource'),source.sourceUrl);origin.target='_blank';origin.rel='noopener noreferrer';origin.className='library-link';box.append(origin);}
  if(source&&source.status!=='manually_reviewed')box.append(button(t('pilot.verifyField'),()=>run(t('pilot.reviewing'),async()=>{await api('review-field',{recordId:record.id,field:key});await refresh(record.id);notice(t('pilot.reviewSaved'));})));
  return box;
}
function labeledControl(labelText,control){const label=node('label');label.append(node('span',labelText),control);return label;}
function detailForm(title,className){const box=node('details','',className);box.append(node('summary',title));const form=node('div','','library-form');box.append(form);return {box,form};}
function revisions(box,title,entries,format){const history=node('details');history.append(node('summary',title));for(const entry of entries)history.append(format(entry));box.append(history);}

function summarySection(record){
  const section=node('section','','library-detail-section research-summary');section.append(node('h3',t('pilot.researchHeading')));
  const summary=record.researchSummary;
  section.append(node('p',summary?.shortName||t('pilot.researchMissing')));
  if(summary?.summary)section.append(node('p',summary.summary));
  if(summary?.suggestedTags?.length)section.append(node('p',summary.suggestedTags.join(' · ')));
  if(summary)section.append(node('small',t('pilot.researchSource.'+summary.source),'library-fact-note'));
  section.append(node('p',t('pilot.researchDisclaimer'),'library-help'));
  const {box,form}=detailForm(t('pilot.researchEdit'),'library-summary-editor');
  const shortInput=document.createElement('input');shortInput.value=summary?.shortName||'';shortInput.setAttribute('aria-label',t('pilot.researchShort'));shortInput.dataset.draft='shortName';
  const summaryInput=document.createElement('textarea');summaryInput.value=summary?.summary||'';summaryInput.setAttribute('aria-label',t('pilot.researchText'));summaryInput.dataset.draft='summary';
  const count=node('small');const updateCount=()=>{count.textContent=t('pilot.researchCount',{count:[...summaryInput.value].length});};summaryInput.addEventListener('input',updateCount);updateCount();
  const tagsInput=document.createElement('input');tagsInput.value=(summary?.suggestedTags||[]).join('; ');tagsInput.setAttribute('aria-label',t('pilot.researchTags'));tagsInput.dataset.draft='suggestedTags';
  const source=document.createElement('select');source.setAttribute('aria-label',t('pilot.researchSourceLabel'));source.dataset.draft='summarySource';for(const value of ['manual','external_ai_suggestion','human_checked'])source.append(new Option(t('pilot.researchSource.'+value),value));source.value=summary?.source||'manual';
  const editor=document.createElement('input');editor.setAttribute('aria-label',t('pilot.metadataEditor'));editor.dataset.draft='summaryEditor';
  const reason=document.createElement('textarea');reason.setAttribute('aria-label',t('pilot.metadataReason'));reason.dataset.draft='summaryReason';
  form.append(labeledControl(t('pilot.researchShort'),shortInput),labeledControl(t('pilot.researchText'),summaryInput),count,labeledControl(t('pilot.researchTags'),tagsInput),labeledControl(t('pilot.researchSourceLabel'),source),labeledControl(t('pilot.metadataEditor'),editor),labeledControl(t('pilot.metadataReason'),reason));
  form.append(button(t('pilot.researchSave'),()=>run(t('pilot.metadataSaving'),async()=>{await api('set-research-summary',{recordId:record.id,shortName:shortInput.value,summary:summaryInput.value,suggestedTags:tagsInput.value.split(';').map(value=>value.trim()).filter(Boolean),source:source.value,editor:editor.value,reason:reason.value,expectedVersion:record.researchSummaryVersion??0});await refresh(record.id);notice(t('pilot.researchSaved'));})));
  section.append(box);
  revisions(section,t('pilot.researchHistory',{count:record.researchSummaryRevisions?.length||0}),record.researchSummaryRevisions||[],entry=>node('p',`#${entry.revision} · ${entry.at} · ${entry.editor} · ${entry.reason}\n${JSON.stringify(entry.before)} → ${JSON.stringify(entry.after)}`,'library-history'));
  return section;
}

function metadataSection(record){
  const section=node('section','','library-detail-section');section.append(node('h3',t('library.officialMetadata')));
  const facts=node('div','','library-facts');for(const key of ['title','assignees','abstract','independentClaims'])facts.append(field(record,key));
  section.append(facts);
  const more=node('details');more.append(node('summary',t('library.moreMetadata')));const extra=node('div','','library-facts');for(const key of secondary)extra.append(field(record,key));more.append(extra);section.append(more);
  const {box,form}=detailForm(t('pilot.metadataEdit'),'library-metadata-editor');
  form.append(node('p',t('pilot.metadataIdentityNotice'),'library-help'));
  const select=document.createElement('select');select.dataset.draft='metadataField';select.setAttribute('aria-label',t('pilot.metadataField'));for(const key of editable)select.append(new Option(t('pilot.field.'+key),key));
  const value=document.createElement('input');value.dataset.draft='metadataValue';value.setAttribute('aria-label',t('pilot.metadataValue'));value.maxLength=2000;
  const fill=()=>{value.value=Array.isArray(record[select.value])?record[select.value].join('; '):record[select.value]||'';};select.addEventListener('change',fill);fill();
  const editor=document.createElement('input');editor.dataset.draft='metadataEditor';editor.setAttribute('aria-label',t('pilot.metadataEditor'));editor.maxLength=100;
  const reason=document.createElement('textarea');reason.dataset.draft='metadataReason';reason.setAttribute('aria-label',t('pilot.metadataReason'));reason.maxLength=1000;
  form.append(labeledControl(t('pilot.metadataField'),select),labeledControl(t('pilot.metadataValue'),value),labeledControl(t('pilot.metadataEditor'),editor),labeledControl(t('pilot.metadataReason'),reason));
  form.append(button(t('pilot.metadataSave'),()=>run(t('pilot.metadataSaving'),async()=>{if(!confirm(t('pilot.metadataConfirm')))return;await api('correct-metadata',{recordId:record.id,field:select.value,value:value.value,editor:editor.value,reason:reason.value,expectedVersion:record.metadataVersion??0});await refresh(record.id);notice(t('pilot.metadataSaved'));})));
  section.append(box);
  revisions(section,t('pilot.metadataHistory',{count:record.metadataCorrections?.length||0}),record.metadataCorrections||[],entry=>node('p',`#${entry.revision} · ${t('pilot.field.'+entry.field)} · ${entry.at}\n${JSON.stringify(entry.before)} → ${JSON.stringify(entry.after)}\n${entry.editor} · ${entry.reason}`,'library-history'));
  if(record.originalImportMetadata){const original=node('details');original.append(node('summary',t('pilot.metadataOriginal')),node('pre',JSON.stringify(record.originalImportMetadata,null,2),'library-hash'));section.append(original);}
  return section;
}

function tagsSection(record){
  const section=node('section','','library-detail-section');section.append(node('h3',t('manual.tags')));
  section.append(node('p',(record.manualTags||[]).join(' · ')||t('pilot.tagsMissing')));
  const {box,form}=detailForm(t('library.editTags'),'library-tags-editor');
  const tags=document.createElement('input');tags.value=(record.manualTags||[]).join('; ');tags.dataset.draft='manualTags';tags.setAttribute('aria-label',t('manual.tags'));
  const editor=document.createElement('input');editor.dataset.draft='tagEditor';editor.setAttribute('aria-label',t('manual.editor'));
  form.append(labeledControl(t('manual.tags'),tags),labeledControl(t('manual.editor'),editor),button(t('manual.saveTags'),()=>run(t('manual.saving'),async()=>{await api('set-manual-tags',{recordId:record.id,tags:tags.value.split(';').map(value=>value.trim()).filter(Boolean),editor:editor.value,expectedVersion:record.manualTagVersion??0});await refresh(record.id);notice(t('manual.saved'));})));
  section.append(box);
  revisions(section,t('manual.tagHistory',{count:record.manualTagRevisions?.length||0}),record.manualTagRevisions||[],entry=>node('p',`#${entry.version} · ${entry.at} · ${entry.editor}\n${entry.before.join(' · ')} → ${entry.after.join(' · ')}`,'library-history'));
  return section;
}

function sourceSection(record){
  const section=node('section','','library-detail-section');section.append(node('h3',t('library.sourceTitle')));
  section.append(node('p',t('library.sourceStatus')+'：'+record.sourceKind+' · '+record.importedAt,'library-help'));
  if(record.sourceUrl){const source=link(record.sourceUrl,record.sourceUrl);source.target='_blank';source.rel='noopener noreferrer';source.className='library-link';section.append(source);}else section.append(node('p',t('library.sourceMissing'),'library-help'));
  const hash=node('p',t('library.hashChecking'),'library-hash');section.append(hash);
  const request=++requestSequence;
  crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([record.sourceUrl,record.independentClaims,record.abstract]))).then(bytes=>{
    if(request!==requestSequence||selectedId!==record.id||!hash.isConnected)return;
    const value=[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    hash.textContent=t('library.registryHash',{hash:value});
  }).catch(()=>{if(request===requestSequence&&hash.isConnected)hash.textContent=t('library.hashUnavailable');});
  return section;
}

function captureDraft(){const box=$('record-detail');return {values:Object.fromEntries([...box.querySelectorAll('[data-draft]')].map(item=>[item.dataset.draft,item.value])),open:[...box.querySelectorAll('details')].map(item=>item.open)};}
function restoreDraft(draft){if(!draft)return;const box=$('record-detail');for(const item of box.querySelectorAll('[data-draft]'))if(Object.hasOwn(draft.values,item.dataset.draft)){item.value=draft.values[item.dataset.draft];if(item.dataset.draft==='summary')item.dispatchEvent(new Event('input'));}[...box.querySelectorAll('details')].forEach((item,index)=>{item.open=Boolean(draft.open[index]);});}
function renderDetail(draft){
  const record=current(),box=$('record-detail');box.replaceChildren();++requestSequence;
  if(!record){box.append(node('p',t('pilot.selectRecord'),'library-empty'));return;}
  box.append(node('p',record.publicationNumber,'library-detail-number'),node('h3',record.title||t('pilot.titleMissing'),'library-detail-title'));
  box.append(node('p',t('library.sourceStatus')+'：'+record.sourceKind+(record.metadataCorrections?.length?' · '+t('pilot.metadataCorrected'):''),'library-status-line'));
  box.append(sourceSection(record),metadataSection(record),summarySection(record),tagsSection(record));
  const actions=node('nav','','library-actions');actions.append(link(t('pilot.openWorkspace'),'/workspace?registry='+encodeURIComponent(record.id)),link(t('manual.openProject'),'/patent-repository?task=collections&registry='+encodeURIComponent(record.id)),link(t('pilot.manualCompare'),'/patent-compare?registry='+encodeURIComponent(record.id)));box.append(actions);
  restoreDraft(draft);
}

$('registry-search').addEventListener('input',()=>{if(state)renderList();});
$('import-button').addEventListener('click',()=>run(t('pilot.readingImport'),async()=>{
  const file=$('import-file').files[0];if(!file)throw new Error(t('pilot.noFile'));if(file.size>1_000_000)throw new Error(t('pilot.fileLarge'));
  const format=file.name.toLowerCase().endsWith('.csv')?'csv':'json';const result=await api('import',{format,text:await file.text()});
  await refresh(result.ids?.[0]);notice(t('pilot.imported',{added:result.added,duplicates:result.duplicates}));
}));
$('epo-import').addEventListener('click',()=>run(t('pilot.readingEpo'),async()=>{
  const result=await api('import-source',{source:'epo',publicationNumber:$('epo-id').value.trim()});
  await refresh(result.recordId);notice(t(result.duplicate?'pilot.sourceDuplicate':'pilot.sourceAdded'));
}));
onLanguageChange(()=>{if(!state)return;const draft=captureDraft();renderList();renderDetail(draft);});
run(t('pilot.loadingRegistry'),async()=>{await refresh(new URLSearchParams(location.search).get('record'));notice();});
