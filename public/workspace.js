import {mountWorkspaceNavigation} from './workspace-nav.js';
import {t,onLanguageChange} from './i18n/index.js';
import {loadRegistryContext} from './registry-context.js';
import {trustBadge} from './trust-status.js';
// Preserve bookmarks to the original search workbench after / becomes the task home.
if(location.pathname==='/'&&location.hash&&location.hash!=='#main')location.replace('/patent-search'+location.hash);
mountWorkspaceNavigation('home');
const registryId=new URLSearchParams(location.search).get('registry');
if(registryId){const panel=document.createElement('section');panel.className='advanced';panel.id='registry-context';document.querySelector('.hero').after(panel);let context;
  const render=()=>{panel.replaceChildren();if(!context)return;const {record,source,linked}=context;const heading=document.createElement('h2');heading.textContent=record.publicationNumber+' · '+(record.title??'—');panel.append(heading,trustBadge(t,'registered'),document.createTextNode(' '),trustBadge(t,record.metadataCorrections?.length?'corrected':'unchanged'));for(const line of [t('registry.current'),t('registry.corrections',{count:record.metadataCorrections?.length??0}),linked?t('registry.linked',{hash:source.documentHash}):t('registry.unlinked')]){const p=document.createElement('p');p.textContent=line;panel.append(p);}if(record.sourceUrl){const a=document.createElement('a');a.href=record.sourceUrl;a.textContent=t('registry.source');a.target='_blank';a.rel='noopener noreferrer';panel.append(a);}for(const [label,href] of [[t('registry.return'),'/pilot?record='+encodeURIComponent(record.id)],[t('registry.search'),'/patent-repository?task=search&registry='+encodeURIComponent(record.id)]]){const a=document.createElement('a');a.href=href;a.textContent=label;a.className='start';panel.append(a);}};
  onLanguageChange(render);
  try{const csrf=(await(await fetch('/api/xai/settings/csrf')).json()).csrfToken;context=await loadRegistryContext(registryId,csrf);render();}catch(error){panel.textContent=t('registry.missing')+' '+error.message;}
}
