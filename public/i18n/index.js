import zh from './zh-CN.js';
import en from './en.js';
import zhStatic from './zh-static.js';
import enStatic from './en-static.js';
import pilotZh from './pilot.js';
import v3Zh from './v3.js';
import searchZh from './search.js';
import review from './review.js';
import features from './features.js';
import compare from './compare.js';
import repository from './repository.js';
import workspace from './workspace.js';
import guided from './guided.js';
import registry from './registry.js';

const storageKey = 'patentlens.locale';
const catalogs = {'zh-CN':{...zh,...zhStatic,...pilotZh.zh,...v3Zh.zh,...searchZh.zh,...review.zh,...features.zh,...compare.zh,...repository.zh,...workspace.zh,...guided.zh,...registry.zh}, en:{...en,...enStatic,...pilotZh.en,...v3Zh.en,...searchZh.en,...review.en,...features.en,...compare.en,...repository.en,...workspace.en,...guided.en,...registry.en}};
let language = 'zh-CN';
try { if (localStorage.getItem(storageKey) === 'en') language = 'en'; } catch {}
const listeners = new Set();
const warned = new Set();
const staticNodes = [];

export function getLanguage(){ return language; }
export function t(key, params={}){
  const local = catalogs[language][key];
  const value = local ?? catalogs.en[key];
  if (local === undefined && !warned.has(`${language}:${key}`) && ['localhost','127.0.0.1'].includes(location.hostname)) {
    console.warn(`[PatentLens i18n] Missing ${language} translation: ${key}`);
    warned.add(`${language}:${key}`);
  }
  if (value === undefined) return key;
  return value.replace(/\{([a-zA-Z][\w]*)\}/g, (match,name)=>Object.hasOwn(params,name)?String(params[name]):match);
}
export function setLanguage(next){
  if (!catalogs[next] || next === language) return;
  language = next;
  try { localStorage.setItem(storageKey,next); } catch {}
  document.documentElement.lang = next;
  applyStatic();
  for (const listener of listeners) listener(next);
  updateSwitcher();
}
export function onLanguageChange(listener){ listeners.add(listener); return ()=>listeners.delete(listener); }
export function term(kind,value){ const key=`${kind}.${value}`; return (catalogs[language][key] ?? en[key]) || value; }
export function applyStatic(){
  for(const {element,key,attr} of staticNodes){
    if(!element.isConnected)continue;
    const value=t(key);
    if(attr)element.setAttribute(attr,value);
    else element.textContent=value;
  }
  document.documentElement.lang=language;
}
export function bindStatic(root=document){
  staticNodes.length=0;
  for(const element of root.querySelectorAll('[data-i18n]'))staticNodes.push({element,key:element.dataset.i18n});
  for(const element of root.querySelectorAll('[data-i18n-placeholder]'))staticNodes.push({element,key:element.dataset.i18nPlaceholder,attr:'placeholder'});
  for(const element of root.querySelectorAll('[data-i18n-aria]'))staticNodes.push({element,key:element.dataset.i18nAria,attr:'aria-label'});
  for(const element of root.querySelectorAll('[data-i18n-title]'))staticNodes.push({element,key:element.dataset.i18nTitle,attr:'title'});
  applyStatic();
}
let switcher;
function updateSwitcher(){
  if(!switcher)return;
  for(const button of switcher.querySelectorAll('button')){
    const current=button.dataset.lang===language;
    button.setAttribute('aria-pressed',String(current));
    button.classList.toggle('active',current);
  }
}
export function mountLanguageSwitcher(){
  if(switcher)return switcher;
  switcher=document.createElement('div');switcher.className='language-switcher';switcher.setAttribute('role','group');switcher.setAttribute('aria-label','Language / 语言');
  for(const [lang,label] of [['zh-CN','中文'],['en','EN']]){
    const button=document.createElement('button');button.type='button';button.dataset.lang=lang;button.textContent=label;
    button.addEventListener('click',()=>setLanguage(lang));switcher.append(button);
  }
  const header=document.querySelector('header');header?.append(switcher);
  updateSwitcher();return switcher;
}
export function initializeI18n(){ bindStatic(); mountLanguageSwitcher(); }
