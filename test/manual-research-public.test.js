import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createPilotService} from '../src/pilot/service.ts';
import {createPatentCollectionService} from '../src/pilot/patent-collections.ts';

test('synthetic registry patents support manual tags, exact two-source comparison and versioned export without extraction',async()=>{
  const dir=await mkdtemp(join(resolve('data'),'manual-research-synthetic-'));
  const pilot=createPilotService({path:join(dir,'pilot.json'),getKey:()=>undefined,fetchImpl:async()=>{throw Error('EXTERNAL_FORBIDDEN')}});
  const collections=createPatentCollectionService({pilotPath:join(dir,'pilot.json'),datasetPath:join(dir,'missing-dataset.json'),storePath:join(dir,'collections.json'),repositoryStorePath:join(dir,'repository.json'),featureStorePath:join(dir,'features.json')});
  const docs=[{publicationNumber:'EP9000101A1',title:'Synthetic chamber A',sourceUrl:'https://example.org/a',independentClaims:['A chamber comprising a first plate and a support.']},{publicationNumber:'EP9000102A1',title:'Synthetic chamber B',sourceUrl:'https://example.org/b',independentClaims:['A chamber comprising a second plate and an opening.']}];
  try{
    const imported=await pilot.handle('import',{format:'json',text:JSON.stringify(docs)});const [a,b]=imported.ids;
    await pilot.handle('set-manual-tags',{recordId:a,tags:['plate','support'],editor:'Synthetic editor',expectedVersion:0});
    await pilot.handle('set-manual-tags',{recordId:a,tags:['plate'],editor:'Synthetic editor',expectedVersion:1});
    await assert.rejects(pilot.handle('set-manual-tags',{recordId:a,tags:['stale'],editor:'Synthetic editor',expectedVersion:0}),/版本冲突/);
    const c=await collections.create('Synthetic manual project','No extraction');assert.equal(c.sourceDatasetId,'registry-only');
    await collections.addManual(c.collectionId,a);await collections.addManual(c.collectionId,a);await collections.addManual(c.collectionId,b);
    const payload={pair:[a,b],editor:'Synthetic editor',notes:'Check the plate structures.',difference:'A specifies a support; B specifies an opening.',evidence:[{recordId:a,section:'claims',sourceSpan:'a first plate and a support'},{recordId:b,section:'claims',sourceSpan:'a second plate and an opening'}],expectedVersion:0};
    await assert.rejects(collections.saveManual(c.collectionId,{...payload,evidence:[{...payload.evidence[0],sourceSpan:'invented quote'},payload.evidence[1]]}),/MANUAL_EVIDENCE_NOT_EXACT/);
    const saved=await collections.saveManual(c.collectionId,payload);assert.equal(saved.manualRevisions.length,1);
    await assert.rejects(collections.saveManual(c.collectionId,payload),/MANUAL_VERSION_CONFLICT/);
    const again=createPatentCollectionService({pilotPath:join(dir,'pilot.json'),datasetPath:join(dir,'missing-dataset.json'),storePath:join(dir,'collections.json'),repositoryStorePath:join(dir,'repository.json'),featureStorePath:join(dir,'features.json')});
    assert.equal((await again.get(c.collectionId)).manualRevisions.length,1);
    const exportData=await again.exportCollection(c.collectionId);assert.equal(exportData.json.featureSnapshots.length,0);assert.equal(exportData.json.manualEntries.length,2);assert.match(exportData.markdown,/a first plate and a support/);assert.match(exportData.markdown,/self-entered, unverified/);assert.equal(exportData.json.manualEntries[0].tags.length,1);
    const aiCandidate=await again.saveManual(c.collectionId,{...payload,source:'external_ai_suggestion',difference:'Synthetic AI candidate; both exact quotations still require review.',expectedVersion:1});assert.equal(aiCandidate.manualRevisions[1].source,'external_ai_suggestion');
    const aiExport=await again.exportCollection(c.collectionId);assert.match(aiExport.markdown,/external AI suggestion/);assert.equal(aiExport.json.manualComparison.source,'external_ai_suggestion');
    await assert.rejects(again.saveManual(c.collectionId,{...payload,source:'verified_gold',expectedVersion:2}),/INVALID_MANUAL_RESEARCH/);
    const registry=await pilot.handle('state',{});assert.equal(registry.records[0].manualTagRevisions.length,2);assert.deepEqual(registry.records[0].independentClaims,docs[0].independentClaims);
    await pilot.handle('import',{format:'json',text:JSON.stringify(docs)});assert.deepEqual((await pilot.handle('state',{})).records[0].manualTags,['plate']);
  }finally{await rm(dir,{recursive:true,force:true});}
});
