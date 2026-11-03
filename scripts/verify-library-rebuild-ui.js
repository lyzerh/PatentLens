import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {createApp} from '../src/server.js';
import {buildSyntheticDemoDataset} from './start-portfolio-demo.js';

const browserPath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if(!browserPath)throw new Error('Chrome or Edge unavailable');
await mkdir(resolve('data'),{recursive:true});
const dir=await mkdtemp(join(resolve('data'),'library-rebuild-synthetic-'));
const shots=resolve('data/visual-library-rebuild-acceptance');await mkdir(shots,{recursive:true});
await writeFile(join(dir,'dataset.json'),JSON.stringify(buildSyntheticDemoDataset()));
let externalCalls=0;
const forbidden=async()=>{externalCalls++;throw new Error('EXTERNAL_FORBIDDEN');};
const app=createApp({pilotPath:join(dir,'pilot.json'),thermalDatasetPath:join(dir,'dataset.json'),featureStorePath:join(dir,'features.json'),repositoryStorePath:join(dir,'repository.json'),collectionStorePath:join(dir,'collections.json'),comparisonStorePath:join(dir,'comparison.json'),featureLlmStorePath:join(dir,'llm.json'),fetchImpl:forbidden,getXaiKey:()=>null,legacyUiMode:false});
await new Promise(done=>app.listen(0,'127.0.0.1',done));
let browser;
try{
  browser=await chromium.launch({executablePath:browserPath,headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.location().url.endsWith('/favicon.ico'))errors.push(message.text());});
  const base=`http://127.0.0.1:${app.address().port}`;
  await page.goto(base+'/workspace');await page.locator('a[href="/patent-library"]').first().click();await page.waitForURL(/\/patent-library$/);
  await page.locator('#record-total').waitFor();
  assert.equal(await page.locator('header').count(),1);
  assert.equal(await page.locator('.workspace-nav').count(),1);
  assert.equal(await page.locator('.workspace-nav a[aria-current="page"]').getAttribute('href'),'/patent-library');
  assert.equal(await page.locator('link[href="/pilot.css"],script[src="/pilot.js"]').count(),0);
  assert.doesNotMatch(await page.locator('body').innerText(),/PatentLens Pilot|PILOT 0\.2|Benchmark/);
  const navStyle=await page.locator('header').evaluate(header=>({background:getComputedStyle(header).backgroundColor,link:getComputedStyle(header.querySelector('.workspace-nav a')).color}));
  assert.equal(navStyle.background,'rgb(16, 40, 59)');assert.notEqual(navStyle.link,navStyle.background);

  const first={publicationNumber:'EP9000888A1',title:'Synthetic official chamber title',abstract:'Synthetic abstract for a two plate chamber.',assignees:['Synthetic applicant'],independentClaims:['A synthetic chamber comprising two plates.'],sourceUrl:'https://example.org/synthetic/EP9000888A1',priorityDate:'2024-01-12',publicationDate:'2025-08-21',cpc:['H01L23/427','H05K7/20336','F28D15/0233','H01M10/6554','H05K7/20409'],ipc:['H01L23/427','F28D15/02','H05K7/20','H01M10/6554']};
  await page.locator('#import-file').setInputFiles({name:'synthetic-library.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([first]))});
  await page.locator('#import-button').click();await page.getByText('导入 1 条，跳过重复 0 条。').waitFor();
  assert.equal(await page.locator('#record-total').innerText(),'1');
  await page.locator('#import-button').click();await page.getByText('导入 0 条，跳过重复 1 条。').waitFor();
  const csv='publicationNumber,title,abstract,assignees,independentClaims\nEP9000889A1,Synthetic second chamber,Synthetic second abstract,Synthetic applicant,A synthetic chamber with an opening.\n';
  await page.locator('#import-file').setInputFiles({name:'synthetic-library.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
  await page.locator('#import-button').click();await page.getByText('导入 1 条，跳过重复 0 条。').waitFor();
  assert.equal(await page.locator('#record-total').innerText(),'2');
  await page.locator('#epo-id').fill('US123');await page.locator('#epo-import').click();await page.locator('#notice.error').waitFor();
  assert.equal(externalCalls,0);
  errors.length=0; // The rejected EPO request produces one expected browser resource error.
  await page.locator('#registry-search').fill('ep-900 0888a1');await page.locator('#registry-list button').waitFor();
  assert.equal(await page.locator('#registry-list button').count(),1);
  await page.locator('#registry-list button').click();
  assert.match(await page.locator('#record-detail').innerText(),/Synthetic official chamber title/);
  await page.getByText('更多著录字段').click();

  await page.locator('.library-metadata-editor').evaluate(item=>item.open=true);
  await page.locator('.library-metadata-editor select').selectOption('title');
  await page.locator('.library-metadata-editor input').first().fill('Synthetic corrected title');
  await page.locator('.library-metadata-editor input').nth(1).fill('Synthetic editor');
  await page.locator('.library-metadata-editor textarea').fill('Synthetic source correction');
  page.on('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'确认保存更正'}).click();await page.getByText('更正已保存。').waitFor();
  assert.match(await page.locator('#record-detail').innerText(),/Synthetic corrected title/);
  await page.locator('.research-summary details').first().evaluate(item=>item.open=true);
  await page.getByLabel('内部技术短标题（最多20字）').fill('合成双板腔体');
  await page.getByLabel('通俗简介（最多80字）').fill('两块板构成一个腔体。');
  await page.getByLabel('建议标签（分号分隔，最多5个）').fill('腔体; 双板');
  await page.locator('.research-summary select').selectOption('manual');
  await page.locator('.research-summary input').nth(2).fill('Synthetic editor');
  await page.locator('.research-summary textarea').nth(1).fill('Synthetic internal note');
  await page.getByRole('button',{name:'保存研究简介'}).click();await page.getByText('研究简介已保存。').waitFor();
  await page.locator('.library-tags-editor').evaluate(item=>item.open=true);
  await page.locator('.library-tags-editor input').first().fill('均热板; 双板');
  await page.locator('.library-tags-editor input').nth(1).fill('Synthetic editor');
  await page.getByRole('button',{name:'保存标签'}).click();await page.getByText('人工标签已保存').waitFor();
  await page.reload();await page.locator('#registry-list button').first().waitFor();
  assert.equal(await page.locator('#record-total').innerText(),'2');
  assert.match(await page.locator('#record-detail').innerText(),/Synthetic corrected title/);
  assert.match(await page.locator('#record-detail').innerText(),/合成双板腔体/);
  assert.match(await page.locator('#record-detail').innerText(),/均热板 · 双板/);
  await page.locator('#record-detail details').filter({hasText:'修订历史（1）'}).first().evaluate(item=>item.open=true);
  assert.match(await page.locator('#record-detail').innerText(),/Synthetic official chamber title/);
  await page.locator('.research-summary details').first().evaluate(item=>item.open=true);
  await page.getByLabel('通俗简介（最多80字）').fill('未保存的合成修改');
  await page.locator('.language-switcher button[data-lang="en"]').click();
  assert.equal(await page.getByLabel('Plain-language summary (up to 80 characters)').inputValue(),'未保存的合成修改');
  assert.equal(await page.locator('#record-total').innerText(),'2');

  for(const [width,lang] of [[1440,'en'],[390,'en'],[1440,'zh-CN'],[768,'zh-CN'],[390,'zh-CN']]){
    await page.setViewportSize({width,height:900});await page.locator(`.language-switcher button[data-lang="${lang}"]`).click();
    const more=page.locator('.library-detail-section details').filter({has:page.locator('.library-facts')}).first();await more.evaluate(item=>item.open=true);
    const layout=await more.locator('.library-fact').evaluateAll(items=>items.map(item=>{const bounds=item.getBoundingClientRect(),value=item.querySelector('.library-fact-value')?.getBoundingClientRect(),note=item.querySelector('.library-fact-note')?.getBoundingClientRect(),link=item.querySelector('.library-link')?.getBoundingClientRect(),button=item.querySelector('button')?.getBoundingClientRect();return {label:item.querySelector('.library-fact-label')?.textContent,valid:(!value||value.right<=bounds.right+1)&&(!note||!value||note.top>=value.bottom-1)&&(!link||!note||link.top>=note.bottom-1)&&(!button||!link||button.top>=link.bottom+4)&&(!button||button.right<=bounds.right+1)};}));
    assert.ok(layout.every(item=>item.valid),`${width} ${lang}: ${JSON.stringify(layout)}`);
    assert.ok(layout.length>=9);
    assert.ok((await page.locator('.workspace-nav a').first().evaluate(item=>item.getBoundingClientRect().width))>0);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.ok(overflow<=2,`${width} ${lang}: ${overflow}px overflow`);
    await page.screenshot({path:join(shots,`patent-library-${width}-${lang}.png`),fullPage:true});
  }
  await page.locator('.library-fact').filter({has:page.locator('.library-fact-label', {hasText:'CPC 分类号'})}).getByRole('button').click();
  await page.getByText('字段已记录为人工核验；请确保已亲自比对来源。').waitFor();
  await page.locator('.library-detail-section details').filter({has:page.locator('.library-facts')}).first().evaluate(item=>item.open=true);
  assert.match(await page.locator('.library-fact').filter({has:page.locator('.library-fact-label', {hasText:'CPC 分类号'})}).innerText(),/人工已核验/);
  const workspaceEntry=await page.locator('#record-detail a[href^="/workspace?registry="]').getAttribute('href');
  await page.goto(base+workspaceEntry);await page.locator('.registry-context-actions a').first().waitFor();
  assert.ok(errors.every(message=>message==='Failed to load resource: the server responded with a status of 400 (Bad Request)'));errors.length=0; // Synthetic record has no frozen source.
  const expectedRecord=new URLSearchParams(workspaceEntry.split('?')[1]).get('registry');
  assert.ok(expectedRecord);
  assert.equal(await page.locator('.registry-context-actions a').first().getAttribute('href'),'/patent-library?record='+encodeURIComponent(expectedRecord));
  assert.equal(await page.locator('.registry-context-actions a').last().getAttribute('href'),'/patent-repository?task=search&registry='+encodeURIComponent(expectedRecord));
  for(const [width,lang] of [[1440,'zh-CN'],[768,'zh-CN'],[390,'zh-CN'],[1440,'en'],[390,'en']]){
    await page.setViewportSize({width,height:900});await page.locator(`.language-switcher button[data-lang="${lang}"]`).click();
    const buttons=await page.locator('.registry-context-actions a').evaluateAll(items=>items.map(item=>{const style=getComputedStyle(item),bounds=item.getBoundingClientRect();return {background:style.backgroundColor,color:style.color,width:bounds.width,height:bounds.height};}));
    assert.ok(buttons.every(item=>item.background==='rgb(255, 255, 255)'&&item.color==='rgb(0, 94, 112)'&&item.width>100&&item.height>=40),`${width} ${lang}: ${JSON.stringify(buttons)}`);
    assert.ok(await page.locator('.registry-context-source').isVisible());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth<=2));
    await page.screenshot({path:join(shots,`workspace-registry-${width}-${lang}.png`),fullPage:true});
  }
  await page.locator('.registry-context-actions a').first().click();await page.waitForURL(/\/patent-library\?record=/);
  assert.match(await page.locator('#record-detail').innerText(),/Synthetic corrected title/);
  await page.goto(base+workspaceEntry);await page.locator('.registry-context-actions a').last().waitFor();assert.ok(errors.every(message=>message==='Failed to load resource: the server responded with a status of 400 (Bad Request)'));errors.length=0;
  await page.locator('.registry-context-actions a').last().click();await page.waitForURL(/\/patent-repository\?task=search&registry=/);
  assert.ok(await page.locator('#registry-context').isVisible());
  assert.ok(errors.every(message=>message==='Failed to load resource: the server responded with a status of 400 (Bad Request)'));errors.length=0;
  await page.locator('.workspace-nav a[href="/workspace"]').click();await page.waitForURL(/\/workspace$/);
  assert.ok(errors.every(message=>message==='Failed to load resource: the server responded with a status of 400 (Bad Request)'),JSON.stringify(errors));assert.equal(externalCalls,0);
  console.log('Library browser acceptance: JSON/CSV import, dedup, EPO rejection, search, metadata, summary, tags, history, refresh, zh/en and 1440/768/390 passed; external calls 0');
}finally{await browser?.close();await new Promise(done=>app.close(done));await rm(dir,{recursive:true,force:true});}
