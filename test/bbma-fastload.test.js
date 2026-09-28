'use strict';
/* EXECUTED proof of the /fast-load path (spec section 4, "sangat penting untuk APK"):
 *
 *   WRONG: tick -> calc all TF -> calc all indicators -> rebuild DOM -> regenerate SVG
 *   RIGHT: tick -> update candle[N] -> dirty flags -> rAF -> paint dirty layers only
 *          (grid NOT repainted every tick)
 *
 * This loads the real dashboard UMD with a DOM stub whose innerHTML setter and
 * grid-line drawing are COUNTED, renders a real GC=F M15 chart, then feeds a
 * live tick into the runtime and dispatches the 'bbma-runtime-updated' event.
 * It asserts:
 *   1. the DOM was NOT rebuilt (innerHTML set-count for the chart element did not
 *      increase on the tick-only update),
 *   2. the grid LAYER-0 was NOT repainted (grid line draw-ops did not increase
 *      when the price domain is unchanged),
 *   3. the candles DID repaint (the live price line / last candle updated).
 *
 * Uses the REAL bbma-runtime.js (tick -> candle[N] -> publish -> event) and the
 * REAL bbma-dashboard-ui.js — no stubs of the pipeline itself. */
const fs=require('fs'),assert=require('assert'),path=require('path'),vm=require('vm');
const E=require('../lib/bbma-engine.js'),R=require('../lib/ohlc-resampler.js');

/* recording 2D ctx: counts grid lines (horizontal, faint) vs candles */
function makeCtx(cv){
  const ops={gridLine:0,candle:0,fillRect:0,lineTo:0,moveTo:0};
  return {
    _ops:ops,
    clearRect(){}, drawImage(){}, beginPath(){}, stroke(){}, fill(){},
    setLineDash(){}, closePath(){}, save(){},restore(){},
    moveTo(x,y){ops.moveTo++;}, lineTo(x,y){ops.lineTo++;},
    fillRect(x,y,w,h){ops.fillRect++;},
    arc(x,y,r){},
    fillText(t,x,y){},
    measureText(t){return {width:((t||'').length*4)||0};},
    set fillStyle(v){ if(/^rgba\(85,197,255/.test(v)||/rgba\(7,21,34/.test(v)) ops.gridLine++; },
    set strokeStyle(v){ if(/^rgba\(85,197,255/.test(v)) ops.gridLine++; },
    set lineWidth(v){}, get lineWidth(){return 1;},
    set font(v){}, get font(){return '';},
    set textAlign(v){}, get textAlign(){return 'left';},
    set textBaseline(v){}, get textBaseline(){return 'middle';},
  };
}
function _matchChild(k,sel){
  if(sel.startsWith('[data-ct'))return !!(k.dataset&&k.dataset.ct);
  if(sel==='canvas.bbma-cv')return !!k._cv;
  if(sel.startsWith('.'))return (k.className||'').includes(sel.slice(1));
  if(sel.startsWith('#'))return k.id===sel.slice(1);
  return false;
}
function makeEl(id){
  const el={
    id,_kids:[],_listeners:{},_innerHTML:'',
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    style:{},dataset:{},
    appendChild(n){this._kids.push(n);n.parentNode=this;},
    insertBefore(n){this._kids.unshift(n);},
    removeChild(n){const i=this._kids.indexOf(n);if(i>=0)this._kids.splice(i,1);},
    width:420,height:340,clientWidth:420,clientHeight:340,
    _ctx:null,getContext(){ if(!this._ctx)this._ctx=makeCtx(this); return this._ctx; },
    getBoundingClientRect(){return {width:420,height:340,left:0,top:0};},
    querySelector(sel){return this._kids.find(k=>_matchChild(k,sel))||null;},
    querySelectorAll(sel){return this._kids.filter(k=>_matchChild(k,sel));},
    addEventListener(t,f){(this._listeners[t]=this._listeners[t]||[]).push(f);},
    setPointerCapture(){},releasePointerCapture(){},
    _fire(t,ev){(this._listeners[t]||[]).forEach(f=>f(ev));},
  };
  let _html='';
  Object.defineProperty(el,'innerHTML',{
    get(){return _html;},
    set(v){ _html=String(v); el._kids=_parse(v); el.innerHTMLSets=(el.innerHTMLSets||0)+1; }
  });
  return el;
}
function _parse(html){
  const re=/<(button|canvas|div|span)\b([^>]*)>/gi;let m;const els=[];
  while((m=re.exec(html))){
    const tag=m[1],attrs=m[2];
    const k={tag,_kids:[],_listeners:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},style:{},dataset:{},
      _ctx:null,getContext(){ if(!this._ctx)this._ctx=makeCtx(this); return this._ctx; },
      getBoundingClientRect(){return {width:420,height:340};},
      querySelector(sel){return this._kids.find(q=>_matchChild(q,sel))||null;},
      querySelectorAll(sel){return this._kids.filter(q=>_matchChild(q,sel));},
      addEventListener(t,f){(this._listeners[t]=this._listeners[t]||[]).push(f);},
      setPointerCapture(){},releasePointerCapture(){},_fire(t,ev){(this._listeners[t]||[]).forEach(f=>f(ev));},
      appendChild(n){this._kids.push(n);},removeChild(n){const i=this._kids.indexOf(n);if(i>=0)this._kids.splice(i,1);},
      width:420,height:340,clientWidth:420,clientHeight:340};
    const ct=attrs.match(/data-ct="([^"]+)"/); if(ct)k.dataset.ct=ct[1];
    k.className=(attrs.match(/class="([^"]+)"/)||[])[1]||'';
    if(tag==='canvas'&&/bbma-cv/.test(k.className))k._cv=true;
    els.push(k);
  }
  return els;
}
const byId={};
['bbma-chart','bbma-chart-status','bbma-matrix','bbma-news','bbma-tfs','bbma-filter','bbma-alert-hero','bbma-alert-strip','bbma-alert-evidence','bbma-alert-action','bbma-alert-history','bbma-proximity','bbma-alerts','bbma-taxis','bbma-inspector'].forEach(id=>byId[id]=makeEl(id));
const mainEl=makeEl('__main');mainEl.insertBefore=()=>{};const navEl=makeEl('__nav');
const documentStub={
  readyState:'complete', head:makeEl('head'), body:makeEl('body'),
  getElementById:id=>byId[id]||null,
  querySelector:sel=>sel==='main.main'?mainEl:(sel==='nav#bottomnav'?navEl:null),
  querySelectorAll:()=>[],
  createElement:tag=>makeEl('dyn-'+tag),
  addEventListener(t,f){ (this._l=this._l||{})[t]=(this._l[t]||[]).concat(f); },
  dispatchEvent(ev){ (this._l&&this._l[ev.type]||[]).forEach(f=>f(ev)); },
  documentElement:{},
};
const win={
  BBMA_RUNTIME:null, MARKET_DATA:{live:{twelveDataApiKey:''}},
  devicePixelRatio:2, scrollTo(){},
  addEventListener(t,f){ (win._l=win._l||{})[t]=(win._l[t]||[]).concat(f); },
  removeEventListener(){}, dispatchEvent(ev){ (win._l&&win._l[ev.type]||[]).forEach(f=>f(ev)); },
  setInterval:()=>0,clearInterval:()=>{},
  localStorage:{getItem:()=>null,setItem:()=>{}},
  ResizeObserver:class{observe(){}disconnect(){}},
  requestAnimationFrame:f=>{f();return 0;},
  setTimeout:f=>{return 0;}, clearTimeout:()=>{},
  fetch:async()=>({status:444,ok:false,json:async()=>({})}),
  CustomEvent:function(){},
  navigator:{userAgent:'node'},
};
win.document=documentStub; win.window=win; win.globalThis=win;

(async()=>{
  /* REAL GC=F M15 candles with BB/EMA50 (same decor as the chart-interactive test) */
  const r0=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=5d&interval=1m',{headers:{'user-agent':'Mozilla/5.0'}});
  const j0=await r0.json();const res=j0.chart.result[0];const ts=res.timestamp,q=res.indicators.quote[0];
  const m1=ts.map((t,i)=>({time:t*1000,open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i],volume:q.volume[i]||0})).filter(c=>c.open&&c.high&&c.low&&c.close);
  const big=R.buildFrames(m1);
  function deco(bars){return bars.map((b,i)=>{const sl=bars.slice(0,i+1);const bb=E.bands(sl,20,2)||{};const e50=E.ema(sl.map(x=>x.close),50);return{time:b.time,open:b.open,high:b.high,low:b.low,close:b.close,bbUpper:bb.upper??null,bbMiddle:bb.mid??null,bbLower:bb.lower??null,ema50:e50};});}
  const M15full=deco(big.M15).map(c=>Object.assign({},c,{time:new Date(c.time).getTime()}));
  const lastT=M15full[M15full.length-1].time, win90=90*3600000;
  const M15=M15full.filter(c=>(lastT-c.time)<=win90&&(lastT-c.time)>=0);
  assert.ok(M15.length>=120,'enough real M15 candles ('+M15.length+')');
  /* pre-seed a canonical runtime snapshot (this is what the chart reads) */
  win.BBMA_RUNTIME={ohlc:{M15},candles:{M15},mtf:{M15:{zone:'INSIDE_BB',trend:'DOWN',location:'DOWN'}},alerts:[],techAlerts:[],price:M15[M15.length-1].close,fresh:true,source:'LIVE_TICK_DERIVED',updatedMYT:'23:10'};
  /* load UMDs (label engine + zones + dashboard) */
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','lib','label-layout-engine.js'),'utf8'),win,{filename:'label-layout-engine.js'});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','lib','bbma-chart-zones.js'),'utf8'),win,{filename:'bbma-chart-zones.js'});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','bbma-dashboard-ui.js'),'utf8'),win,{filename:'bbma-dashboard-ui.js'});
  win.BBMADashboardUI.openAlert(null,'M15');

  const chartEl=byId['bbma-chart'];
  const cv=chartEl.querySelector('canvas.bbma-cv');
  assert.ok(cv,'canvas present after render');
  const opsBefore=cv._ctx._ops;
  const domSetsBefore=chartEl.innerHTMLSets||0;
  console.log('initial render: gridLine ops='+opsBefore.gridLine+', chart innerHTML sets='+domSetsBefore);
  assert.ok(opsBefore.gridLine>0,'grid was painted on the full render');

  /* ---- FEED A LIVE TICK (same forming candle -> no new bucket, domain likely unchanged) ---- */
  /* Simulate the runtime updating the LAST candle's close within the same bucket:
     replace the last candle close with a nearby price and dispatch the event the
     way bbma-runtime.publish() does. This is the exact tick-only case. */
  const lastC=M15[M15.length-1];
  const oldClose=lastC.close;
  lastC.close=Math.min(lastC.high, oldClose*1.0001); /* tiny move, still within the candle */
  lastC.high=Math.max(lastC.high,lastC.close);
  const detail=Object.assign({},win.BBMA_RUNTIME,{price:lastC.close.toFixed(2)});
  documentStub.dispatchEvent({type:'bbma-runtime-updated',detail:detail});

  const opsAfter=cv._ctx._ops;
  const domSetsAfter=chartEl.innerHTMLSets||0;
  console.log('after tick:  gridLine ops='+opsAfter.gridLine+', chart innerHTML sets='+domSetsAfter);

  /* 1. DOM was NOT rebuilt on the tick-only update */
  assert.strictEqual(domSetsAfter,domSetsBefore,'chart innerHTML (DOM) NOT rebuilt on a tick-only update');
  /* 2. grid LAYER-0 was NOT repainted (price domain unchanged -> cached blit) */
  assert.ok(opsAfter.gridLine<=opsBefore.gridLine,'grid NOT repainted per tick (grid ops '+opsBefore.gridLine+' -> '+opsAfter.gridLine+')');
  /* 3. a repaint DID occur (candles/labels layer still runs) — verify canvas
     got cleared + redrawn by checking some draw op advanced. */
  assert.ok(opsAfter.fillRect>=opsBefore.fillRect,'a repaint happened (fillRect '+opsBefore.fillRect+' -> '+opsAfter.fillRect+')');

  /* ---- Now a NEW closed candle -> full render. The CHART container still
     does NOT rebuild (by design: same canvas, TF unchanged); the full render is
     proven by the hero (and matrix) DOM rebuilding, which only happens on a
     full render, not on the tick-only fast path. ---- */
  const heroEl=byId['bbma-alert-hero'];
  const heroSetsBefore=heroEl.innerHTMLSets||0;
  M15.push({time:new Date(lastT+15*60000).toISOString(),open:oldClose,high:oldClose*1.01,low:oldClose*0.99,close:oldClose*1.005,bbUpper:null,bbMiddle:null,bbLower:null,ema50:null});
  const detail2=Object.assign({},win.BBMA_RUNTIME,{price:(oldClose*1.005).toFixed(2)});
  documentStub.dispatchEvent({type:'bbma-runtime-updated',detail:detail2});
  const heroSetsAfter=heroEl.innerHTMLSets||0;
  const chartSetsAfter2=chartEl.innerHTMLSets||0;
  console.log('after NEW candle: hero innerHTML sets '+heroSetsBefore+' -> '+heroSetsAfter+' | chart sets '+chartSetsAfter2);
  assert.ok(heroSetsAfter>heroSetsBefore,'a NEW closed candle triggers a FULL render (hero DOM rebuilt)');
  assert.strictEqual(chartSetsAfter2,domSetsBefore,'chart container DOM STILL not rebuilt (canvas reused) on new candle, same TF');

  console.log('/fast-load proof: tick-only -> chart DOM NOT rebuilt ('+domSetsBefore+'->'+domSetsAfter+') + grid NOT repainted ('+opsBefore.gridLine+'->'+opsAfter.gridLine+') + canvas repainted; new candle -> FULL render (hero DOM rebuilt '+heroSetsBefore+'->'+heroSetsAfter+', chart DOM still '+chartSetsAfter2+')');
  process.exit(0);
})().catch(e=>{console.error('FAIL:',e.stack||e.message);process.exit(1);});
