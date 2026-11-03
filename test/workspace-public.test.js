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
    for(const path of ['/workspace','/patent-library','/patent-search','/pilot','/pilot-v3','/pilot-thermal','/patent-features','/patent-repository','/patent-compare','/workspace.js','/workspace-nav.js','/i18n/workspace.js','/i18n/enterprise-ux.js','/enterprise-ux.css']){
      const response=await fetch(root+path);
      assert.equal(response.status,200,path);
    }
    const legacy=await(await fetch(root+'/patent-search')).text();
    assert.match(legacy,/research-main/);
  }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
});


test('formal workspace has a primary library entry and bilingual task destinations',async()=>{
  const html=await readFile(new URL('../public/workspace.html',import.meta.url),'utf8');
  assert.match(html,/workspace-primary/);
  for(const path of ['/patent-library','/patent-features','/patent-repository?task=search','/patent-repository?task=compare','/patent-repository?task=collections'])assert.ok(html.includes(`href="${path}"`),path);
  for(const path of ['/pilot','/pilot-v3','/pilot-thermal','/patent-search','/review-thermal'])assert.ok(!html.includes(`href="${path}"`),path);
  for(const key of ['workspace.brand','workspace.path.library','workspace.path.extract','workspace.path.search','workspace.path.compare','workspace.path.collections'])assert.ok(locale.zh[key]&&locale.en[key],key);
});

test('normal local service redirects legacy pages while internal mode preserves them',async()=>{
  const app=createApp({legacyUiMode:false,getXaiKey:()=>null,fetchImpl:async()=>{throw new Error('EXTERNAL_FORBIDDEN');}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const root=`http://127.0.0.1:${app.address().port}`;
  try{for(const path of ['/pilot','/pilot-v3','/pilot-thermal','/patent-search','/review-thermal']){const response=await fetch(root+path,{redirect:'manual'});assert.equal(response.status,302,path);assert.equal(response.headers.get('location'),'/workspace?legacy=1');}assert.equal((await fetch(root+'/patent-library')).status,200);}finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
});

test('formal patent library uses the shared header without Pilot branding',async()=>{
  const html=await readFile(new URL('../public/patent-library.html',import.meta.url),'utf8');
  const nav=await readFile(new URL('../public/workspace-nav.js',import.meta.url),'utf8');
  const script=await readFile(new URL('../public/patent-library.js',import.meta.url),'utf8');
  assert.match(html,/<header><\/header>/);
  assert.match(html, /href="\/workspace.css"/);
  assert.match(html, /src="\/patent-library.js"/);
  assert.match(html, /id="record-total">0<\/strong>/);
  assert.doesNotMatch(html, /PatentLens Pilot|PILOT 0\.2|<header class="top"|\/pilot\.css|\/pilot\.js|id="lab"|id="benchmark"/);
  assert.match(script, /mountWorkspaceNavigation\('library'\)/);
  assert.match(nav, /workspace-brand/);
  for(const path of ['/pilot','/pilot-v3','/pilot-thermal','/patent-search','/review-thermal'])assert.ok(!html.includes(`href="${path}"`),path);
});
