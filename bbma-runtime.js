/* BBMA runtime bridge: validated XAU ticks -> rolling OHLC -> BBMA MTF context.
 *
 * HONESTY CONTRACT (P0 defuse, branch p0/bbma-runtime-honest-state):
 *  - NEVER fabricate candles, alerts, events, or prices. The previous revision
 *    seeded 60 sine-wave candles per timeframe around a hardcoded $2,658.50 base
 *    and shipped hardcoded demo alerts + a fake event card into the public
 *    dashboard — and the Telegram poster was one broken step from posting them
 *    to the real channel. That is gone.
 *  - A cold load has ZERO candles and ZERO alerts. The dashboard shows its
 *    INSUFFICIENT_DATA / "waiting for validated OHLC" states until REAL ticks
 *    arrive (LiveFeed metals poll and/or Twelve Data WS) and enough bars
 *    accumulate per timeframe (20+ for READY).
 *  - window.BBMA_RUNTIME.publishable === false whenever state cannot be backed
 *    by fresh real ticks AND real (externally supplied) alerts.
 *    send-bbma-telegram.js refuses to broadcast anything not publishable.
 *  - Node-safe: this file MUST stay loadable with a bare `window` object (no
 *    addEventListener, no document) because send-bbma-telegram.js evaluates it
 *    in Node. The old revision crashed there on window.addEventListener, which
 *    made loadRuntime() permanently return null — the guard then suppressed
 *    every post by accident, and a naive "fix" would have started posting demos.
 */
(function(){'use strict';
var TFS={M5:300000,M15:900000,M30:1800000,H1:3600000,H4:14400000,D1:86400000,W1:604800000,MN1:2592000000};
var FRESH_WINDOW_MS=5*60*1000;   /* publishable while a real tick landed < 5 min ago */
var STALE_AFTER_MS=10*60*1000;   /* surface STALE after 10 min without a tick */
var frames={},lastPrice=null,lastAt=null,max=240;
var _externalAlerts=[],_externalAlertHistory=[];
var _nodePollTimer=null;

function bucket(t,ms){return Math.floor(t/ms)*ms;}

/* Build/extend a candle from a REAL tick (tick-derived, never fabricated). */
function add(tf,p,t){
  var a=frames[tf]||(frames[tf]=[]),b=bucket(t,TFS[tf]),c=a[a.length-1];
  if(!c||c._b!==b){
    c={_b:b,time:new Date(b).toISOString(),open:p,high:p,low:p,close:p,source:'LIVE_TICK_DERIVED'};
    a.push(c);
    if(a.length>max)a.shift();
  }else{
    c.high=Math.max(c.high,p);c.low=Math.min(c.low,p);c.close=p;
  }
}

function sma(a,n){if(a.length<n)return null;return a.slice(-n).reduce(function(s,v){return s+v;},0)/n;}
function ema(a,n){if(a.length<n)return null;var k=2/(n+1),e=a.slice(0,n).reduce(function(s,v){return s+v;},0)/n;for(var i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
function lwma(a,n){if(!a.length)return null;var x=a.slice(-n),d=n*(n+1)/2;return x.reduce(function(s,v,i){return s+v*(i+1);},0)/d;}

/* BB(20,2) + EMA50 + LWMA5/10 fractal classification. Returns INSUFFICIENT_DATA
 * until at least 20 REAL candles exist — no partial readings are invented. */
function classify(a){
  if(!a||a.length<20)return{state:'INSUFFICIENT_DATA',candles:a?a.length:0,trend:'—',momentum:'—',reentry:'—',csak:'—',mhv:'—',extreme:'—',zone:'—',location:'—',ema50Position:'—',emaGap:'—',upperProximity:0,midProximity:0,lowerProximity:0,ema50Proximity:0};
  var closes=a.map(function(x){return x.close;}),highs=a.map(function(x){return x.high;}),lows=a.map(function(x){return x.low;});
  var nCloses=Math.min(20,closes.length);
  var mid=sma(closes,nCloses)||closes[closes.length-1];
  var sq=closes.slice(-nCloses).reduce(function(s,x){return s+Math.pow(x-mid,2);},0)/nCloses;
  var sd=Math.sqrt(sq)||1;
  var upper=mid+2*sd,lower=mid-2*sd;
  var nEma=Math.min(50,closes.length);
  var e50=ema(closes,nEma)||mid;
  var m5h=lwma(highs,Math.min(5,highs.length))||highs[highs.length-1];
  var m10h=lwma(highs,Math.min(10,highs.length))||m5h;
  var m5l=lwma(lows,Math.min(5,lows.length))||lows[lows.length-1];
  var m10l=lwma(lows,Math.min(10,lows.length))||m5l;
  var last=a[a.length-1];
  var trend=last.close>mid&&last.close>e50?'UP':last.close<mid&&last.close<e50?'DOWN':'MIXED';
  var momentum=last.close>upper?'MOMENTUM_UP':last.close<lower?'MOMENTUM_DOWN':'NONE';
  var extreme=m5h>upper?'EXTREME_HIGH':m5l<lower?'EXTREME_LOW':'NONE';
  var dir=last.close>=last.open?'UP':'DOWN';
  var csak=dir==='UP'&&last.close>m5h&&last.close>mid?'CSAK_UP':dir==='DOWN'&&last.close<m5l&&last.close<mid?'CSAK_DOWN':'NONE';
  var re='NONE';
  if(trend==='UP'&&last.low<=Math.max(m5l,m10l)&&last.close>mid)re='REENTRY_UP_ZONE';
  if(trend==='DOWN'&&last.high>=Math.min(m5h,m10h)&&last.close<mid)re='REENTRY_DOWN_ZONE';
  var bandWidth=upper-lower||1;
  var upperProx=Math.max(0,Math.min(100,((upper-last.close)/bandWidth)*100));
  var midProx=Math.max(0,Math.min(100,(1-Math.abs(last.close-mid)/(bandWidth/2))*100));
  var lowerProx=Math.max(0,Math.min(100,((last.close-lower)/bandWidth)*100));
  var emaProx=Math.max(0,Math.min(100,(1-Math.abs(last.close-e50)/(bandWidth/2))*100));

  /* Per-candle BB(20,2) mid/upper/lower + EMA50 series — consumed by the
   * dashboard SVG chart to draw its band polylines from REAL candles only. */
  var bbMiddle=[],bbUpper=[],bbLower=[],ema50ser=[];
  for(var i2=0;i2<a.length;i2++){
    var cc=closes.slice(Math.max(0,i2-19),i2+1);
    var m2=sma(cc,20),sd2=null;
    if(m2!=null){var sq2=cc.reduce(function(t,v){return t+Math.pow(v-m2,2);},0)/cc.length;sd2=Math.sqrt(sq2);}
    bbMiddle.push(sd2!=null?m2:(cc.length?cc[cc.length-1]:null));
    bbUpper.push(sd2!=null?m2+2*sd2:null);
    bbLower.push(sd2!=null?m2-2*sd2:null);
    var ee=closes.slice(Math.max(0,i2-49),i2+1);
    ema50ser.push(ema(ee,50));
  }
  a.forEach(function(c,i2){c.bbMiddle=bbMiddle[i2];c.bbUpper=bbUpper[i2];c.bbLower=bbLower[i2];c.ema50=ema50ser[i2];});

  return{
    state:'READY',
    trend:trend,
    momentum:momentum,
    extreme:extreme,
    csak:csak,
    csa:csak,
    reentry:re,
    mhv:trend==='UP'&&last.high<upper&&last.close>mid?'VALID_MHV':'NONE',
    zone:last.close>mid?'UPPER_BAND':'LOWER_BAND',
    location:last.close>mid?'MID_BB_BOUNCE':'LOWER_BB_REJECT',
    ema50Position:last.close>e50?'ABOVE_EMA50':'BELOW_EMA50',
    emaGap:(((last.close-e50)/e50)*100).toFixed(2)+'%',
    upperProximity:upperProx,
    midProximity:midProx,
    lowerProximity:lowerProx,
    ema50Proximity:emaProx,
    bb:{upper:upper,mid:mid,lower:lower},
    ema50:e50,
    close:last.close,
    lastTime:last.time,
    candles:a.length
  };
}

/* Publish the CURRENT real state — or the honest empty state on a cold load.
 * Alerts are NEVER invented: they are populated only by an external validated
 * source (HELIX core / news-shadow pipeline) via BBMARuntime.setAlerts(). */
function publish(){
  var now=Date.now();
  var ageMs=lastAt!=null?Math.max(0,now-Date.parse(lastAt)):null;
  var fresh=ageMs!=null&&ageMs<=FRESH_WINDOW_MS;
  var stale=ageMs!=null&&ageMs>STALE_AFTER_MS;
  var hasTicks=lastPrice!=null;
  var mytTime=hasTicks?new Date(Date.parse(lastAt)+8*3600*1000).toISOString().slice(11,16)+' MYT':'—';
  var out={
    symbol:'XAU/USD',
    price:hasTicks?lastPrice.toFixed(2):null,
    last:hasTicks?lastPrice.toFixed(2):null,
    at:lastAt||null,
    updatedMYT:mytTime,
    alertState:stale?'STALE':'PRE-EVENT',
    fresh:fresh,
    freshness:stale?'STALE_SNAPSHOT':fresh?'FRESH_SNAPSHOT':'NO_LIVE_TICKS',
    source:hasTicks?'LIVE_TICK_DERIVED':'NONE',
    liveTicks:hasTicks?1:0,
    publishable:hasTicks&&fresh===true&&_externalAlerts.length>0,
    demo:false,
    ohlc:frames,
    candles:frames,
    frames:{},
    alerts:_externalAlerts,
    alertHistory:_externalAlertHistory,
    event:null
  };

  Object.keys(frames).forEach(function(tf){out.frames[tf]=classify(frames[tf]);});
  out.mtf=out.frames;
  out.timeframes=out.frames;

  var w=typeof window!=='undefined'?window:globalThis;
  w.BBMA_RUNTIME=out;
  w.BBMA_DASHBOARD=out;
  try{if(typeof w.dispatchEvent==='function')w.dispatchEvent(new CustomEvent('bbma-runtime-updated',{detail:out}));}catch(e){}
}

function ingest(p,at){
  p=Number(p);
  if(!isFinite(p)||p<=0)return;
  var t=at?new Date(at).getTime():Date.now();
  if(!isFinite(t))t=Date.now();
  /* Reject out-of-window ticks (clock skew / stale poller / a device clock
   * running ahead) so an old or impossible price can never move a candle. */
  var now=Date.now();
  if(t<now-60*1000||t>now+5*60*1000)return;
  lastPrice=p;
  lastAt=new Date(t).toISOString();
  Object.keys(TFS).forEach(function(tf){add(tf,p,t);});
  publish();
}

function setAlerts(alerts,history){
  _externalAlerts=Array.isArray(alerts)?alerts:[];
  _externalAlertHistory=Array.isArray(history)?history:[];
  publish();
}

var w=typeof window!=='undefined'?window:globalThis;
w.BBMARuntime={
  ingest:ingest,
  setAlerts:setAlerts,
  snapshot:function(){return w.BBMA_RUNTIME||null;},
  frames:frames
};

/* Browser only: explicit tick events (dispatched by the live feed wiring). */
if(typeof w.addEventListener==='function'){
  w.addEventListener('xau-live-tick',function(e){var d=e&&e.detail||{};ingest(d.price,d.at);});
}

/* Browser only: poll LiveFeed metals every 2s. The previous revision called
 * the nonexistent LiveFeed.snapshot() and therefore never delivered a tick;
 * LiveFeed.metal('XAU') is the real accessor (gold-api.com primary,
 * CoinGecko tether-gold fallback). The Twelve Data WS stream (dispatched as
 * xau-live-tick by app.js) is a second REAL source; ingesting both is safe —
 * they observe the same spot price and candle updates are idempotent. */
if(typeof w.addEventListener==='function'&&typeof w.setInterval==='function'){
  w.setInterval(function(){
    try{
      var LF=w.LiveFeed;
      if(!LF||typeof LF.metal!=='function')return;
      /* gold-api poll keys it "XAU"; the Twelve Data WS keys it "XAU/USD". */
      var p=null;
      ['XAU','XAU/USD','XAUUSD'].forEach(function(k){ if(p==null) p=LF.metal(k); });
      if(p==null)return;
      if(p!==lastPrice)ingest(p,new Date());
    }catch(e){}
  },2000);
}
/* Node: the poster is a short-lived CLI. The old revision's bare setInterval
 * would have kept the process alive forever once loading succeeded; install an
 * inert unref'd timer so `node send-bbma-telegram.js` still exits. */
if(typeof w.addEventListener!=='function'&&typeof setInterval==='function'){
  _nodePollTimer=setInterval(function(){},1<<30);
  if(typeof _nodePollTimer.unref==='function')_nodePollTimer.unref();
}

publish();
})();
