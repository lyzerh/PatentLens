import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {createApp} from '../src/server.js';

const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if(!executablePath)throw Error('Browser unavailable');
let modelListCalls=0,paidCalls=0;
const mockFetch=async(url)=>{
  if(url==='https://api.x.ai/v1/models'){
    modelListCalls++;
    return new Response(JSON.stringify({data:[{id:'grok-4.3'}]}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  paidCalls++;
  throw Error('EXTERNAL_REQUEST_FORBIDDEN');
};
const app=createApp({fetchImpl:mockFetch,getXaiKey:()=>undefined,legacyUiMode:false});
await new Promise(done=>app.listen(0,'127.0.0.1',done));
let browser;
try{
  browser=await chromium.launch({executablePath,headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const base=`http://127.0.0.1:${app.address().port}`;
  await page.goto(base+'/workspace');
  await page.getByRole('button',{name:'API 设置'}).click();
  const dialog=page.locator('#workspace-key-dialog');
  await dialog.getByText('未配置 API Key').waitFor();
  const shots=resolve('data/visual-key-settings');await mkdir(shots,{recursive:true});
  await page.screenshot({path:resolve(shots,'workspace-key-1440-zh.png')});
  assert.equal(await page.locator('input[type=password]').count(),1);
  await page.locator('#workspace-key-input').fill('synthetic-ui-key-123456');
  await dialog.getByRole('button',{name:'保存 Key'}).click();
  await dialog.getByText(/已配置（来源：当前服务会话）/).waitFor();
  assert.equal(await page.locator('#workspace-key-input').inputValue(),'');
  assert.ok(!(await page.locator('body').innerText()).includes('synthetic-ui-key-123456'));
  assert.equal(modelListCalls,0);
  await dialog.getByRole('button',{name:'测试连接'}).click();
  await dialog.getByText(/已连接；未验证生成能力/).waitFor();
  assert.equal(modelListCalls,1);
  await dialog.getByRole('button',{name:'关闭'}).click();
  await page.reload();
  await page.getByRole('button',{name:'API 设置'}).click();
  await dialog.getByText(/已配置（来源：当前服务会话）/).waitFor();
  await dialog.getByRole('button',{name:'清除临时 Key'}).click();
  await dialog.getByText('未配置 API Key').waitFor();
  await dialog.getByRole('button',{name:'关闭'}).click();
  await page.locator('.language-switcher button[data-lang="en"]').click();
  await page.getByRole('button',{name:'API settings'}).click();
  await dialog.getByText('No API Key configured').waitFor();
  await dialog.getByRole('button',{name:'Close'}).click();
  for(const route of ['/patent-library','/patent-features','/patent-repository?task=search']){
    await page.goto(base+route);
    assert.equal(await page.getByRole('button',{name:'API settings'}).count(),1);
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'API settings'}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth<=2));
  await page.screenshot({path:resolve(shots,'workspace-key-390-en.png')});
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(),false);
  assert.deepEqual(errors,[]);
  assert.equal(paidCalls,0);
  console.log('Workspace Key UI: save, free model-list test, refresh, clear, bilingual shared entry and mobile passed; paid requests 0');
}finally{
  await browser?.close();
  app.closeAllConnections();
  await new Promise(done=>app.close(done));
}
