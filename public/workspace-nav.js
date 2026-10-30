import {t,initializeI18n,onLanguageChange} from './i18n/index.js';

const links=[['home','/workspace'],['extract','/patent-features'],['search','/patent-repository?task=search'],['compare','/patent-repository?task=compare'],['collections','/patent-repository?task=collections']];
const advanced=[['legacySearch','/patent-search'],['legacyPilot','/pilot-thermal'],['classification','/pilot-v3'],['value','/pilot'],['review','/review-thermal'],['batchTools','/patent-repository?task=advanced']];

export function mountWorkspaceNavigation(active,steps=[]){
  if(!document.querySelector('link[href="/workspace.css"]')){const style=document.createElement('link');style.rel='stylesheet';style.href='/workspace.css';document.head.append(style);}
  const header=document.querySelector('header');
  const nav=document.createElement('nav');nav.className='workspace-nav';nav.setAttribute('aria-label','PatentLens');
  for(const [key,href] of links){const link=document.createElement('a');link.href=href;link.dataset.i18n='workspace.nav.'+key;if(key===active)link.setAttribute('aria-current','page');nav.append(link);}
  const more=document.createElement('details');more.className='workspace-more';const summary=document.createElement('summary');summary.dataset.i18n='workspace.nav.advanced';more.append(summary);
  const menu=document.createElement('div');menu.className='workspace-menu';for(const [key,href] of advanced){const link=document.createElement('a');link.href=href;link.dataset.i18n='workspace.'+key;menu.append(link);}more.append(menu);nav.append(more);header?.prepend(nav);
  if(steps.length){const trail=document.createElement('nav');trail.className='workspace-steps';trail.dataset.i18nAria='workspace.progress';steps.forEach(([key,href,current],index)=>{const part=href?document.createElement('a'):document.createElement('span');part.dataset.i18n='workspace.step.'+key;if(href)part.href=href;if(current)part.setAttribute('aria-current','step');trail.append(part);if(index<steps.length-1)trail.append(document.createTextNode(' → '));});document.querySelector('main')?.prepend(trail);}
  initializeI18n();
  onLanguageChange(()=>{document.title=t('workspace.brand')+' · '+t('workspace.nav.'+active);});
  document.title=t('workspace.brand')+' · '+t('workspace.nav.'+active);
}
