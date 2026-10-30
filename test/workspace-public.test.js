import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createApp} from '../src/server.js';
import locale from '../public/i18n/workspace.js';

// Public synthetic/mock route and copy checks. No dataset, Key, or paid provider is required.
test('workspace and legacy routes remain reachable',async()=>{
  const app=createApp({getXaiKey:()=>null,fetchImpl:async()=>{throw new Error('EXTERNAL_FORBIDDEN');}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const root=`http://127.0.0.1:${app.address().port}`;
  try{
    const home=await(await fetch(root+'/')).text();
    assert.match(home,/专利技术研究工作台/);
    for(const path of ['/workspace','/patent-search','/pilot','/pilot-v3','/pilot-thermal','/patent-features','/patent-repository','/patent-compare','/workspace.js','/workspace-nav.js','/i18n/workspace.js']){
      const response=await fetch(root+path);
      assert.equal(response.status,200,path);
    }
    const legacy=await(await fetch(root+'/patent-search')).text();
    assert.match(legacy,/research-main/);
  }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
});

test('four task paths and bilingual labels have distinct destinations',async()=>{
  const html=await readFile(new URL('../public/workspace.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../public/workspace.js',import.meta.url),'utf8');
  assert.match(script,/location\.replace\('\/patent-search'\+location\.hash\)/);
  for(const path of ['/patent-features','/patent-repository?task=search','/patent-repository?task=compare','/patent-repository?task=collections'])assert.ok(html.includes(`href="${path}"`),path);
  for(const key of ['workspace.brand','workspace.path.extract','workspace.path.search','workspace.path.compare','workspace.path.collections','workspace.nav.advanced'])assert.ok(locale.zh[key]&&locale.en[key],key);
});
