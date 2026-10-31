import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createApp} from '../src/server.js';
import {buildSyntheticDemoDataset} from '../scripts/start-portfolio-demo.js';

// Synthetic/mock only. All stores are isolated and the external provider is disabled.
test('guided search keeps field/text distinctions and pins exact collection snapshots',async()=>{
  await mkdir(resolve('data'),{recursive:true});
  const dir=await mkdtemp(join(resolve('data'),'guided-public-'));
  const paths={thermalDatasetPath:join(dir,'dataset.json'),featureStorePath:join(dir,'features.json'),repositoryStorePath:join(dir,'repository.json'),collectionStorePath:join(dir,'collections.json'),comparisonStorePath:join(dir,'comparisons.json'),featureLlmStorePath:join(dir,'llm-audit.json')};
  await writeFile(paths.thermalDatasetPath,JSON.stringify(buildSyntheticDemoDataset()));
  let external=0;
  const app=createApp({...paths,getXaiKey:()=>null,fetchImpl:async()=>{external++;throw new Error('EXTERNAL_FORBIDDEN');}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.address().port}`;
  try{
    const csrf=(await(await fetch(base+'/api/xai/settings/csrf')).json()).csrfToken;
    const post=async(path,body={})=>{const response=await fetch(base+'/api/'+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Patent-Client':'workbench','X-Patent-CSRF':csrf},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};};
    const ids=['EP9000001A1','EP9000002A1'];
    assert.equal((await post('patent-repository/preview',{publicationNumbers:ids})).status,200);
    assert.equal((await post('patent-repository/run-batch',{publicationNumbers:ids})).status,200);
    const text=(await post('patent-repository/search',{query:{text:'plasticizer'}})).value;
    assert.equal(text.results.length,2);
    assert.equal(text.results[0].matchKind,'text_candidate_match');
    assert.ok(text.results[0].keyElements.some(x=>x.elementName));
    const fields=(await post('patent-repository/search',{query:{element:'plasticizer'}})).value;
    assert.equal(fields.results.length,2);
    assert.equal(fields.results[0].matchKind,'verified_field_match');
    const [a,b]=fields.results;
    assert.equal((await post('patent-compare/source',{publicationNumber:a.publicationNumber,ref:{recordId:b.extractionRecordId,revisionId:b.currentRevisionId}})).status,400);
    assert.equal((await post('patent-compare/source',{publicationNumber:a.publicationNumber,ref:{recordId:a.extractionRecordId,revisionId:'stale-revision'}})).status,400);
    const created=(await post('patent-collections/create',{title:'Synthetic guided study',description:'',optionalNotes:''})).value;
    for(const x of [a,b])assert.equal((await post('patent-collections/add',{collectionId:created.collectionId,extractionRecordId:x.extractionRecordId,revisionId:x.currentRevisionId})).status,200);
    assert.equal((await post('patent-collections/add',{collectionId:created.collectionId,extractionRecordId:a.extractionRecordId,revisionId:'stale-revision'})).status,400);
    const exported=(await post('patent-collections/export',{collectionId:created.collectionId})).value;
    assert.deepEqual(exported.json.selectedFeatureRecords.map(x=>x.extractionRecordId),[a.extractionRecordId,b.extractionRecordId]);
    assert.equal(exported.json.featureSnapshots.length,2);
    assert.equal(external,0);
  }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));await rm(dir,{recursive:true,force:true});}
});
