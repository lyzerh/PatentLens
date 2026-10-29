import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuditInspector} from '../public/patent-repository-audit.js';

class Element {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.handlers={};this.attributes={};this.ownText='';}
  set textContent(value){this.ownText=String(value);this.children=[];}
  get textContent(){return this.ownText+this.children.map(child=>child.textContent).join('');}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.ownText='';this.children=nodes;}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(key,handler){this.handlers[key]=handler;}
  click(){this.handlers.click?.();}
  find(predicate){if(predicate(this))return this;for(const child of this.children){const match=child.find(predicate);if(match)return match;}return null;}
}

test('saved audit history restores an inspection button after page refresh and loads beside its card',async()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:tag=>new Element(tag)};
  try{
    const item={attemptId:'synthetic-audit-1',publicationNumber:'EP9000401A1',provider:'xai',model:'grok-4.3',status:'completed',costUsd:0.001,usage:{inputTokens:12,outputTokens:5},schemaValid:true,validationAccepted:true,repositoryRecordId:'synthetic-record'};
    let reads=0,resolveRead;
    const inspect=()=>{reads++;return new Promise(resolve=>{resolveRead=resolve;});};
    const firstPage=new Element('div');createAuditInspector(firstPage,inspect).render([item]);
    assert(firstPage.find(element=>element.dataset.auditToggle===item.attemptId));
    const refreshedPage=new Element('div');createAuditInspector(refreshedPage,inspect).render([item]);
    refreshedPage.find(element=>element.dataset.auditToggle===item.attemptId).click();
    assert.equal(reads,1);
    assert.match(refreshedPage.textContent,/正在读取审计记录/);
    resolveRead({...item,rawResponse:'{"synthetic":"mock"}',costKind:'estimated_cost',validation:{accepted:true,diagnostics:[{dimension:'source_exact',pass:true}]}});
    await new Promise(resolve=>setImmediate(resolve));
    const card=refreshedPage.find(element=>element.dataset.auditId===item.attemptId);
    assert(card.find(element=>element.className==='audit-detail'));
    assert.match(card.textContent,/synthetic/);
    assert.match(card.textContent,/证据精确匹配/);
    card.find(element=>element.dataset.auditToggle===item.attemptId).click();
    assert.equal(refreshedPage.find(element=>element.className==='audit-detail'),null);
    assert.equal(reads,1);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
