import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createPilotService} from '../src/pilot/service.ts';

test('synthetic research summary is editable, versioned and separate from imported facts',async()=>{
  const dir=await mkdtemp(join(resolve('data'),'summary-synthetic-'));
  try{
    const path=join(dir,'pilot.json');
    const svc=createPilotService({path,getKey:()=>undefined,fetchImpl:async()=>{throw Error('PAID_FORBIDDEN')},retrievalFetchImpl:async()=>{throw Error('NETWORK_FORBIDDEN')}});
    const original={publicationNumber:'EP9000777A1',title:'Synthetic official title',abstract:'Synthetic abstract',independentClaims:['A synthetic chamber comprising two plates.'],sourceUrl:'https://example.org/synthetic'};
    const {ids}=await svc.handle('import',{format:'json',text:JSON.stringify([original])});
    const id=ids[0];
    const save=(shortName,summary,source,expectedVersion,reason)=>svc.handle('set-research-summary',{recordId:id,shortName,summary,suggestedTags:['chamber'],source,editor:'Synthetic editor',reason,expectedVersion});
    await save('均热板','双板围成腔体。','external_ai_suggestion',0,'Synthetic proposal');
    await save('双板均热板','两块板围成散热腔体。','manual',1,'Synthetic edit');
    const record=(await svc.handle('state',{})).records[0];
    assert.equal(record.title,original.title);assert.equal(record.abstract,original.abstract);assert.deepEqual(record.independentClaims,original.independentClaims);
    assert.equal(record.researchSummaryVersion,2);assert.equal(record.researchSummaryRevisions.length,2);
    assert.equal(record.researchSummaryRevisions[0].before,null);assert.equal(record.researchSummaryRevisions[1].before.source,'external_ai_suggestion');
    assert.equal(record.researchSummary.source,'manual');assert.equal(record.metadataVersion??0,0);
    await assert.rejects(save('stale','stale','manual',1,'Synthetic stale'),/版本冲突/);
    await assert.rejects(save('too long','字'.repeat(81),'manual',2,'Synthetic invalid'),/最多80字/);
    await assert.rejects(save('same','same','verified_gold',2,'Synthetic invalid'),/来源/);
    assert.equal((await svc.handle('import',{format:'json',text:JSON.stringify([original])})).duplicates,1);
    const persisted=JSON.parse(await readFile(path,'utf8')).records[0];assert.equal(persisted.researchSummary.shortName,'双板均热板');assert.equal(persisted.title,original.title);
  }finally{await rm(dir,{recursive:true,force:true});}
});
