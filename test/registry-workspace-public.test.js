import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildSyntheticDemoDataset} from '../scripts/start-portfolio-demo.js';
import {createPilotService} from '../src/pilot/service.ts';
import {createApp} from '../src/server.js';
import {loadRegistryContext} from '../public/registry-context.js';

test('synthetic registry links only matching source and Claim 1 without extraction',async()=>{
  const dir=await mkdtemp(join(resolve('data'),'registry-context-mock-'));
  const paths={pilotPath:join(dir,'pilot.json'),thermalDatasetPath:join(dir,'dataset.json'),featureStorePath:join(dir,'features.json'),repositoryStorePath:join(dir,'repository.json'),collectionStorePath:join(dir,'collections.json'),comparisonStorePath:join(dir,'comparison.json'),featureLlmStorePath:join(dir,'llm.json')};
  const dataset=buildSyntheticDemoDataset(),doc=dataset.entries[0];await writeFile(paths.thermalDatasetPath,JSON.stringify(dataset));
  const pilot=createPilotService({path:paths.pilotPath,getKey:()=>undefined,fetchImpl:async()=>{throw Error('EXTERNAL_FORBIDDEN')}});
  const imported=await pilot.handle('import',{format:'json',text:JSON.stringify([{publicationNumber:doc.publicationNumber,title:'Synthetic registry',sourceUrl:doc.sourceUrl,independentClaims:doc.independentClaims}])});
  const app=createApp({...paths,getXaiKey:()=>null,fetchImpl:async()=>{throw Error('EXTERNAL_FORBIDDEN')}});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`,nativeFetch=globalThis.fetch;
  try{const csrf=(await(await nativeFetch(base+'/api/xai/settings/csrf')).json()).csrfToken;globalThis.fetch=(url,options)=>nativeFetch(new URL(url,base),{...options,headers:{...options?.headers,Origin:base}});
    const linked=await loadRegistryContext(imported.ids[0],csrf);assert.equal(linked.linked,true);assert.equal(linked.source.documentHash,doc.contentHash);
    await pilot.handle('correct-metadata',{recordId:imported.ids[0],field:'title',value:'Synthetic corrected',editor:'Mock Editor',reason:'Synthetic correction',expectedVersion:0});
    assert.equal((await loadRegistryContext(imported.ids[0],csrf)).record.title,'Synthetic corrected');
    const wrong=await pilot.handle('import',{format:'json',text:JSON.stringify([{publicationNumber:dataset.entries[1].publicationNumber,title:'Synthetic mismatch',sourceUrl:'https://example.org/different',independentClaims:dataset.entries[1].independentClaims}])});assert.equal((await loadRegistryContext(wrong.ids[0],csrf)).linked,false);
    assert.equal((await pilot.handle('state',{})).records.find(x=>x.id===imported.ids[0]).metadataCorrections.length,1);
  }finally{globalThis.fetch=nativeFetch;await new Promise(r=>app.close(r));await rm(dir,{recursive:true,force:true});}
});
