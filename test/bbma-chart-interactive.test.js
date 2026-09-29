'use strict';
/* EXECUTED proof of the interactive BBMA chart (fast canvas, zoom/pan, Tokyo->US
 * span) against REAL GC=F candles — not a string check. Loads the UMD with a DOM +
 * recording-2D-canvas stub, renders on M15 (316 real bars -> real pan room), then
 * simulates wheel / pointer-drag / button input and asserts the chart state
 * actually changes and real draw calls were issued. */
const fs=require('fs'),assert=require('assert'),path=require('path'),vm=require('vm');
const E=require('../lib/bbma-engine.js'),R=require('../lib/ohlc-resampler.js');

/* ---- recording 2D context: counts real draw ops ---- */
function makeCtx(cv){
  const ops={fillRect:0,lineTo:0,moveTo:0,strokeRect:0,arc:0,fillText:0};
  return {
    _ops:ops,
    clearRect(){}, drawImage(){}, fillRect(x,y,w,h){ops.fillRect++;},
    strokeRect(x,y,w,h){ops.strokeRect++;}, beginPath(){}, moveTo(x,y){ops.moveTo++;},
    lineTo(x,y){ops.lineTo++;}, stroke(){}, fill(){},
    arc(x,y,r){ops.arc++;}, setLineDash(){}, closePath(){}, save(){},restore(){},
    fillText(t,x,y){ops.fillText++;}, measureText(t){return {width:((t||'').length*4)||0};},
    set fillStyle(v){}, get fillStyle(){return '';},
    set strokeStyle(v){}, get strokeStyle(){return '';},
    set lineWidth(v){}, get lineWidth(){return 1;},
    set font(v){}, get font(){return '';},
    set textAlign(v){}, get textAlign(){return 'left';},
    set textBaseline(v){}, get textBaseline(){return 'alphabetic';},
  };
}

/* ---- minimal DOM ---- */
function _matchChild(k,sel){
  if(sel.startsWith('[data-ct'))return !!(k.dataset&&k.dataset.ct);
  if(sel==='canvas.bbma-cv')return !!k._cv;
  if(sel.startsWith('.'))return (k.className||'').includes(sel.slice(1));
  if(sel.startsWith('#'))return k.id===sel.slice(1);
  if(sel==='main.main')return k.id==='__main';
  if(sel==='nav#bottomnav')return k.id==='__nav';
  return false;
}
function makeEl(id){
  const el={
    id, _kids:[], _listeners:{}, _innerHTML:'',
    classList:{add(){},remove(){},toggle(){},contains(){return false;}},
    style:{}, dataset:{},
    appendChild(){}, insertBefore(){}, removeChild(){},
    width:0,height:0, clientWidth:420, clientHeight:340,
    _ctx:null,
    getContext(){ if(!this._ctx){this._ctx=makeCtx(this);} return this._ctx; },
    getBoundingClientRect(){return {width:420,height:340,left:0,top:0};},
    querySelector(sel){ return this._kids.find(k=>_matchChild(k,sel))||null; },
    querySelectorAll(sel){ return this._kids.filter(k=>_matchChild(k,sel)); },
    set innerHTML(html){ this._innerHTML=String(html); this._kids=_parse(String(html)); },
    get innerHTML(){ return this._innerHTML; },
    addEventListener(t,f){ (this._listeners[t]=this._listeners[t]||[]).push(f); },
    setPointerCapture(){}, releasePointerCapture(){},
    _fire(t,ev){ (this._listeners[t]||[]).forEach(f=>f(ev)); },
  };
  return el;
}
function _parse(html){
  const re=/<(button|canvas|div|span)\b([^>]*)>/gi;let m;const els=[];
  while((m=re.exec(html))){
    const tag=m[1],attrs=m[2];
    const k={tag,_kids:[],_listeners:{},classList:{add(){},remove(){},toggle(){},contains(){return false}},style:{},dataset:{},
      _ctx:null, getContext(){ if(!this._ctx){this._ctx=makeCtx(this);} return this._ctx; },
      getBoundingClientRect(){return {width:420,height:340};},
      querySelector(sel){ return this._kids.find(q=>_matchChild(q,sel))||null; },
      querySelectorAll(sel){ return this._kids.filter(q=>_matchChild(q,sel)); },
      addEventListener(t,f){(this._listeners[t]=this._listeners[t]||[]).push(f);},
      setPointerCapture(){}, releasePointerCapture(){}, _fire(t,ev){(this._listeners[t]||[]).forEach(f=>f(ev));},
      width:420,height:340,clientWidth:420,clientHeight:340};
    const ct=attrs.match(/data-ct="([^"]+)"/); if(ct)k.dataset.ct=ct[1];
    k.className=(attrs.match(/class="([^"]+)"/)||[])[1]||'';
    if(tag==='canvas'&&/bbma-cv/.test(k.className))k._cv=true;
    els.push(k);
  }
  return els;
}
const byId={};
['bbma-chart','bbma-chart-status','bbma-matrix','bbma-news','bbma-tfs','bbma-filter','bbma-alert-hero','bbma-alert-strip','bbma-alert-evidence','bbma-alert-action','bbma-alert-history','bbma-proximity','bbma-alerts','bbma-taxis'].forEach(id=>byId[id]=makeEl(id));
const mainEl=makeEl('__main');mainEl.insertBefore=()=>{};const navEl=makeEl('__nav');
const documentStub={
  readyState:'complete',
  head:makeEl('head'), body:makeEl('body'),
  getElementById:id=>byId[id]||null,
  querySelector:sel=>sel==='main.main'?mainEl:(sel==='nav#bottomnav'?navEl:null),
  querySelectorAll:()=>[],
  createElement:tag=>makeEl('dyn-'+tag),
  addEventListener(){},
  documentElement:{},
};

const win={
  BBMA_RUNTIME:null, MARKET_DATA:{},
  devicePixelRatio:2,
  scrollTo(){},
  addEventListener(){}, removeEventListener(){}, dispatchEvent(){},
  setInterval:()=>0, clearInterval:()=>{},
  localStorage:{getItem:()=>null,setItem:()=>{}},
  ResizeObserver:class{observe(){}disconnect(){}},
  requestAnimationFrame:f=>{try{f();}catch(e){} return 0;},
  setTimeout:(f)=>{try{f();}catch(e){} return 0;}, clearTimeout:()=>{},
  fetch:async()=>({status:444,ok:false,json:async()=>({})}),
  CustomEvent:function(){},
  navigator:{userAgent:'node'},
};
win.document=documentStub; win.window=win; win.globalThis=win;

(async()=>{
  /* real GC=F M15 candles (~316 bars) with per-candle BB/EMA50 */
  const r0=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?range=5d&interval=1m',{headers:{'user-agent':'Mozilla/5.0'}});
  const j0=await r0.json();const res=j0.chart.result[0];const ts=res.timestamp,q=res.indicators.quote[0];
  const m1=ts.map((t,i)=>({time:t*1000,open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i],volume:q.volume[i]||0})).filter(c=>c.open&&c.high&&c.low&&c.close);
  const big=R.buildFrames(m1);
  function deco(bars){return bars.map((b,i)=>{const sl=bars.slice(0,i+1);const bb=E.bands(sl,20,2)||{};const e50=E.ema(sl.map(x=>x.close),50);return{time:b.time,open:b.open,high:b.high,low:b.low,close:b.close,bbUpper:bb.upper??null,bbMiddle:bb.mid??null,bbLower:bb.lower??null,ema50:e50};});}
  const M15full=deco(big.M15).map(c=>Object.assign({},c,{time:new Date(c.time).getTime()}));
  /* sessionAnchors has a 96h guard (per-day markers crowd D1+ views). Trim to the
   * most recent <=90h of CONTINUOUS trading so Tokyo + US opens both fall in-window. */
  const lastT=M15full[M15full.length-1].time, win90=90*3600000;
  const M15=M15full.filter(c=>(lastT-c.time)<=win90 && (lastT-c.time)>=0);
  assert.ok(M15.length>=120,'enough real M15 candles in a <90h window ('+M15.length+')');
  win.BBMA_RUNTIME={ohlc:{M15},candles:{M15},mtf:{M15:{zone:'INSIDE_BB',trend:'DOWN',location:'DOWN'}},alerts:[],techAlerts:[],price:M15[M15.length-1].close,fresh:true,source:'LIVE_TICK_DERIVED',updatedMYT:'23:10'};
  /* load the dashboard UMD */
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','bbma-dashboard-ui.js'),'utf8'),win,{filename:'bbma-dashboard-ui.js'});
  /* switch to M15 via the public API (renders the real chart) */
  win.BBMADashboardUI.openAlert(null,'M15');

  const cv=byId['bbma-chart'].querySelector('canvas.bbma-cv');
  assert.ok(cv,'canvas must exist after render');
  const btns=byId['bbma-chart'].querySelectorAll('[data-ct]');
  assert.ok(btns.length>=4,'zoom in/out + T->U + CLR buttons present (got '+btns.length+')');
  const ops0=cv._ctx._ops;
  assert.ok(ops0.moveTo>0&&ops0.lineTo>0,'candles + bands produced real draw calls (moveTo='+ops0.moveTo+' lineTo='+ops0.lineTo+')');
  assert.ok(ops0.fillRect>0,'candle bodies drawn (fillRect='+ops0.fillRect+')');
  assert.ok(ops0.fillText>0,'price/time labels drawn (fillText='+ops0.fillText+')');

  /* ---- ZOOM (wheel) must change the visible window ---- */
  const visBefore=win.__V.vis.M15;
  cv._fire('wheel',{preventDefault(){},offsetX:210,offsetY:170,deltaY:-100});
  assert.ok(win.__V,'V view-state exposed for testing');
  assert.ok(win.__V.vis.M15!==visBefore,'wheel zoom changed vis (before='+visBefore+' after='+win.__V.vis.M15+')');

  /* ---- PAN (pointer drag) must shift the right edge (reveal older candles).
     Data-robust: the anchor tolerance (14px) can grab the Tokyo/US first-candle
     marker and switch to SPAN mode instead of PAN, so pick a drag start that is
     >20px from every session anchor, computed from the same geometry anchorAt uses. */
  const rightBefore=win.__V.right.M15;
  const plotW=(420)-16, slot=plotW/win.__V.vis.M15;
  const anchorXs=win.__anchors(M15).map(a=>8+(a.i-(win.__V.right.M15-win.__V.vis.M15))*slot);
  let startX=null;
  for(let x=60;x<=230 && startX===null;x+=4){ if(anchorXs.every(ax=>Math.abs(ax-x)>20)) startX=x; }
  assert.ok(startX!==null,'found a pan start X clear of every session anchor');
  cv._fire('pointerdown',{pointerId:1,offsetX:startX,offsetY:170});
  cv._fire('pointermove',{pointerId:1,offsetX:startX+170,offsetY:170}); /* drag right -> older -> right decreases */
  cv._fire('pointerup',{pointerId:1,offsetX:startX+170,offsetY:170});
  assert.ok(win.__V.right.M15<rightBefore,'drag panned to older candles (right '+rightBefore+' -> '+win.__V.right.M15+')');

  /* ---- Tokyo -> US open span: the T->U button must set a real span ---- */
  const tu=btns.find(b=>b.dataset.ct==='tokus');
  tu._fire('click',{});
  assert.ok(win.__V.span.M15,'T->U button sets the Tokyo->US span');
  assert.ok(win.__V.span.M15.b>win.__V.span.M15.a,'span covers Tokyo(earlier) -> US(later): a='+win.__V.span.M15.a+' b='+win.__V.span.M15.b);
  /* span must actually contain real Tokyo & US opens from the session engine */
  const anchors=win.__anchors(M15);
  assert.ok(anchors.some(a=>a.kind==='TOKYO'),'session anchors include TOKYO open');
  assert.ok(anchors.some(a=>a.kind==='US'),'session anchors include US open');
  const aTok=anchors.filter(a=>a.kind==='TOKYO')[0];
  const aUs=anchors.find(a=>a.kind==='US'&&a.ts>aTok.ts); /* same-session US open (after this Tokyo 00:00) */
  assert.ok(aUs,'window contains a US open after the Tokyo open');
  assert.ok(win.__V.span.M15.a===aTok.i&&win.__V.span.M15.b===aUs.i,'span endpoints are the Tokyo-1st and same-session US-1st candle indexes');

  /* ---- span box + first-candle dots drawn ---- */
  const opsAfter=cv._ctx._ops;
  assert.ok(opsAfter.strokeRect>0,'session / span rectangles drawn (strokeRect='+opsAfter.strokeRect+')');
  assert.ok(opsAfter.arc>0,'first-candle session markers drawn as dots (arc='+opsAfter.arc+')');

  console.log('interactive BBMA chart proof: render + zoom + pan + Tokyo->US span on real GC=F M15 data');
  console.log('  real M15 candles:',M15.length,'| last close',M15[M15.length-1].close);
  console.log('  draw ops: moveTo',ops0.moveTo,'lineTo',ops0.lineTo,'fillRect',ops0.fillRect,'fillText',ops0.fillText,'arc',opsAfter.arc,'strokeRect',opsAfter.strokeRect);
  console.log('  zoom vis',visBefore,'->',win.__V.vis.M15,'| pan right',rightBefore,'->',win.__V.right.M15,'| span',JSON.stringify(win.__V.span.M15));
  process.exit(0);
})().catch(e=>{console.error('FAIL:',e.stack||e.message);process.exit(1);});
