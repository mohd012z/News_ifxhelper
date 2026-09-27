/* APK BBMA navigation compatibility layer.
 * Keeps the legacy dashboard renderer focused on rendering while this layer owns
 * the BBMA/News visibility boundary until navigation is consolidated in app.js.
 */
(function(){'use strict';
function sections(){return Array.prototype.slice.call(document.querySelectorAll('[data-sec]'));}
function nav(){return document.getElementById('bottomnav');}
function activate(name){
  sections().forEach(function(s){
    var names=String(s.dataset.sec||'').split(/\s+/);
    var matches=names.indexOf(name)>=0 || (name!=='bbma' && names.indexOf('all')>=0);
    s.classList.toggle('hidden', !matches);
    s.style.display=matches?'':'none';
  });
  var n=nav();
  if(n)Array.prototype.forEach.call(n.querySelectorAll('button'),function(b){
    b.classList.toggle('active',b.dataset.filter===name);
  });
  if(name==='bbma'&&window.BBMADashboardUI&&window.BBMADashboardUI.render)window.BBMADashboardUI.render();
  try{window.dispatchEvent(new CustomEvent('xau-route-changed',{detail:{route:name}}));}catch(e){}
}
function bind(){
  var n=nav();if(!n)return;
  n.addEventListener('click',function(ev){
    var b=ev.target&&ev.target.closest&&ev.target.closest('button[data-filter]');
    if(!b)return;
    var route=b.dataset.filter;
    if(route==='bbma'){
      ev.preventDefault();
      ev.stopImmediatePropagation();
      activate('bbma');
      window.scrollTo({top:0,behavior:'smooth'});
      return;
    }
    /* Leaving BBMA: make sure it cannot remain visible behind another page. */
    var bb=document.getElementById('bbma-dashboard');
    if(bb){
      bb.classList.add('hidden');
      bb.style.display='none';
    }
  },true);
  document.addEventListener('bbma-nav-request',function(){activate('bbma');});
  document.addEventListener('bbma-alert-open',function(){activate('bbma');});
}
window.XAUDeskRouter={open:activate};
function checkUrl(){
  try{
    if(window.location.hash==='#bbma'||new URLSearchParams(window.location.search).get('open')==='bbma'){
      activate('bbma');
    }
  }catch(e){}
}
window.addEventListener('hashchange',checkUrl);
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',function(){bind();setTimeout(checkUrl,100);},{once:true});
}else{
  bind();
  setTimeout(checkUrl,100);
}
})();
