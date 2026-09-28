/* XAU//DESK BBMA Alert Dashboard — MYT-first, alert-first. */
(function(){'use strict';
var TFS=['M5','M15','M30','H1','H4','D1','W1','MN1'],PATS=['ALL','RE-ENTRY','CSA','MHV','EXTREME','MOMENTUM'];var tf='H1',pat='ALL',selectedAlert=null;var V={vis:{},right:{},voff:{},span:{},hover:null,drag:null,pinch:null};
function e(v){return String(v==null?'—':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}function rt(){var d=window.BBMA_RUNTIME||window.BBMA_DASHBOARD;if(!d&&window.MARKET_DATA)d=window.MARKET_DATA.bbma||window.MARKET_DATA.bbmaDashboard;return d||{};}function b(v,c){return '<span class="bbx-badge '+(c||'')+'">'+e(v)+'</span>';}function state(a,d){var s=String(a&&a.state||d.alertState||'').toUpperCase();if(/TIME.?CONFLICT/.test(s))return'TIME_CONFLICT';if(/STALE/.test(s)||d.fresh===false||d.source==='NONE'||d.source==null)return'STALE';if(/BLOCK/.test(s)||a&&a.blocked)return'BLOCKED';if(/POST/.test(s))return'POST-EVENT';return'PRE-EVENT';}
function css(){if(document.getElementById('bbx-css'))return;var s=document.createElement('style');s.id='bbx-css';s.textContent='.bbx{--l:#1b4968;--g:#31df8b;--r:#ff596d;--a:#ffc638;--cy:#55c5ff;color:#edf7ff}.bbx-card{background:linear-gradient(145deg,#0d2032,#081722);border:1px solid var(--l);border-radius:16px;padding:12px;margin:9px 0}.bbx-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.bbx-title{font-weight:950;letter-spacing:.05em}.bbx-sub{font-size:10px;color:#8da9bd}.bbx-badge{display:inline-flex;border:1px solid #36576e;border-radius:99px;padding:4px 7px;font-size:9px;font-weight:900;margin:2px}.good{color:var(--g)}.warn{color:var(--a)}.bad{color:#ff8391}.info{color:var(--cy)}.bbma-alert-hero{border-width:2px}.bbma-alert-hero.blocked{border-color:var(--r)}.bbx-price{font-size:25px;font-weight:950}.bbx-tabs,.bbx-filters,.bbma-alert-strip{display:flex;gap:6px;overflow:auto;padding:6px 0}.bbx-btn,.bbx-alertchip{border:1px solid var(--l);background:#0c2134;color:#e1f2ff;border-radius:10px;padding:7px 10px;font-size:9px;font-weight:900;white-space:nowrap}.bbx-btn.on,.bbx-alertchip.on{background:#075f9c;border-color:#39b8ff}.bbma-chart{height:340px;background:#071522;border-radius:10px;overflow:hidden}.bbma-chart svg{width:100%;height:100%}.bbma-ctbar{position:absolute;left:6px;top:5px;z-index:4;display:flex;gap:4px}.bbma-ctbar button{border:1px solid #28506e;background:rgba(9,27,43,.88);color:#cfe9fb;border-radius:7px;font-size:9px;font-weight:900;padding:3px 7px;letter-spacing:.03em}.bbma-ctbar button:active{background:#075f9c}.bbma-cv{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab}.bbma-cv.grab{cursor:grabbing}.bbma-livechip{position:absolute;right:6px;top:5px;z-index:4;display:flex;gap:4px;align-items:center}.bbma-livechip .lc{border:1px solid #28506e;background:rgba(9,27,43,.88);color:#cfe9fb;border-radius:7px;font-size:8.5px;font-weight:900;padding:3px 6px;letter-spacing:.03em;white-space:nowrap}.bbma-livechip .lc.live{color:#7df0bd;border-color:#2c9e6a}.bbma-livechip .lc.degraded,.bbma-livechip .lc.reconnecting{color:#ffd479;border-color:#8a6d1f}.bbma-livechip .lc.backfill,.bbma-livechip .lc.connecting{color:#9fc4e0}.bbx-table{display:grid;grid-template-columns:42px repeat(9,minmax(60px,1fr));min-width:800px;font-size:9px}.bbx-cell{padding:6px 4px;border-right:1px solid #16354c;border-bottom:1px solid #16354c;text-align:center}.bbx-cell.h{color:#86c9f4;font-weight:900}.bbx-cell.tf{font-weight:950;cursor:pointer}.bbx-two{display:grid;grid-template-columns:1.2fr .8fr;gap:9px}.bbma-alert-evidence{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}.bbx-evidence{border:1px solid var(--l);border-radius:10px;padding:8px;font-size:10px}.bbma-alert-action{border-left:4px solid var(--cy)}.bbma-alert-history .row{border-top:1px solid #17364c;padding:8px 2px;font-size:10px}.bbx-prog{height:7px;background:#173047;border-radius:99px;overflow:hidden;margin:4px 0 8px}.bbx-prog i{display:block;height:100%;background:linear-gradient(90deg,#1d9cff,#ff586b)}.bbma-chart{position:relative}.bbma-axis{position:absolute;inset:0;pointer-events:none;font-size:8.5px;line-height:1.35}.bbma-axis .pl{position:absolute;right:3px;color:#86c9f4;background:rgba(7,21,34,.82);padding:0 3px;border-radius:3px;transform:translateY(-50%)}.bbma-axis .ll{position:absolute;right:3px;font-weight:900;background:rgba(13,64,46,.92);color:#7df0bd;padding:0 3px;border-radius:3px;border:1px solid #2c9e6a;transform:translateY(-50%)}.bbma-axis .se{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,198,56,.42);border-left:1px dashed rgba(255,198,56,.55)}.bbma-axis .se span{position:absolute;top:2px;left:3px;font-size:8px;font-weight:900;letter-spacing:.04em;color:#ffd479;white-space:nowrap;text-shadow:0 1px 2px #04101c}.bbx-empty{padding:16px;text-align:center;color:#8da9bd}.bbx-detail{font-size:10px;line-height:1.6}.bbx-alertgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.bbx-alert{border:1px solid var(--l);border-radius:9px;padding:8px;text-align:center;font-size:9px}@media(max-width:560px){.bbx-two{grid-template-columns:1fr}}';document.head.appendChild(s);}
function ui(){var m=document.querySelector('main.main'),nav=document.getElementById('bottomnav');if(!m||!nav)return;if(!document.getElementById('bbma-dashboard')){var s=document.createElement('section');s.id='bbma-dashboard';s.className='bbx';s.dataset.sec='bbma';s.innerHTML='<div class="bbx-card bbma-alert-hero" id="bbma-alert-hero"></div><div class="bbx-card"><div class="bbx-head"><div class="bbx-title">LIVE BBMA ALERTS</div><div class="bbx-sub">MYT (UTC+8)</div></div><div class="bbma-alert-strip" id="bbma-alert-strip"></div></div><div class="bbx-card"><div class="bbx-head"><div><div class="bbx-title">BBMA CHART</div><div class="bbx-sub">runtime OHLC · BB(20,2) · EMA50 · MYT</div></div><div id="bbma-chart-status"></div></div><div class="bbx-tabs" id="bbma-tfs"></div><div class="bbma-chart" id="bbma-chart"></div></div><div class="bbx-card" style="overflow:auto"><div class="bbx-title">MULTI-TIMEFRAME BBMA MATRIX</div><div class="bbx-table" id="bbma-matrix"></div></div><div class="bbx-two"><div class="bbx-card"><div class="bbx-title">BBMA × NEWS</div><div id="bbma-news"></div></div><div class="bbx-card"><div class="bbx-title">BB LEVEL PROXIMITY</div><div id="bbma-proximity"></div></div></div><div class="bbx-card"><div class="bbx-title">ALERT EVIDENCE</div><div class="bbma-alert-evidence" id="bbma-alert-evidence"></div></div><div class="bbx-card bbma-alert-action" id="bbma-alert-action"></div><div class="bbx-card"><div class="bbx-title">PATTERN FILTER</div><div class="bbx-filters" id="bbma-filter"></div></div><div class="bbx-card"><div class="bbx-title">QUICK ALERTS</div><div class="bbx-alertgrid" id="bbma-alerts"></div></div><div class="bbx-card bbma-alert-history"><div class="bbx-title">ALERT HISTORY</div><div id="bbma-alert-history"></div></div>';m.insertBefore(s,m.firstChild.nextSibling);}if(!nav.querySelector('[data-filter="bbma"]')){var q=document.createElement('button');q.dataset.filter='bbma';q.innerHTML='<span class="ic">▥</span>BBMA';var f=nav.querySelector('button');f?f.insertAdjacentElement('afterend',q):nav.appendChild(q);q.addEventListener('click',show);}}
function show(){if(window.XAUDeskRouter&&window.XAUDeskRouter.open){window.XAUDeskRouter.open('bbma');return;}document.querySelectorAll('[data-sec]').forEach(function(x){var m=String(x.dataset.sec||'').split(/\s+/).includes('bbma');x.classList.toggle('hidden',!m);x.style.display=m?'':'none';});render();scrollTo({top:0,behavior:'smooth'});}function allCandles(x,f){var d=rt(),sets=d.ohlc||d.candles||d.marketCandles||{};return(sets[f]||x.ohlc||x.candles||[]);}function candles(x,f){return allCandles(x,f).slice(-60);}function sessions(x,f){var a=candles(x,f);if(!a.length||a.length<2)return null;var t0=new Date(a[0].time).getTime(),t1=new Date(a[a.length-1].time).getTime();if(!(t1>t0))return null;
/* Session opens only annotate intraday views: once the visible window passes
 * 96h the per-day markers would crowd the left edge of D1/W1/MN1 charts, so
 * the chart relies on the MTF matrix for those horizons. */
if(t1-t0>96*3600000)return null;
var out=[];var D=86400000;
function inwin(ts){return ts>=t0-2*D&&ts<=t1+2*D;}
/* US DST (EDT): 02:00 local on the 2nd Sunday of March -> 1st Sunday of November */
function dst(us){var y=new Date(us).getUTCFullYear();function nthSunday(m,n){var first=Date.UTC(y,m,1);var off=(7-new Date(first).getUTCDay())%7;return first+off+(n-1)*7*D;}return us>=nthSunday(2,2)+2*3600000&&us<nthSunday(10,1)+2*3600000;}
var d0=Math.floor(t0/D)*D,d1=Math.floor(t1/D)*D;
for(var dd=d0;dd<=d1;dd+=D){
  var tok=dd+0*3600000; /* Tokyo open 09:00 JST = 00:00 UTC = 08:00 MYT */
  if(inwin(tok))out.push({ts:tok,label:'TOKYO 08:00'});
  /* US cash open 09:30 ET, DST-aware: 13:30 UTC (EDT) / 14:30 UTC (EST) */
  var usOpen=dd+(dst(dd)?13.5:14.5)*3600000;
  if(inwin(usOpen))out.push({ts:usOpen,label:'US '+(dst(usOpen)?'21:30':'22:30')});
}
out.sort(function(a,b){return a.ts-b.ts;});var ded=[];out.forEach(function(z){if(!ded.length||z.ts-ded[ded.length-1].ts>=30*60000)ded.push(z);});
/* Only draw markers that land INSIDE the visible candle window [t0,t1]; a
 * session open just before/after the range is not on the chart, so drop it
 * (otherwise x goes negative or >720 and the marker bleeds off-canvas). */
return ded.filter(function(z){return z.ts>=t0&&z.ts<=t1;}).slice(0,12).map(function(z){var X=12+(z.ts-t0)/(t1-t0)*(720-24);return{x:Math.round(X),label:z.label};});}
var TFMS={'M5':300000,'M15':900000,'M30':1800000,'H1':3600000,'H4':14400000,'D1':86400000,'W1':604800000,'MN1':2592000000};
function stepOf(f,a){var m=TFMS[f]||0;if(!m)return 0;var d0=new Date(a[0].time).getTime(),d1=new Date(a[1].time).getTime();var dd=d1-d0;return dd>0&&Math.abs(dd-m)<m*.25?dd:m;}
function anchorIndex(a,ts){var t0=new Date(a[0].time).getTime(),st=stepOf('H1',a)||60000;var i=Math.round((ts-t0)/st);return Math.max(0,Math.min(a.length-1,i));}
function sessionAnchors(a,f){
 if(!a.length||a.length<2)return[];
 var t0=new Date(a[0].time).getTime(),t1=new Date(a[a.length-1].time).getTime();
 if(!(t1>t0)||t1-t0>96*3600000)return[];
 var D=86400000,out=[];
 function nthSunday(y,m,n){var first=Date.UTC(y,m,1);var off=(7-new Date(first).getUTCDay())%7;return first+off+(n-1)*7*D;}
 function dst(us){var y=new Date(us).getUTCFullYear();return us>=nthSunday(y,2,2)+2*3600000&&us<nthSunday(y,10,1)+2*3600000;}
 var d0=Math.floor(t0/D)*D;
 for(var dd=d0;dd<=t1;dd+=D){
  var tok=dd+0*3600000;
  if(tok>=t0-2*D&&tok<=t1+2*D)out.push({ts:tok,label:'TOKYO 08:00',kind:'TOKYO',i:anchorIndex(a,tok)});
  var us=dd+(dst(dd)?13.5:14.5)*3600000;
  if(us>=t0-2*D&&us<=t1+2*D)out.push({ts:us,label:'US '+(dst(us)?'21:30':'22:30'),kind:'US',i:anchorIndex(a,us)});
 }
 out.sort(function(x,y){return x.ts-y.ts;});
 var ded=[];out.forEach(function(z){if(!ded.length||z.ts-ded[ded.length-1].ts>=30*60000)ded.push(z);});
 return ded.filter(function(z){return z.ts>=t0&&z.ts<=t1;});
}
function chartView(f){var all=allCandles({},f);var n=all.length||80;if(!V.vis[f])V.vis[f]=Math.min(80,n);if(V.vis[f]<8)V.vis[f]=8;if(V.vis[f]>n)V.vis[f]=n;if(!V.voff[f])V.voff[f]=0;if(V.right[f]==null)V.right[f]=n;V.right[f]=Math.max(V.vis[f],Math.min(n,V.right[f]));return V;}
function chartDraw(cv,f){
 var ctx=cv.getContext('2d');
 var W=cv.clientWidth||320,H=cv.clientHeight||340;
 if(!W||!H)return;
 var a=allCandles({},f);if(!a.length)return;
 var v=chartView(f),n=a.length;v.right[f]=Math.max(v.vis[f],Math.min(n,v.right[f]));
 var x0=Math.max(0,v.right[f]-v.vis[f]),x1=n-1;
 var p=8,padB=14,plotW=W-p*2;
 var slot=plotW/v.vis[f];
 function X(i){return p+(i-(v.right[f]-v.vis[f]))*slot;}
 var hi=-Infinity,lo=Infinity;
 for(var i=x0;i<=x1;i++){var c=a[i],h=+c.high,l=+c.low;if(h>hi)hi=h;if(l<lo)lo=l;}
 if(lo>hi){lo=hi=0;}
 var ppd=(hi-lo)*.06||Math.abs(hi)*.001||1;
 var domTop=hi+ppd,domBot=lo-ppd;
 var vspan=domTop-domBot;
 var vwin=vspan*(1-V.voff[f]*.5);
 var off=Math.max(0,Math.min(1,V.voff[f]))*(vspan-vwin);
 var top0=domTop-off;
 var bot0=top0-vwin;
 function Y(pr){return p+((top0-pr)/vwin)*(H-p-padB);}
 ctx.clearRect(0,0,W,H);
 ctx.fillStyle='#071522';ctx.fillRect(0,0,W,H);
 ctx.font='700 8px ui-monospace,monospace';ctx.textBaseline='middle';
 for(var g=0;g<5;g++){
  var pv=bot0+vwin*(g/4),yy=Y(pv);
  ctx.strokeStyle='rgba(85,197,255,.09)';ctx.beginPath();ctx.moveTo(p,yy);ctx.lineTo(W-p,yy);ctx.stroke();
  var lbl=pv.toFixed(2),tw=ctx.measureText(lbl).width;
  ctx.fillStyle='rgba(7,21,34,.85)';ctx.fillRect(W-p-tw-5,yy-5,tw+4,10);
  ctx.fillStyle='#86c9f4';ctx.textAlign='right';ctx.fillText(lbl,W-p-2,yy);
 }
 /* BB(20,2) detail zone: shaded area between upper and lower bands */
 var iu=[],il=[];
 for(var i2=x0;i2<=x1;i2++){var c2=a[i2];
  if(Number.isFinite(+c2.bbUpper)&&Number.isFinite(+c2.bbLower)){iu.push([X(i2),Y(+c2.bbUpper)]);il.push([X(i2),Y(+c2.bbLower)]);}}
 if(iu.length>1){ctx.beginPath();ctx.moveTo(iu[0][0],iu[0][1]);for(var q=1;q<iu.length;q++)ctx.lineTo(iu[q][0],iu[q][1]);for(var q2=il.length-1;q2>=0;q2--)ctx.lineTo(il[q2][0],il[q2][1]);ctx.closePath();ctx.fillStyle='rgba(40,169,255,.07)';ctx.fill();}
 function line(key,col,w2){ctx.strokeStyle=col;ctx.lineWidth=w2||1.2;ctx.beginPath();var st=false;
  for(var i3=x0;i3<=x1;i3++){var c3=a[i3];if(!Number.isFinite(+c3[key])){st=false;continue;}var xx=X(i3),yy2=Y(+c3[key]);if(!st){ctx.moveTo(xx,yy2);st=true;}else ctx.lineTo(xx,yy2);}ctx.stroke();}
 line('bbUpper','#28a9ff',1.2);line('bbMiddle','#ffc928',1.0);line('bbLower','#28a9ff',1.2);line('ema50','#c05cff',1.1);
 var bw=Math.max(1,Math.min(14,slot*.62));
 for(var i4=x0;i4<=x1;i4++){
  var c4=a[i4];if(![c4.open,c4.high,c4.low,c4.close].every(function(x){return Number.isFinite(+x);}))continue;
  var xx2=X(i4),col=+c4.close>=+c4.open?'#31df8b':'#ff596d';
  ctx.strokeStyle=col;ctx.lineWidth=Math.max(1,bw*.14);
  ctx.beginPath();ctx.moveTo(xx2,Y(+c4.high));ctx.lineTo(xx2,Y(+c4.low));ctx.stroke();
  var yA=Y(Math.max(+c4.open,+c4.close)),yB=Y(Math.min(+c4.open,+c4.close));
  ctx.fillStyle=col;ctx.fillRect(xx2-bw/2,yA,bw,Math.max(1,yB-yA));
 }
 /* Session open FIRST-candle markers (Tokyo / US) */
 var anchors=sessionAnchors(a,f);
 ctx.textAlign='left';
 for(var a2=0;a2<anchors.length;a2++){
  var an=anchors[a2],ax=X(an.i);
  if(ax<p-2||ax>W-p+2)continue;
  ctx.strokeStyle=an.kind==='TOKYO'?'rgba(125,240,189,.5)':'rgba(255,198,56,.5)';
  ctx.setLineDash([3,3]);ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(ax,p);ctx.lineTo(ax,H-padB);ctx.stroke();ctx.setLineDash([]);
  var fc=a[an.i];
  if(fc&&Number.isFinite(+fc.open)){ctx.fillStyle=an.kind==='TOKYO'?'#7df0bd':'#ffc638';ctx.beginPath();ctx.arc(ax,Y(+fc.open),2.5,0,7);ctx.fill();}
  ctx.fillStyle=an.kind==='TOKYO'?'#9ff5cf':'#ffd479';ctx.font='900 7.5px ui-monospace,monospace';
  ctx.fillText(an.label+' 1st',Math.min(W-p-58,Math.max(p,ax+3)),p+6);
 }
 /* Drag span: Tokyo open -> US open (first candle to first candle) */
 var sp=V.span[f];
 if(sp&&sp.a!=null&&sp.b!=null){
  var A=Math.min(sp.a,sp.b),B=Math.max(sp.a,sp.b);
  var sA=Math.max(A,x0),sB=Math.min(B,x1);
  if(sB>=sA){
   var xa=X(sA),xb=X(sB);
   ctx.fillStyle='rgba(85,197,255,.09)';ctx.fillRect(xa,p,xb-xa,H-p-padB);
   ctx.strokeStyle='rgba(85,197,255,.55)';ctx.strokeRect(xa,p,xb-xa,H-p-padB);
   var ct=a[A],cu=a[B];
   if(ct&&cu&&Number.isFinite(+ct.open)&&Number.isFinite(+cu.close)){
    var dP=+cu.close-+ct.open,pct=(dP/+ct.open)*100;
    var mins=B-A;
    ctx.fillStyle=dP>=0?'#7df0bd':'#ff8391';ctx.font='900 8px ui-monospace,monospace';
    ctx.textAlign='left';
    ctx.fillText('TOKYO\u2192US  '+(dP>=0?'+':'')+dP.toFixed(2)+' ('+(pct>=0?'+':'')+pct.toFixed(2)+'%)  '+(mins*stepOf(f,a)/60000).toFixed(0)+'min',Math.min(W-p-150,Math.max(p,xa+3)),H-padB-6);
   }
  }
 }
 var lastC=a[n-1];
 if(lastC&&Number.isFinite(+lastC.close)){
  var ly=Y(+lastC.close);
  ctx.strokeStyle='rgba(125,240,189,.55)';ctx.setLineDash([3,3]);
  ctx.beginPath();ctx.moveTo(p,ly);ctx.lineTo(W-p,ly);ctx.stroke();ctx.setLineDash([]);
  var tlb=('last '+(+lastC.close).toFixed(2));
  ctx.fillStyle='rgba(13,64,46,.95)';ctx.fillRect(W-p-52,ly-6,52,12);
  ctx.fillStyle='#7df0bd';ctx.font='900 8px ui-monospace,monospace';ctx.textAlign='right';
  ctx.fillText((''+(+lastC.close).toFixed(2)),W-p-3,ly);
 }
 if(V.hover!=null&&V.hover>=x0&&V.hover<=x1){
  var hc=a[V.hover],hx=X(V.hover);
  if(hc&&[hc.open,hc.high,hc.low,hc.close].every(function(x){return Number.isFinite(+x);})){
   ctx.strokeStyle='rgba(237,247,255,.35)';ctx.beginPath();ctx.moveTo(hx,p);ctx.lineTo(hx,H-padB);ctx.stroke();
   var myt=new Date(new Date(hc.time).getTime()+8*3600000).toISOString().slice(0,16).replace('T',' ');
   var msg=myt+' MYT  O '+(+hc.open).toFixed(2)+'  H '+(+hc.high).toFixed(2)+'  L '+(+hc.low).toFixed(2)+'  C '+(+hc.close).toFixed(2);
   ctx.font='700 8px ui-monospace,monospace';
   var mw=ctx.measureText(msg).width,mx=hx+8;if(mx+mw+8>W-p)mx=hx-mw-10;
   ctx.fillStyle='rgba(7,21,34,.93)';ctx.fillRect(mx,p+16,mw+8,13);
   ctx.strokeStyle='rgba(85,197,255,.4)';ctx.strokeRect(mx,p+16,mw+8,13);
   ctx.fillStyle='#cfe9fb';ctx.textAlign='left';ctx.fillText(msg,mx+4,p+23);
  }
 }
 ctx.fillStyle='#071522';ctx.fillRect(0,H-padB,W,padB);
 var tick=Math.max(1,Math.round(v.vis[f]/4));
 ctx.font='700 7.5px ui-monospace,monospace';ctx.textAlign='center';ctx.fillStyle='#6f93ab';
 var t0=new Date(a[0].time).getTime(),st2=stepOf(f,a);
 for(var ti=Math.ceil((v.right[f]-v.vis[f])/tick)*tick;ti<v.right[f];ti+=tick){
  if(ti<x0||ti>=n)continue;
  var dt=new Date(t0+ti*st2);
  var lbl2=(f==='M5'||f==='M15'||f==='M30')?('0'+dt.getUTCHours()).slice(-2)+':'+('0'+dt.getUTCMinutes()).slice(-2):('0'+dt.getUTCDate()).slice(-2)+' '+['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][dt.getUTCMonth()];
  ctx.fillText(lbl2,X(ti),H-4);
 }
}
function chartSync(f){
 var el=document.getElementById('bbma-chart');
 if(!el)return;
 var cv=el.querySelector('canvas.bbma-cv');
 if(!cv)return;
 var r=el.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
 if(!r.width||!r.height)return;
 var pw=Math.round(r.width*dpr),ph=Math.round(r.height*dpr);
 if(cv.width!==pw||cv.height!==ph){cv.width=pw;cv.height=ph;}
 chartDraw(cv,f);
}
function chartInteract(el,f){
 var cv=el.querySelector('canvas.bbma-cv');
 if(!cv||cv._wired===f)return;
 cv._wired=f;
 var pts={};
 function idxAt(px){var v=V,all=allCandles({},f);var plotW=(cv.clientWidth||320)-16,slot=plotW/v.vis[f];var i=Math.round(v.right[f]-v.vis[f]+(px-8)/slot);return Math.max(0,Math.min(all.length-1,i));}
 function anchorAt(px){var v=V,all=allCandles({},f);var anchors=sessionAnchors(all,f);var plotW=(cv.clientWidth||320)-16,slot=plotW/v.vis[f];for(var i=0;i<anchors.length;i++){var ax=8+(anchors[i].i-(v.right[f]-v.vis[f]))*slot;if(Math.abs(ax-px)<14)return anchors[i];}return null;}
 cv.addEventListener('pointerdown',function(ev){
  try{cv.setPointerCapture(ev.pointerId);}catch(e){}
  pts[ev.pointerId]={x:ev.offsetX,y:ev.offsetY};
  if(Object.keys(pts).length===2){var ids=Object.keys(pts);V.pinch={d0:Math.hypot(pts[ids[0]].x-pts[ids[1]].x,pts[ids[0]].y-pts[ids[1]].y)||1,vis0:V.vis[f]};return;}
  var _now=Date.now(),_lastTap=V._tap||0,_dx0=Math.abs((ev.offsetX||0)-(V._tapX||0));
  if(_now-_lastTap<300&&_dx0<24){var allD=allCandles({},f);V.right[f]=allD.length;V.voff[f]=0;V.span[f]=null;V._tap=0;chartSync(f);return;}
  V._tap=_now;V._tapX=ev.offsetX;
  var near=anchorAt(ev.offsetX);
  if(near){V.drag={mode:'span',anchor:near,x0:ev.offsetX};V.span[f]={a:near.i,b:near.i};}
  else V.drag={mode:'pan',x0:ev.offsetX,y0:ev.offsetY,right0:V.right[f],voff0:V.voff[f]};
  cv.classList.add('grab');
 });
 cv.addEventListener('pointermove',function(ev){
  if(pts[ev.pointerId])pts[ev.pointerId]={x:ev.offsetX,y:ev.offsetY};
  var v=V,all=allCandles({},f);
  if(V.pinch&&Object.keys(pts).length===2){var ids=Object.keys(pts);var d1=Math.hypot(pts[ids[0]].x-pts[ids[1]].x,pts[ids[0]].y-pts[ids[1]].y)||1;v.vis[f]=Math.max(8,Math.min(all.length,Math.round(V.pinch.vis0*V.pinch.d0/d1)));v.right[f]=Math.max(v.vis[f],Math.min(all.length,v.right[f]));chartSync(f);return;}
  if(V.drag&&V.drag.mode==='pinch')return;
  if(V.drag&&V.drag.mode==='pan'&&pts[ev.pointerId]&&V.drag.x0!=null){
   var had=V.drag;
   var plotW=(cv.clientWidth||320)-16,slot0=plotW/v.vis[f];
   var dx=ev.offsetX-had.x0,dy=ev.offsetY-(had.y0||0);
   v.right[f]=Math.max(v.vis[f],Math.min(all.length,Math.round(had.right0-dx/slot0)));
   var vspanPx=plotW-22;
   v.voff[f]=Math.max(0,Math.min(1,had.voff0+dy/vspanPx));
   V.span[f]=null;
   chartSync(f);return;
  }
  if(V.drag&&V.drag.mode==='span'&&pts[ev.pointerId]){
   if(V.span[f])V.span[f].b=idxAt(ev.offsetX);
   chartSync(f);return;
  }
  v.hover=idxAt(ev.offsetX);
  chartSync(f);
 });
 function endPtr(ev){
  if(pts[ev.pointerId])delete pts[ev.pointerId];
  if(Object.keys(pts).length<2)V.pinch=null;
  if(!Object.keys(pts).length){
   if(V.drag&&V.drag.mode==='span'&&(V.span[f].b===V.span[f].a)){V.span[f]=null;}
   V.drag=null;cv.classList.remove('grab');chartSync(f);
  }
 }
 cv.addEventListener('pointerup',endPtr);
 cv.addEventListener('pointercancel',endPtr);
 cv.addEventListener('pointerleave',function(){if(!V.drag){v2hover(f);}});
 function v2hover(f){V.hover=null;chartSync(f);}
 cv.addEventListener('wheel',function(ev){
  ev.preventDefault();
  var v2=V,all2=allCandles({},f);
  var plotW2=(cv.clientWidth||320)-16,frac=Math.max(0,Math.min(1,(ev.offsetX-8)/plotW2));
  var anchorIdx=(v2.right[f]-v2.vis[f])+frac*v2.vis[f];
  var nv=Math.max(8,Math.min(all2.length,Math.round(v2.vis[f]*(ev.deltaY>0?1.15:1/1.15))));
  v2.right[f]=Math.round(Math.max(nv,Math.min(all2.length,anchorIdx+(nv-v2.vis[f])*frac)));
  v2.vis[f]=nv;
  chartSync(f);
 },{passive:false});
 el.querySelectorAll('[data-ct]').forEach(function(btn){
  btn.addEventListener('click',function(){
   var act=btn.dataset.ct,v3=V,all3=allCandles({},f);
   if(act==='in'){var c3=v3.right[f]-v3.vis[f]/2;v3.vis[f]=Math.max(8,Math.round(v3.vis[f]/1.6));v3.right[f]=Math.round(Math.max(v3.vis[f],Math.min(all3.length,c3+v3.vis[f]/2)));}
   if(act==='out'){var c4=v3.right[f]-v3.vis[f]/2;v3.vis[f]=Math.min(all3.length,Math.round(v3.vis[f]*1.6));v3.right[f]=Math.round(Math.max(v3.vis[f],Math.min(all3.length,c4+v3.vis[f]/2)));}
   if(act==='tokus'){var anchors3=sessionAnchors(all3,f);var tk=anchors3.filter(function(z){return z.kind==='TOKYO';})[0];var us=anchors3.filter(function(z){return z.kind==='US';})[0];if(tk&&us){v3.span[f]={a:tk.i,b:us.i};v3.right[f]=Math.min(all3.length,us.i+6);v3.vis[f]=Math.min(all3.length,Math.max(8,us.i-tk.i+10));}}
   if(act==='clr'){v3.span[f]=null;v3.voff[f]=0;}
   if(act==='live'){v3.right[f]=all3.length;v3.voff[f]=0;}
   chartSync(f);
  });
 });
 if(el._ro)el._ro.disconnect();
 if(typeof ResizeObserver!=='undefined'){el._ro=new ResizeObserver(function(){chartSync(f);});el._ro.observe(el);}
 chartSync(f);
}
function updateLiveChip(f){var el=document.getElementById('bbma-chart');if(!el)return;var chip=el.querySelector('.bbma-livechip');if(!chip)return;var d=rt(),fd=d.feed;if(!fd){chip.innerHTML='';return;}var cls=fd.state==='LIVE'?'live':(fd.state==='DEGRADED'||fd.state==='RECONNECTING')?'degraded':(fd.state==='BACKFILL')?'backfill':'connecting';var lat=fd.latencyMs!=null?(fd.latencyMs>=1000?Math.round(fd.latencyMs/1000)+'s':fd.latencyMs+'ms'):'\u2014';var prov=fd.provider&&fd.provider!=='\u2014'?fd.provider:'\u2014';chip.innerHTML='<span class="lc '+cls+'">'+fd.state+' \u00b7 '+prov+' \u00b7 '+lat+'</span>';}
function chart(x,f){
 var all=allCandles(x,f);
 if(!all.length)return'<div class="bbx-empty">BBMA_CHART_NO_DATA · '+e(f)+' waiting for validated OHLC</div><div class="bbma-axis"><span class="ll">—</span></div>';
 V.span[f]=V.span[f]||null;
 V.hover=null;
 var html='<div class="bbma-ctbar">'
  +'<button data-ct="in" title="Zoom in">+</button>'
  +'<button data-ct="out" title="Zoom out">&#8722;</button>'
  +'<button data-ct="tokus" title="Tokyo open \u2192 US open span">T\u2192U</button>'
  +'<button data-ct="clr" title="Reset view / clear span">CLR</button>'
  +'<button data-ct="live" title="Jump to latest candle">Live</button>'
  +'</div><canvas class="bbma-cv"></canvas><div class="bbma-axis"><span class="ll">&nbsp;</span></div>';
 var el=document.getElementById('bbma-chart');
 el.innerHTML=html;
 chartInteract(el,f);
 updateLiveChip(f);
 return null;
}
function nextEvent(){try{var n=window.NEWS_AUTO;if(!n||!Array.isArray(n.incoming))return null;var rel=n.incoming.filter(function(e){return e&&e.release&&e.release.state!=='RELEASED'&&/^(USD|XAU|ALL|GLOBAL|EUR|GBP|JPY|AUD|CHF|CAD)$/i.test(String(e.currency||''));});var pool=rel.length?rel:n.incoming.filter(function(e){return e&&e.release&&e.release.state!=='RELEASED';});if(!pool.length)return null;pool=pool.slice().sort(function(a,b){return String(a.date+' '+(a.timeGmt||'')).localeCompare(String(b.date+' '+(b.timeGmt||'')));});return pool[0];}catch(e){return null;}}
function render(){var d=rt(),mtf=d.mtf||d.timeframes||{},x=mtf[tf]||{},extAlerts=d.alerts||[],techAlerts=d.techAlerts||[],alerts=extAlerts.concat(techAlerts),a=alerts.find(function(q,i){return String(q.id==null?i:q.id)===String(selectedAlert);})||alerts[0]||{},st=state(a,d),techOnly=extAlerts.length===0,blocked=techOnly?false:/STALE|TIME_CONFLICT|BLOCKED/.test(st),hero=document.getElementById('bbma-alert-hero');if(!hero)return;var hasLive=String(d.source)!=='NONE'&&d.fresh===true;hero.className='bbx-card bbma-alert-hero '+(blocked?'blocked':'');hero.innerHTML=hasLive?'<div class="bbx-head"><div><div class="bbx-sub">XAU/USD · BBMA ALERT COMMAND</div><div class="bbx-price">'+e(d.price||d.last)+'</div></div>'+b(st,blocked?'bad':st==='POST-EVENT'?'good':'warn')+'</div><div>'+b(tf,'info')+b(a.impact||'BBMA','warn')+b(d.updatedMYT||a.timeMYT||'MYT pending','info')+'</div><div class="bbx-detail">'+(blocked?'<b>ALERT BLOCKED:</b> evidence is not current. ':'')+'Trend '+e(x.trend)+' · Momentum '+e(x.momentum)+' · Re-entry '+e(x.reentry)+' · CSA '+e(x.csa||x.csak)+' · MHV '+e(x.mhv)+' · Extreme '+e(x.extreme)+'</div>':'<div class="bbx-head"><div><div class="bbx-sub">XAU/USD · BBMA ALERT COMMAND</div><div class="bbx-price">AWAITING LIVE TICKS</div></div>'+b('NO_LIVE_TICKS','bad')+'</div><div class="bbx-detail">No real XAU ticks received in this session yet. Real historical candles (Twelve Data) load below for chart + matrix; the live price and fresh evidence wait for the first tick (5s poll + Twelve Data WS). No synthetic candles and no placeholder alerts are ever shown. '+b('source: '+(d.source==null?'NONE':e(d.source)),'info')+'</div>';
var strip=document.getElementById('bbma-alert-strip');strip.innerHTML=alerts.length?alerts.slice(0,12).map(function(q,i){var id=q.id==null?i:q.id;return'<button class="bbx-alertchip '+((selectedAlert!=null?String(id)===String(selectedAlert):i===0)?'on':'')+'" data-alert-id="'+e(id)+'">'+e(q.symbol||'XAU/USD')+' · '+e(q.timeframe||q.tf||'MTF')+' · '+e(q.pattern||q.type||q.level||'ALERT')+'</button>';}).join(''):'<div class="bbx-empty">No current BBMA alert. Dashboard remains live for technical monitoring.</div>';strip.querySelectorAll('[data-alert-id]').forEach(function(q){q.addEventListener('click',function(){selectedAlert=q.dataset.alertId;var aa=alerts.find(function(z,i){return String(z.id==null?i:z.id)===String(selectedAlert);});if(aa&&TFS.includes(aa.timeframe||aa.tf))tf=aa.timeframe||aa.tf;render();});});var tabs=document.getElementById('bbma-tfs');tabs.innerHTML=TFS.map(function(t){return'<button class="bbx-btn '+(t===tf?'on':'')+'" data-tf="'+t+'">'+t+'</button>';}).join('');tabs.querySelectorAll('[data-tf]').forEach(function(q){q.addEventListener('click',function(){tf=q.dataset.tf;render();});});chart(x,tf);document.getElementById('bbma-chart-status').innerHTML=b(tf,'info')+b(x.zone||x.location||'BB —','warn');
var heads=['TF','TREND','MOMENTUM','RE-ENTRY','CSA','MHV','EXTREME','BB ZONE','LOC/EVT','EMA50'],rows=heads.map(function(v){return'<div class="bbx-cell h">'+v+'</div>';}).join('');TFS.slice().reverse().forEach(function(t){var z=mtf[t]||{};rows+='<div class="bbx-cell tf" data-tf="'+t+'">'+t+'</div>'+[z.trend,z.momentum,z.reentry,z.csa||z.csak,z.mhv,z.extreme,z.zone||'—',z.location||'—',z.ema50Position||z.emaGap].map(function(v){return'<div class="bbx-cell">'+e(v)+'</div>';}).join('');});var mx=document.getElementById('bbma-matrix');mx.innerHTML=rows;mx.querySelectorAll('[data-tf]').forEach(function(q){q.addEventListener('click',function(){tf=q.dataset.tf;render();});});var ev=d.event||d.newsImpact||nextEvent();document.getElementById('bbma-news').innerHTML=ev?'<h3>'+e(ev.name||ev.event)+'</h3><div class="bbx-sub">'+e(ev.mytDisplay||ev.timeMYT||(ev.timeMyt?String(ev.timeMyt).replace(/^[A-Za-z], /,'')+' MYT (UTC+8)':'—'))+'</div><div class="bbx-detail">Previous <b>'+e(ev.previous||'—')+'</b> · Forecast <b>'+e(ev.forecast||'—')+'</b> · Actual <b>'+e(ev.actual==null?'pending':ev.actual)+'</b>'+(ev.importance?' · <span class="bbx-badge warn">'+e(ev.importance)+'</span>':'')+'<br>'+e(d.newsSummary||ev.play||ev.note||'Await price confirmation after release. (Context only — trade direction comes from the BBMA engine.)')+'</div>':'<div class="bbx-empty">No current news event. BBMA technical monitoring continues independently.</div>';var pv=x.proximity||{};function bar(n,v){var q=Math.max(0,Math.min(100,+v||0));return'<div class="bbx-sub">'+n+' '+q.toFixed(0)+'%</div><div class="bbx-prog"><i style="width:'+q+'%"></i></div>';}document.getElementById('bbma-proximity').innerHTML=bar('Upper BB',pv.upper||x.upperProximity)+bar('Middle BB',pv.middle||x.midProximity)+bar('Lower BB',pv.lower||x.lowerProximity)+bar('EMA50',pv.ema50||x.ema50Proximity);
var evidence=[['TIMEFRAME',tf],['TREND',x.trend],['MOMENTUM',x.momentum],['RE-ENTRY',x.reentry],['CSA',x.csa||x.csak],['MHV',x.mhv],['EXTREME',x.extreme],['BB ZONE',x.zone||'—'],['LOC / EVT',x.location||'—'],['EMA50',x.ema50Position||x.emaGap],['FRESHNESS',d.freshness||st],['MYT',d.updatedMYT||a.timeMYT]];document.getElementById('bbma-alert-evidence').innerHTML=evidence.map(function(z){return'<div class="bbx-evidence"><span class="bbx-sub">'+z[0]+'</span><br><b>'+e(z[1])+'</b></div>';}).join('');document.getElementById('bbma-alert-action').innerHTML='<div class="bbx-title">ALERT OBSERVATION</div><div class="bbx-detail">'+(blocked?'Do not treat this alert as current until '+st+' is cleared.':(techOnly&&a?'<span class="bbx-badge info">TECHNICAL</span> '+e(a.summary||'Live technical signal from real MTF readings — monitoring only, not a validated alert. Telegram posting still requires an external validated alert (publishability contract).'):(extAlerts.length&&a?e(a.summary||a.message||d.alertSummary||'Validated external alert — see evidence above. Monitor and require BBMA/news confirmation.'):'No current BBMA alert. Dashboard remains live for technical monitoring; real signals appear here as the MTF matrix updates.')))+'</div>';var fl=document.getElementById('bbma-filter');fl.innerHTML=PATS.map(function(p){return'<button class="bbx-btn '+(p===pat?'on':'')+'" data-pattern="'+p+'">'+p+'</button>';}).join('');fl.querySelectorAll('[data-pattern]').forEach(function(q){q.addEventListener('click',function(){pat=q.dataset.pattern;render();});});var counts={HIGH:0,MEDIUM:0,LOW:0};alerts.forEach(function(q){var k=String(q.level||q.impact||'').toUpperCase();if(counts[k]!=null)counts[k]++;});document.getElementById('bbma-alerts').innerHTML='<div class="bbx-alert">🔔<br>ALL<br><b>'+alerts.length+'</b></div><div class="bbx-alert">🔥<br>HIGH<br><b>'+counts.HIGH+'</b></div><div class="bbx-alert">⚠<br>MED<br><b>'+counts.MEDIUM+'</b></div><div class="bbx-alert">ⓘ<br>LOW<br><b>'+counts.LOW+'</b></div>';var hist=d.alertHistory||alerts;document.getElementById('bbma-alert-history').innerHTML=hist.length?hist.slice(0,20).map(function(q,i){return'<div class="row" data-alert-id="'+e(q.id==null?i:q.id)+'"><b>'+e(q.timeMYT||q.myt||'MYT —')+'</b> · '+e(q.symbol||'XAU/USD')+' · '+e(q.timeframe||q.tf||'MTF')+' · '+e(q.pattern||q.type||q.level||'BBMA')+'</div>';}).join(''):'<div class="bbx-empty">No BBMA alert history yet.</div>';
/* Real TELEGRAM delivery history: NEWS_AUTO.alertHistory is built from the
 * committed .news-alert-state.json (only confirmed deliveries are recorded).
 * Entries without a timestamp are legacy keys — shown honestly as 'recorded',
 * never back-dated. */
var nh=(window.NEWS_AUTO&&Array.isArray(window.NEWS_AUTO.alertHistory))?window.NEWS_AUTO.alertHistory:[];
document.getElementById('bbma-alert-history').innerHTML+=nh.length?'<div class="bbx-sub" style="margin-top:8px">TELEGRAM DELIVERY HISTORY (last '+nh.length+')</div>'+nh.slice(0,30).map(function(q){return '<div class="row"><span class="bbx-badge '+(q.type==='EVENT'||q.type==='BBMA_BOX'?'warn':'info')+'">'+e(q.type)+'</span> <b>'+e(q.timeMYT)+'</b> · '+e(q.title)+'</div>';}).join(''):'<div class="bbx-sub" style="margin-top:8px">Telegram delivery history: not yet recorded (starts with the next scheduled run).</div>';}
function init(){css();ui();render();setInterval(render,30000);document.addEventListener('bbma-runtime-updated',render);document.addEventListener('bbma-alert-open',function(ev){var z=ev.detail||{};if(z.alertId!=null)selectedAlert=z.alertId;if(z.timeframe&&TFS.includes(z.timeframe))tf=z.timeframe;show();});}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();window.BBMADashboardUI={show:show,render:render,openAlert:function(id,frame){selectedAlert=id;if(frame&&TFS.includes(frame))tf=frame;show();}};
/* Test seams (read-only views of interactive chart state) — used by
 * test/bbma-chart-interactive.test.js to prove zoom/pan/span actually work. */
try{window.__V=V;window.__anchors=function(a){return sessionAnchors(a,tf);};}catch(e){}
})();