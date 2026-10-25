import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {load} from 'cheerio';

const stored=new Map();
globalThis.localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
globalThis.location={hostname:'localhost'};
globalThis.document={documentElement:{lang:''}};
const en=(await import('../public/i18n/en.js')).default;
en['test.englishOnly']='English fallback {count}';
const {t,term,getLanguage,setLanguage}=await import('../public/i18n/index.js');

test('Chinese is default; language changes persist and restore presentation without changing enums',()=>{
  assert.equal(getLanguage(),'zh-CN');
  assert.equal(t('scope.boundary_case'),'边界案例');
  setLanguage('en');
  assert.equal(document.documentElement.lang,'en');
  assert.equal(stored.get('patentlens.locale'),'en');
  assert.equal(t('scope.boundary_case'),'Boundary Case');
  assert.equal(t('thermal.evidence',{index:3,section:'claims'}),'Evidence 3 / claims');
  assert.equal(term('scope','in_scope'),'In Scope');
  setLanguage('zh-CN');
  assert.equal(document.documentElement.lang,'zh-CN');
  assert.equal(stored.get('patentlens.locale'),'zh-CN');
  assert.equal(t('scope.boundary_case'),'边界案例');
});
test('missing locale entry falls back to English and interpolation preserves identifiers and amounts',()=>{
  const warnings=[],before=console.warn;
  console.warn=message=>warnings.push(message);
  try{
    assert.equal(t('test.englishOnly',{count:2}),'English fallback 2');
    assert.equal(t('thermal.confirmCost',{patentId:'EP4761489A1',model:'grok-4.3',estimate:'0.0072',reserve:'0.0150'}).includes('EP4761489A1 · grok-4.3'),true);
    assert.equal(warnings.some(x=>x.includes('test.englishOnly')),true);
  }finally{console.warn=before;}
});

test('a fresh page module restores the saved locale without contacting any API',async()=>{
  let requests=0;
  const previousFetch=globalThis.fetch;
  globalThis.fetch=()=>{requests++;throw new Error('Language change must not fetch');};
  try{
    setLanguage('en');
    const fresh=await import('../public/i18n/index.js?restored-locale');
    assert.equal(fresh.getLanguage(),'en');
    assert.equal(fresh.t('scope.in_scope'),'In Scope');
    fresh.setLanguage('zh-CN');
    assert.equal(stored.get('patentlens.locale'),'zh-CN');
    assert.equal(requests,0);
    assert.deepEqual([...stored.keys()],['patentlens.locale']);
  }finally{globalThis.fetch=previousFetch;setLanguage('zh-CN');}
});

test('all four pages bind static text and attributes to translated keys',async()=>{
  const zh=(await import('../public/i18n/zh-static.js')).default;
  const english=(await import('../public/i18n/en-static.js')).default;
  for(const [page,prefix] of [['pilot-thermal','thermal'],['pilot-v3','v3'],['pilot','pilot'],['index','search']]){
    const html=await readFile(new URL(`../public/${page}.html`,import.meta.url),'utf8');
    const $=load(html);
    assert.ok($('[data-i18n]').length>50,`${page} has translation bindings`);
    for(const attr of ['data-i18n','data-i18n-placeholder','data-i18n-aria','data-i18n-title']){
      $(`[${attr}]`).each((_,element)=>{
        const key=$(element).attr(attr);
        assert.ok(key.startsWith(`${prefix}.`),`${page} key ${key}`);
        assert.ok(Object.hasOwn(zh,key),`Chinese ${key}`);
        assert.ok(Object.hasOwn(english,key),`English ${key}`);
      });
    }
    assert.match(html,/\/i18n\/i18n\.css/);
    if(page==='pilot-thermal'){
      assert.deepEqual($('#review-form select[name="industryScope"] option').map((_,option)=>$(option).attr('value')).get(),['in_scope','boundary_case','out_of_scope','uncertain']);
    }
  }
});
