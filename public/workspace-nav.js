import {t,initializeI18n,onLanguageChange} from './i18n/index.js';

const links=[['home','/workspace'],['library','/patent-library'],['search','/patent-repository?task=search'],['extract','/patent-features'],['compare','/patent-repository?task=compare'],['collections','/patent-repository?task=collections']];

export function mountWorkspaceNavigation(active,steps=[]){
  if(!document.querySelector('link[href="/workspace.css"]')){const style=document.createElement('link');style.rel='stylesheet';style.href='/workspace.css';document.head.append(style);}
  const header=document.querySelector('header');
  const nav=document.createElement('nav');nav.className='workspace-nav';nav.setAttribute('aria-label','PatentLens');
  const brand=document.createElement('strong');brand.className='workspace-brand';brand.textContent='PatentLens';nav.append(brand);
  for(const [key,href] of links){const link=document.createElement('a');link.href=href;link.dataset.i18n='workspace.nav.'+key;if(key===active)link.setAttribute('aria-current','page');nav.append(link);}
  header?.prepend(nav);
  if(steps.length){const trail=document.createElement('nav');trail.className='workspace-steps';trail.dataset.i18nAria='workspace.progress';steps.forEach(([key,href,current],index)=>{const part=href?document.createElement('a'):document.createElement('span');part.dataset.i18n='workspace.step.'+key;if(href)part.href=href;if(current)part.setAttribute('aria-current','step');trail.append(part);if(index<steps.length-1)trail.append(document.createTextNode(' → '));});document.querySelector('main')?.prepend(trail);}
  initializeI18n();
  onLanguageChange(()=>{document.title=t('workspace.brand')+' · '+t('workspace.nav.'+active);});
  document.title=t('workspace.brand')+' · '+t('workspace.nav.'+active);
}
