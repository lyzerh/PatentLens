import test from 'node:test';
import assert from 'node:assert/strict';
import status from '../public/i18n/status.js';
import {featureTrust,evidenceTrust,trustBadge} from '../public/trust-status.js';

test('synthetic status labels describe persisted review evidence without promoting machine output',()=>{
  assert.equal(featureTrust({reviewStatus:'machine_generated_unreviewed',currentRevisionId:null}),'machine');
  assert.equal(featureTrust({reviewStatus:'draft',currentRevisionId:'synthetic-revision'}),'revised');
  assert.equal(featureTrust({reviewStatus:'reviewed',currentRevisionId:'synthetic-revision'}),'reviewed');
  assert.equal(featureTrust({revisions:[{revisionId:'synthetic-revision',status:'draft'}]}),'revised');
  assert.equal(evidenceTrust(null),'unknown');
  assert.equal(evidenceTrust({diagnostics:[]}), 'unknown');
  assert.equal(evidenceTrust({diagnostics:[{dimension:'source_exact',pass:true}]}),'evidencePass');
  assert.equal(evidenceTrust({diagnostics:[{dimension:'source_exact',pass:false}]}),'evidenceFail');
  for(const locale of ['zh','en']){
    const dict=status[locale];
    for(const key of ['registered','corrected','unextracted','machine','revised','reviewed','schemaPass','evidencePass','candidate','unmatched','snapshot','unknown'])assert.ok(dict['trust.'+key]);
    assert.ok(dict['trust.validation.help']);
    assert.notEqual(dict['trust.revised'],dict['trust.reviewed']);
  }
});

test('synthetic status badge exposes concise explanation without mutating record',()=>{
  const before=globalThis.document;
  globalThis.document={createElement:()=>({className:'',textContent:'',title:''})};
  try{
    const t=(key,params)=>status.en[key]?.replace('{method}',params?.method??'')??key;
    const badge=trustBadge(t,'machine',{method:'Rules'});
    assert.equal(badge.textContent,'Machine candidate');
    assert.match(badge.title,/Rules/);
    assert.match(trustBadge(t,'evidencePass').title,/do not prove technical meaning/);
  }finally{globalThis.document=before;}
});
