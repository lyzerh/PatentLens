import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {buildSyntheticDemoDataset} from './start-portfolio-demo.js';
import {createApp} from '../src/server.js';

// Isolated synthetic/mock UI acceptance; no xAI Key, EPO request, or paid provider.
const browserPath=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(path=>path&&existsSync(path));
if(!browserPath)throw new Error('Chrome or Edge is required for UI acceptance.');
await mkdir(resolve('data'),{recursive:true});
const dir=await mkdtemp(join(resolve('data'),'workspace-ux-'));
const paths={thermalDatasetPath:join(dir,'dataset.json'),featureStorePath:join(dir,'features.json'),repositoryStorePath:join(dir,'repository.json'),collectionStorePath:join(dir,'collections.json'),comparisonStorePath:join(dir,'comparisons.json'),featureLlmStorePath:join(dir,'llm-audit.json')};
await writeFile(paths.thermalDatasetPath,JSON.stringify(buildSyntheticDemoDataset()));
let externalCalls=0;
const app=createApp({...paths,getXaiKey:()=>null,fetchImpl:async()=>{externalCalls++;throw new Error('EXTERNAL_FORBIDDEN');}});
await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${app.address().port}`;
let browser;
try{
  browser=await chromium.launch({executablePath:browserPath,headless:true,downloadsPath:dir});
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:900}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.location().url.endsWith('/favicon.ico'))errors.push(message.location().url+' '+message.text());});
  await page.goto(base+'/');
  assert.match(await page.locator('h1').innerText(),/专利技术研究工作台/);
  await page.screenshot({path:join(dir,'workspace-desktop.png'),fullPage:true});
  for(const href of ['/patent-features','/patent-repository?task=search','/patent-repository?task=compare','/patent-repository?task=collections'])assert.equal(await page.locator(`.paths a[href="${href}"]`).count(),1);
  await page.locator('.language-switcher button[data-lang="en"]').click();assert.match(await page.locator('h1').innerText(),/Patent Research Workspace/);
  await page.locator('.language-switcher button[data-lang="zh-CN"]').click();
  await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement!==document.body));
  for(const width of [1440,768,390]){await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`workspace overflow at ${width}`);if(width===390)await page.screenshot({path:join(dir,'workspace-mobile.png'),fullPage:true});}
  await page.goto(base+'/patent-search');assert.equal(await page.locator('#research-main').count(),1);
  await page.goto(base+'/pilot-thermal');assert.equal(await page.locator('main').count(),1);
  // The legacy thermal page expects its full frozen dataset, not this four-document synthetic fixture.
  errors.length=0;
  // Prepare two free feature records through the existing advanced Rules workflow.
  await page.goto(base+'/patent-repository?task=advanced');
  await page.locator('#documents input[value="EP9000001A1"]').check();
  await page.locator('#documents input[value="EP9000002A1"]').check();
  await page.locator('#preview').click();await page.locator('#run').click();
  await page.locator('#results .row').filter({hasText:'EP9000002A1'}).waitFor();
  await page.goto(base+'/');await page.locator('.paths a[href="/patent-repository?task=compare"]').click();
  await page.locator('#results .row').filter({hasText:'EP9000001A1'}).getByRole('button',{name:/设为 A|Choose A/}).click();
  await page.locator('#results .row').filter({hasText:'EP9000002A1'}).getByRole('button',{name:/设为 B|Choose B/}).click();
  assert.equal(await page.locator('#compare').isEnabled(),true);
  await page.locator('#compare').click();await page.waitForURL(/\/patent-compare\?/);
  await page.locator('#side-a').getByText(/EP9000001A1/).first().waitFor({timeout:10000});
  assert.match(await page.locator('#side-a').innerText(),/EP9000001A1/);
  assert.match(await page.locator('#side-b').innerText(),/EP9000002A1/);
  await page.locator('.language-switcher button[data-lang="en"]').click();assert.match(await page.locator('h1').innerText(),/Two-patent technical feature comparison/);
  await page.locator('.language-switcher button[data-lang="zh-CN"]').click();
  for(const width of [768,390]){await page.setViewportSize({width,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`comparison overflow at ${width}`);}
  await page.setViewportSize({width:1440,height:900});
  await page.locator('#generate').click();await page.locator('#alignments').getByText(/↔/).first().waitFor();
  await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#history')?.value);
  await page.locator('#alignments button').first().click();assert.match(await page.locator('#evidence').innerText(),/EP9000001A1/);
  await page.getByRole('link',{name:/继续到研究项目|Continue to research project/}).click();
  await page.waitForURL(/task=collections/);await page.waitForFunction(()=>document.querySelector('#compare-selection')?.textContent?.includes('EP9000002A1'));assert.match(await page.locator('#compare-selection').innerText(),/EP9000001A1.*EP9000002A1/);
  await page.locator('#collection-title').fill('Synthetic UX research');await page.locator('#collection-create').click();
  await page.locator('#add-pair').click();await page.waitForFunction(()=>document.querySelector('#collection-list')?.selectedOptions[0]?.textContent?.includes('· 2'));
  const collectionId=await page.locator('#collection-list').inputValue();assert.ok(collectionId);
  await page.reload();await page.locator('#collection-list option[value="'+collectionId+'"]').waitFor({state:'attached'});await page.locator('#collection-list').selectOption(collectionId);await page.waitForFunction(()=>document.querySelector('#collection-detail')?.textContent?.includes('EP9000002A1'));assert.match(await page.locator('#collection-detail').innerText(),/EP9000001A1.*EP9000002A1/s);
  const event=page.waitForEvent('download');await page.locator('#collection-md').click();const download=await event;assert.match(download.suggestedFilename(),/\.md$/);
  const saved=join(dir,download.suggestedFilename());await download.saveAs(saved);const markdown=new TextDecoder('utf-8',{fatal:true}).decode(await readFile(saved));assert.match(markdown,/EP9000001A1/);assert.match(markdown,/EP9000002A1/);assert.match(markdown,/machine_generated_unreviewed/);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'collection mobile overflow');
  await page.screenshot({path:join(dir,'collection-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);assert.equal(externalCalls,0);
  console.log('Synthetic browser UX: home, four paths, locale, compare, evidence, collection reload, Markdown download, responsive, console, no paid calls: passed');
  console.log(`Screenshots: ${dir}`);
}finally{await browser?.close();await new Promise(resolve=>app.close(resolve));}
