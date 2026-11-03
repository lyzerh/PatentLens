import {t,initializeI18n,onLanguageChange} from './i18n/index.js';

const links=[['home','/workspace'],['library','/patent-library'],['search','/patent-repository?task=search'],['extract','/patent-features'],['compare','/patent-repository?task=compare'],['collections','/patent-repository?task=collections']];

function mountKeySettings(header){
  const make=(tag,key)=>{const element=document.createElement(tag);if(key)element.dataset.i18n=key;return element;};
  const trigger=make('button','workspace.key.open');trigger.type='button';trigger.className='workspace-key-button';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls','workspace-key-dialog');header.append(trigger);
  const dialog=document.createElement('dialog');dialog.id='workspace-key-dialog';dialog.className='workspace-key-dialog';dialog.setAttribute('aria-labelledby','workspace-key-title');
  const heading=make('h2','workspace.key.title');heading.id='workspace-key-title';
  const note=make('p','workspace.key.note');
  const label=make('label','workspace.key.label');label.htmlFor='workspace-key-input';
  const input=document.createElement('input');input.id='workspace-key-input';input.type='password';input.autocomplete='off';input.spellcheck=false;
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const result=document.createElement('p');result.setAttribute('role','status');result.setAttribute('aria-live','polite');
  const actions=document.createElement('div');actions.className='workspace-key-actions';
  const action=(key)=>{const button=make('button',key);button.type='button';actions.append(button);return button;};
  const save=action('workspace.key.save'),test=action('workspace.key.test'),clear=action('workspace.key.clear'),close=action('workspace.key.close');
  dialog.append(heading,note,label,input,status,result,actions);document.body.append(dialog);
  let csrf=null,lastStatus=null,resultKey='',busy=false;
  const render=()=>{status.textContent=lastStatus?(lastStatus.configured?t('workspace.key.configured',{source:t('workspace.key.source.'+lastStatus.source)}):t('workspace.key.unconfigured'))+(lastStatus.connectionStatus&&lastStatus.connectionStatus!=='Not configured'?' · '+(t('workspace.key.connection.'+lastStatus.connectionStatus)): ''):t('workspace.key.loading');result.textContent=resultKey?t(resultKey):'';};
  const request=async(method,path,body)=>{if(!csrf)csrf=(await(await fetch('/api/xai/settings/csrf',{cache:'no-store'})).json()).csrfToken;const response=await fetch('/api/xai/settings/'+path,{method,headers:{'X-Patent-Client':'workbench','X-Patent-CSRF':csrf,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(value.error?.message??value.error?.code??'REQUEST_FAILED');return value;};
  const run=async(fn,success)=>{if(busy)return;busy=true;for(const button of [save,test,clear])button.disabled=true;resultKey='';render();try{lastStatus=await fn();resultKey=success;}catch(error){result.textContent=error.message;}finally{busy=false;for(const button of [save,test,clear])button.disabled=false;if(resultKey)render();else if(lastStatus)status.textContent=lastStatus.configured?t('workspace.key.configured',{source:t('workspace.key.source.'+lastStatus.source)}):t('workspace.key.unconfigured');}};
  trigger.addEventListener('click',()=>{dialog.showModal();input.value='';lastStatus=null;resultKey='';render();run(async()=>{const response=await fetch('/api/xai/settings/status',{cache:'no-store'});if(!response.ok)throw Error('SETTINGS_UNAVAILABLE');return response.json();},'');});
  save.addEventListener('click',()=>{const apiKey=input.value;input.value='';if(!apiKey){resultKey='workspace.key.empty';render();return;}run(()=>request('POST','key',{apiKey}),'workspace.key.saved');});
  test.addEventListener('click',()=>run(()=>request('POST','test',{}),'workspace.key.tested'));
  clear.addEventListener('click',()=>{input.value='';run(()=>request('DELETE','key'),'workspace.key.cleared');});
  close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{input.value='';trigger.focus();});
  onLanguageChange(render);
}

export function mountWorkspaceNavigation(active,steps=[]){
  if(!document.querySelector('link[href="/workspace.css"]')){const style=document.createElement('link');style.rel='stylesheet';style.href='/workspace.css';document.head.append(style);}
  const header=document.querySelector('header');
  const nav=document.createElement('nav');nav.className='workspace-nav';nav.setAttribute('aria-label','PatentLens');
  const brand=document.createElement('strong');brand.className='workspace-brand';brand.textContent='PatentLens';nav.append(brand);
  for(const [key,href] of links){const link=document.createElement('a');link.href=href;link.dataset.i18n='workspace.nav.'+key;if(key===active)link.setAttribute('aria-current','page');nav.append(link);}
  header?.prepend(nav);
  if(header)mountKeySettings(header);
  if(steps.length){const trail=document.createElement('nav');trail.className='workspace-steps';trail.dataset.i18nAria='workspace.progress';steps.forEach(([key,href,current],index)=>{const part=href?document.createElement('a'):document.createElement('span');part.dataset.i18n='workspace.step.'+key;if(href)part.href=href;if(current)part.setAttribute('aria-current','step');trail.append(part);if(index<steps.length-1)trail.append(document.createTextNode(' → '));});document.querySelector('main')?.prepend(trail);}
  initializeI18n();
  onLanguageChange(()=>{document.title=t('workspace.brand')+' · '+t('workspace.nav.'+active);});
  document.title=t('workspace.brand')+' · '+t('workspace.nav.'+active);
}
