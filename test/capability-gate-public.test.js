import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildSyntheticDemoDataset} from '../scripts/start-portfolio-demo.js';
import {createCapabilityGate} from '../scripts/capability-gate.js';

test('synthetic/mock capability tasks have separate one-use authority, version checks, audit and budget',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'patent-capability-mock-'));let calls=0;
  try{
    const docs=buildSyntheticDemoDataset().entries.slice(0,2),path=join(dir,'audit.json');
    const provider=async({task})=>{calls++;return task==='patent_summary'?JSON.stringify({shortName:'合成材料',summary:'仅用于接口测试',tags:['resin'],evidence:[{sourceUrl:docs[0].sourceUrl,sourceSpan:'non-silicone resin'}]}):JSON.stringify({differences:[{a:{sourceUrl:docs[0].sourceUrl,sourceSpan:'non-silicone resin'},b:{sourceUrl:docs[1].sourceUrl,sourceSpan:'phase change material'}}]});};
    const gate=createCapabilityGate({provider,auditPath:path});
    const a=await gate.preflight('patent_summary',[docs[0]]);assert.equal(calls,0);assert.equal(a.authorization,false);
    await assert.rejects(gate.execute({authorizationId:'old',requestNonce:'old'},'patent_summary',[docs[0]]),/ONE_TIME/);
    assert.throws(()=>gate.authorize(a.quoteId,'patent_comparison_summary',docs,true),/TASK_INPUT_VERSION_CONFLICT/);
    const auth=gate.authorize(a.quoteId,'patent_summary',[docs[0]],true);
    await assert.rejects(gate.execute(auth,'patent_comparison_summary',docs),/ONE_TIME/);
    const changed=structuredClone(docs[0]);changed.independentClaims[0]+=' changed';
    await assert.rejects(gate.execute(auth,'patent_summary',[changed]),/TASK_INPUT_VERSION_CONFLICT/);
    await assert.rejects(gate.execute(auth,'patent_summary',[docs[0]]),/ONE_TIME/);
    const b=await gate.preflight('patent_comparison_summary',docs);
    const bAuth=gate.authorize(b.quoteId,'patent_comparison_summary',docs,true);
    const result=await gate.execute(bAuth,'patent_comparison_summary',docs);
    assert.equal(result.validation.shapeAndExactEvidence,true);assert.equal(result.validation.semanticSupport,'not_assessed');assert.equal(calls,1);
    await assert.rejects(gate.execute(bAuth,'patent_comparison_summary',docs),/ONE_TIME/);
    await assert.rejects(gate.preflight('patent_comparison_summary',docs),/TASK_ALREADY_ATTEMPTED/);
    assert.equal((await gate.history()).length,1);
    let now=1000;const expired=createCapabilityGate({provider,auditPath:join(dir,'expired.jsonl'),clock:()=>now});
    const stale=await expired.preflight('patent_summary',[docs[0]]);now+=120001;
    assert.throws(()=>expired.authorize(stale.quoteId,'patent_summary',[docs[0]],true),/EXPLICIT_COST_CONFIRMATION_REQUIRED/);
    const huge=structuredClone(docs[0]);huge.independentClaims[0]+='x'.repeat(60000);
    await assert.rejects(gate.preflight('patent_summary',[huge]),/PER_RUN_BUDGET_EXCEEDED/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
