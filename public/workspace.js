import {mountWorkspaceNavigation} from './workspace-nav.js';
// Preserve bookmarks to the original search workbench after / becomes the task home.
if(location.pathname==='/'&&location.hash&&location.hash!=='#main')location.replace('/patent-search'+location.hash);
mountWorkspaceNavigation('home');
