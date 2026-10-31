import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createPilotService} from '../src/pilot/service.ts';

test('synthetic registry corrections preserve import baseline, history and duplicate behavior',async()=>{
  const dir=await mkdtemp(join(resolve('data'),'metadata-mock-'));
  try{
    const path=join(dir,'pilot.json'),svc=createPilotService({path,fetchImpl:async()=>{throw Error('PAID_FORBIDDEN')},retrievalFetchImpl:async()=>{throw Error('NETWORK_FORBIDDEN')},getKey:()=>undefined});
    const source={publicationNumber:'EP9000301A1',title:'Synthetic original',assignees:['Mock Applicant'],filingDate:'2020-01-02',sourceUrl:'https://example.org/mock'};
    const imported=await svc.handle('import',{format:'json',text:JSON.stringify([source])});assert.equal(imported.added,1);
    const id=imported.ids[0],first=(await svc.handle('state',{})).records[0];assert.equal(first.metadataVersion??0,0);
    const correct=(field,value,expectedVersion,reason='Synthetic correction')=>svc.handle('correct-metadata',{recordId:id,field,value,editor:'Mock Editor',reason,expectedVersion});
    await correct('title','Synthetic revised',0);await correct('title','Synthetic final',1,'Second synthetic review');
    let record=(await svc.handle('state',{})).records[0];assert.equal(record.title,'Synthetic final');assert.equal(record.metadataVersion,2);assert.equal(record.metadataCorrections.length,2);assert.deepEqual(record.metadataCorrections.map(x=>[x.before,x.after]),[['Synthetic original','Synthetic revised'],['Synthetic revised','Synthetic final']]);assert.equal(record.originalImportMetadata.title,'Synthetic original');assert.equal(record.metadataCorrections[0].originalSourceUrl,source.sourceUrl);
    assert.equal((await svc.handle('import',{format:'json',text:JSON.stringify([source])})).duplicates,1);
    record=(await svc.handle('state',{})).records[0];assert.equal(record.title,'Synthetic final');assert.equal(record.metadataCorrections.length,2);
    await assert.rejects(correct('title','Stale',1),/版本冲突/);await assert.rejects(correct('publicationNumber','EP9000302A1',2),/更正字段/);await assert.rejects(correct('filingDate','2020-02-30',2),/日期无效/);await assert.rejects(correct('jurisdiction','INVALID',2),/法域/);await assert.rejects(correct('title','Synthetic final',2),/相同/);
    const results=await Promise.allSettled([correct('title','Concurrent A',2),correct('title','Concurrent B',2)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
    const persisted=JSON.parse(await readFile(path,'utf8')).records[0];assert.equal(persisted.metadataCorrections.length,3);assert.equal(persisted.originalImportMetadata.title,'Synthetic original');assert.equal(persisted.independentClaims.length,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
