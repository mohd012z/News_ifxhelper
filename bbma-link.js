/* XAU//DESK BBMA alert links: app deep link + HTTPS query router. */
(function(){'use strict';
var TFS=['M5','M15','M30','H1','H4','D1','W1','MN1'];
function clean(v){return String(v==null?'':v).replace(/[^A-Za-z0-9_.:-]/g,'');}
function frame(v){v=String(v||'H1').toUpperCase();return TFS.indexOf(v)>=0?v:'H1';}
function params(input){var p=input instanceof URLSearchParams?input:new URLSearchParams(input||'');return {alertId:clean(p.get('alertId')),tf:frame(p.get('tf')),symbol:clean(p.get('symbol')||'XAUUSD'),myt:String(p.get('myt')||'')};}
function appLink(o){o=o||{};var p=new URLSearchParams();if(o.alertId)p.set('alertId',clean(o.alertId));p.set('tf',frame(o.tf));if(o.symbol)p.set('symbol',clean(o.symbol));if(o.myt)p.set('myt',String(o.myt));return 'xau-desk://bbma?'+p.toString();}
function webLink(o,base){o=o||{};var u=new URL(base||location.href);u.hash='';u.search='';u.searchParams.set('open','bbma');if(o.alertId)u.searchParams.set('alertId',clean(o.alertId));u.searchParams.set('tf',frame(o.tf));if(o.symbol)u.searchParams.set('symbol',clean(o.symbol));if(o.myt)u.searchParams.set('myt',String(o.myt));return u.toString();}
function openFromLocation(){var p=new URLSearchParams(location.search);if(String(p.get('open')).toLowerCase()!=='bbma')return false;var o=params(p);function go(){document.dispatchEvent(new CustomEvent('bbma-alert-open',{detail:{alertId:o.alertId,timeframe:o.tf,symbol:o.symbol,myt:o.myt}}));if(window.BBMADashboardUI)window.BBMADashboardUI.openAlert(o.alertId,o.tf);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(go,50);},{once:true});else setTimeout(go,50);return true;}
window.BBMALink={appLink:appLink,webLink:webLink,openFromLocation:openFromLocation};openFromLocation();
})();
