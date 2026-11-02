import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createPilotService} from '../src/pilot/service.ts';
import {createPatentCollectionService} from '../src/pilot/patent-collections.ts';

test('synthetic collections rename, move, remove and delete atomically while preserving registry and cited history',async()=>{
  const dir=await mkdtemp(join(resolve('data'),'collection-management-synthetic-'));
  try{
    const pilotPath=join(dir,'pilot.json'),storePath=join(dir,'collections.json');
    const pilot=createPilotService({path:pilotPath,getKey:()=>undefined,fetchImpl:async()=>{throw Error('EXTERNAL_FORBIDDEN')}});
    const service=createPatentCollectionService({pilotPath,storePath,datasetPath:join(dir,'missing.json'),featureStorePath:join(dir,'features.json'),repositoryStorePath:join(dir,'repository.json')});
    const docs=[1,2,3].map(n=>({publicationNumber:`EP900080${n}A1`,title:`Synthetic ${n}`,independentClaims:[`A synthetic chamber with plate ${n}.`]}));
    const {ids}=await pilot.handle('import',{format:'json',text:JSON.stringify(docs)});
    let a=await service.create('Source','Synthetic'),b=await service.create('Target','Synthetic');
    await assert.rejects(service.edit(a.collectionId,'','Synthetic','',a.updatedAt),/COLLECTION_TITLE_REQUIRED/);
    a=await service.edit(a.collectionId,'Renamed','Synthetic','',a.updatedAt);assert.equal(a.collectionId,(await service.get(a.collectionId)).collectionId);
    await assert.rejects(service.edit(a.collectionId,'Stale','Synthetic','',a.createdAt),/COLLECTION_VERSION_CONFLICT/);
    a=await service.addManual(a.collectionId,ids[0]);a=await service.addManual(a.collectionId,ids[1]);
    const before=await readFile(storePath,'utf8');
    await assert.rejects(service.move(a.collectionId,b.collectionId,docs[0].publicationNumber,a.createdAt,b.updatedAt),/COLLECTION_VERSION_CONFLICT/);
    assert.equal(await readFile(storePath,'utf8'),before);
    const moved=await service.move(a.collectionId,b.collectionId,docs[0].publicationNumber,a.updatedAt,b.updatedAt);a=moved.source;b=moved.target;
    assert.equal(a.manualEntries.length,1);assert.equal(b.manualEntries.length,1);
    await assert.rejects(service.move(a.collectionId,b.collectionId,docs[0].publicationNumber,a.updatedAt,b.updatedAt),/COLLECTION_PATENT_NOT_FOUND/);
    await service.addManual(a.collectionId,ids[0]);a=await service.get(a.collectionId);
    await assert.rejects(service.move(a.collectionId,b.collectionId,docs[0].publicationNumber,a.updatedAt,b.updatedAt),/COLLECTION_TARGET_DUPLICATE/);
    a=await service.remove(a.collectionId,docs[0].publicationNumber,a.updatedAt);
    const pair=[ids[1],ids[2]];a=await service.addManual(a.collectionId,ids[2]);
    a=await service.saveManual(a.collectionId,{pair,editor:'Synthetic editor',notes:'',difference:'Synthetic difference',evidence:[{recordId:ids[1],section:'claims',sourceSpan:'plate 2'},{recordId:ids[2],section:'claims',sourceSpan:'plate 3'}],expectedVersion:0});
    await assert.rejects(service.remove(a.collectionId,docs[1].publicationNumber,a.updatedAt),/COLLECTION_MANUAL_HISTORY_DEPENDENCY/);
    await assert.rejects(service.move(a.collectionId,b.collectionId,docs[1].publicationNumber,a.updatedAt,b.updatedAt),/COLLECTION_MANUAL_HISTORY_DEPENDENCY/);
    assert.equal((await service.get(a.collectionId)).manualRevisions.length,1);
    await assert.rejects(service.deleteCollection(a.collectionId,a.createdAt),/COLLECTION_VERSION_CONFLICT/);
    await service.deleteCollection(a.collectionId,a.updatedAt);
    await assert.rejects(service.get(a.collectionId),/COLLECTION_NOT_FOUND/);
    assert.equal((await service.get(b.collectionId)).manualEntries.length,1);
    assert.equal((await pilot.handle('state',{})).records.length,3);
  }finally{await rm(dir,{recursive:true,force:true});}
});
