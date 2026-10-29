import {t} from './i18n/index.js';

const node=(tag,text,className)=>{const value=document.createElement(tag);if(text!==undefined)value.textContent=String(text);if(className)value.className=className;return value;};
const shown=value=>value===null||value===undefined?'—':String(value);

export function createAuditInspector(root,inspect){
  const states=new Map();
  let attempts=[];

  function field(parent,label,value){
    const line=node('div',undefined,'audit-field');
    line.append(node('dt',label),node('dd',shown(value)));
    parent.append(line);
  }
  function jsonSection(parent,title,value){
    const section=node('section',undefined,'audit-section');
    section.append(node('h4',title),node('pre',JSON.stringify(value??null,null,2),'audit-json'));
    parent.append(section);
  }
  function details(parent,record,state){
    const diagnostics=record.validation?.diagnostics??[];
    const exact=diagnostics.filter(item=>item.dimension==='source_exact');
    const summary=node('dl',undefined,'audit-fields');
    field(summary,t('repository.llmAudit'),record.attemptId);
    field(summary,t('repository.llmExecution'),record.status);
    field(summary,t('repository.llmResponse'),record.responseStatus??record.httpStatus);
    field(summary,t('repository.llmSchema'),record.schemaValid);
    field(summary,t('repository.llmExact'),exact.length?exact.every(item=>item.pass):null);
    field(summary,t('repository.llmValidator'),record.validation?.accepted);
    field(summary,t('repository.llmCost'),record.costUsd===null?'—':`${record.costUsd} USD · ${t('repository.llmCostKind.'+record.costKind)}`);
    field(summary,t('repository.llmSave'),record.repositoryRecordId??t('repository.llmNotSaved'));
    parent.append(summary);
    parent.append(node('p',t('repository.llmBilling'),'audit-note'));
    jsonSection(parent,t('repository.llmUsage'),record.usage);
    jsonSection(parent,t('repository.llmSchema'),{schemaValid:record.schemaValid,diagnostics:diagnostics.filter(item=>item.dimension==='schema')});
    jsonSection(parent,t('repository.llmEvidence'),{validatorAccepted:record.validation?.accepted,diagnostics:diagnostics.filter(item=>item.dimension!=='schema')});
    const raw=node('section',undefined,'audit-section');
    const copy=node('button',t('repository.llmCopy'));
    copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(record.rawResponse??'');state.copy=t('repository.llmCopied');}catch(error){state.copy=t('repository.llmCopyError',{reason:error instanceof Error?error.message:String(error)});}render();});
    raw.append(node('h4',t('repository.llmRaw')),copy,node('span',state.copy??'','audit-copy-status'),node('pre',record.rawResponse??'—','audit-json audit-raw'));
    parent.append(raw);
  }
  async function load(id){
    const state=states.get(id);if(!state||state.loading)return;
    state.loading=true;state.error=null;render();
    try{state.record=await inspect(id);}catch(error){state.error=error instanceof Error?error.message:String(error);}finally{state.loading=false;render();}
  }
  function toggle(id){
    const state=states.get(id)??{open:false,loading:false,record:null,error:null,copy:null};
    state.open=!state.open;states.set(id,state);render();
    if(state.open&&!state.record&&!state.loading)void load(id);
  }
  function render(nextAttempts){
    if(nextAttempts)attempts=nextAttempts;
    root.replaceChildren();
    if(!attempts.length){root.append(node('p',t('repository.llmNoHistory')));return;}
    for(const item of attempts){
      const state=states.get(item.attemptId)??{open:false,loading:false,record:null,error:null,copy:null};
      states.set(item.attemptId,state);
      const card=node('article',undefined,'row audit-card');card.dataset.auditId=item.attemptId;
      card.append(node('strong',`${item.publicationNumber} · ${item.status} · ${t('repository.llmAudit')}: ${item.attemptId}`));
      card.append(node('small',`${item.provider} / ${item.model} · ${shown(item.costUsd)} USD · ${shown(item.usage?.inputTokens)} / ${shown(item.usage?.outputTokens)} tokens`));
      card.append(node('small',t('repository.llmDiagnostics',{response:item.responseStatus??item.httpStatus??'—',schema:shown(item.schemaValid),evidence:shown(item.validationAccepted),saved:item.repositoryRecordId??'—'})));
      const button=node('button',state.open?t('repository.llmClose'):t('repository.llmInspect'));
      button.type='button';button.dataset.auditToggle=item.attemptId;button.setAttribute('aria-expanded',String(state.open));button.addEventListener('click',()=>toggle(item.attemptId));card.append(button);
      if(state.open){
        const panel=node('section',undefined,'audit-detail');panel.setAttribute('role','region');panel.setAttribute('aria-label',t('repository.llmAudit')+' '+item.attemptId);
        if(state.loading)panel.append(node('p',t('repository.llmLoading'),'audit-status'));
        else if(state.error){panel.append(node('p',t('repository.llmInspectError',{reason:state.error}),'audit-status audit-error'));const retry=node('button',t('repository.llmRetry'));retry.type='button';retry.addEventListener('click',()=>void load(item.attemptId));panel.append(retry);}
        else if(state.record){panel.append(node('p',t('repository.llmLoaded'),'audit-status'));details(panel,state.record,state);}
        card.append(panel);
      }
      root.append(card);
    }
  }
  return {render};
}
