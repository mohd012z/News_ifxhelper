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
 *    accumulate per timeframe (50+ for READY — canonical values() gate).
 *  - HISTORY BACKFILL (real data, not fabrication): on a cold load the runtime
 *    may seed each timeframe with the last 240 REAL XAU/USD bars fetched from
 *    the Twelve Data time_series REST endpoint (same provider + key the live
 *    WS uses). Every backfilled candle carries source:'TWELVEDATA_BACKFILL'.
 *    Live ticks always win: if a live candle already exists in a bucket, the
 *    backfill never overwrites it — it only prepends strictly-older bars. If
 *    the key is missing or the fetch fails, the runtime stays honestly empty.
 *  - window.BBMA_RUNTIME.publishable === false whenever state cannot be backed
 *    by fresh real ticks AND real (externally supplied) alerts.
 *    send-bbma-telegram.js refuses to broadcast anything not publishable.
 *    (Backfilled history NEVER makes a snapshot publishable by itself.)
 *  - Node-safe: this file MUST stay loadable with a bare `window` object (no
 *    addEventListener, no document, no fetch) because send-bbma-telegram.js
 *    evaluates it in Node. The old revision crashed there on
 *    window.addEventListener, which made loadRuntime() permanently return
 *    null — the guard then suppressed every post by accident, and a naive
 *    "fix" would have started posting demos. Backfill is browser-only.
 */
(function(){'use strict';
var TFS={M5:300000,M15:900000,M30:1800000,H1:3600000,H4:14400000,D1:86400000,W1:604800000,MN1:2592000000};
var TF_INTERVAL={H1:'1h',M5:'5min',M15:'15min',M30:'30min',H4:'4h',D1:'1day',W1:'1week',MN1:'1month'};
/* ORDER = call order: the dashboard's default view (H1) fills FIRST, then the
 * rest. One REST call per timeframe; the free tier allows 8 credits/MINUTE, so
 * the default pace is 10s between calls (8 calls over ~70s ≈ 7 credits/min).
 * A 429 (limit hit) backs off 65s and retries the timeframe once. Tests
 * override the pace via window.__bbmaBackfillPaceMs (e.g. 20ms). */
var BACKFILL_BARS=240;   /* real bars kept per TF (M5=2d ... MN1=20y) */
var BACKFILL_PACE_MS=10000;   /* 8 calls over ~70s keeps us well under 8 credits/min */
var BACKFILL_429_RETRY_MS=65000;
var FRESH_WINDOW_MS=5*60*1000;   /* publishable while a real tick landed < 5 min ago */
var STALE_AFTER_MS=10*60*1000;   /* surface STALE after 10 min without a tick */
var frames={},lastPrice=null,lastAt=null,max=240;
/* CANONICAL FEED STATE MACHINE (spec: CONNECTING/LIVE/DEGRADED/RECONNECTING/
 * BACKFILL) + metrics. Derived from REAL conditions only — the state is a
 * function of tick age, source health, and the backfill stage. The UI renders
 * this object; it never re-derives feed health itself.
 *   provider        last real source that moved a tick (stream | poll | backfill)
 *   connected       source transport is up (setFeedStatus from LiveFeed)
 *   lastTickAt      ISO of last accepted tick
 *   latencyMs       age of the last tick (we have no server timestamp)
 *   tickCount       accepted ticks this session
 *   reconnectCount  transport offline->up transitions observed
 *   droppedTicks    ticks rejected by the freshness guard (stale/future)
 *   outOfOrderTicks ticks with a timestamp older than the last accepted
 *   gapDetected     a completed M1 bucket skipped by the last tick
 *   backfillRequired history still missing (cold load, no ticks yet) */
var _feed={provider:null,connected:false,lastTickAt:null,tickCount:0,reconnectCount:0,droppedTicks:0,outOfOrderTicks:0,gapDetected:false};
function _lastTickTimeMs(){return lastAt?Date.parse(lastAt):null;}
var _externalAlerts=[],_externalAlertHistory=[];
var _nodePollTimer=null;
var _backfill={at:null,lastPrice:null,tfs:{},errors:[]};
var _backfillPromise=null;

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

/* COLD-LOAD HISTORY BACKFILL (browser only). Fetches the last BACKFILL_BARS
 * REAL XAU/USD bars per timeframe from Twelve Data time_series (same provider
 * + key as the live WS — xauusd-data.js D.live.twelveDataApiKey) and seeds the
 * frames. Merge rule: LIVE TICKS ALWAYS WIN — a backfill bar never touches a
 * bucket that already holds a candle (live or earlier backfill); it only
 * extends the history strictly behind it. Backfill candles are labeled
 * source:'TWELVEDATA_BACKFILL' + backfilled:true so no renderer can present
 * them as live evidence. Any missing key / failed fetch / malformed bar
 * leaves the runtime honestly empty — it can only ADD real data, never
 * invent it. */
function backfillHistory(){
  var w=typeof window!=='undefined'?window:globalThis;
  if(!w||typeof w.fetch!=='function')return Promise.resolve(null);
  if(_backfillPromise)return _backfillPromise;
  var MD=w.MARKET_DATA||{};
  var liveCfg=MD.live||{};
  var key=liveCfg.twelveDataApiKey;
  if(!key||!/^https:\/\/api\.twelvedata\.com$/i.test(liveCfg.twelveDataHost||'https://api.twelvedata.com'))return Promise.resolve(null);
  _backfillPromise=(async function(){
    var tfs=Object.keys(TF_INTERVAL);
    var pace=(w.__bbmaBackfillPaceMs!=null)?w.__bbmaBackfillPaceMs:BACKFILL_PACE_MS;
    var retryMs=(w.__bbmaBackfillRetryMs!=null)?w.__bbmaBackfillRetryMs:BACKFILL_429_RETRY_MS;
    for(var i=0;i<tfs.length;i++){
      var tf=tfs[i];
      try{
        var url='https://api.twelvedata.com/time_series?symbol=XAU/USD&interval='+TF_INTERVAL[tf]+'&outputsize='+BACKFILL_BARS+'&timezone=UTC&apikey='+encodeURIComponent(key);
        var ctrl=(typeof AbortController!=='undefined')?new AbortController():null;
        var timer=ctrl?setTimeout(function(){ctrl.abort();},15000):null;
        var resp=await w.fetch(url,{signal:ctrl?ctrl.signal:undefined,headers:{'User-Agent':'XAU-Desk-BBMA/1.0'}});
        if(timer)clearTimeout(timer);
        if(resp.status===429){
          /* Free tier = 8 credits/min: we paced to stay under, but the key may
           * be shared. Wait 65s and retry THIS timeframe once; if it 429s
           * again, record it and move on (that TF stays empty — honest). */
          await new Promise(function(r){setTimeout(r,retryMs);});
          var ctrl2=(typeof AbortController!=='undefined')?new AbortController():null;
          var timer2=ctrl2?setTimeout(function(){ctrl2.abort();},15000):null;
          resp=await w.fetch(url,{signal:ctrl2?ctrl2.signal:undefined,headers:{'User-Agent':'XAU-Desk-BBMA/1.0'}});
          if(timer2)clearTimeout(timer2);
          if(resp.status===429||!resp.ok){
            _backfill.errors.push(tf+': rate limit (HTTP 429) — skipped, retry on next cold load');
            _backfill.at=new Date().toISOString();
            continue;
          }
        }
        var j=await resp.json();
        if(!j||!Array.isArray(j.values))throw new Error('no values');
        var bars=[];
        for(var k=j.values.length-1;k>=0;k--){ /* values arrive newest-first */
          var v=j.values[k];
          var o=Number(v.open),h=Number(v.high),l=Number(v.low),c=Number(v.close);
          var t=Date.parse(v.datetime.replace(' ','T')+'Z');
          if(![o,h,l,c].every(Number.isFinite)||h<l||h<Math.max(o,c)||l>Math.min(o,c))continue; /* malformed bar: skip, never coerce */
          if(!Number.isFinite(t)||t>Date.now()+5*60*1000)continue; /* impossible/future: reject */
          bars.push({time:t,o:o,h:h,l:l,c:c});
        }
        if(!bars.length)continue;
        /* UNION-BY-BUCKET merge: live/tick candles are never touched or
         * replaced — a backfill bar only fills a bucket that is EMPTY. This
         * is race-safe no matter when ticks arrive (poll or WS). The
         * CURRENT (still-forming) bucket is never seeded by backfill: the
         * forming candle is created by the first live tick, so its open is
         * the real first tick price, not a partial API bar. */
        var a=frames[tf]||(frames[tf]=[]);
        var byB={};a.forEach(function(c){byB[c._b]=1;});
        var curB=bucket(Date.now(),TFS[tf]);
        var added=0;
        for(var m=0;m<bars.length;m++){
          var b=bars[m],bk=bucket(b.time,TFS[tf]);
          if(bk===curB)continue;                 /* forming candle: live ticks only */
          if(byB[bk])continue; /* live tick already owns this bucket */
          a.push({_b:bk,time:new Date(bk).toISOString(),open:b.o,high:b.h,low:b.l,close:b.c,source:'TWELVEDATA_BACKFILL',backfilled:true});
          byB[bk]=1;added++;
        }
        if(added){
          a.sort(function(x,y){return x._b-y._b;}); /* restore time order */
          while(a.length>max)a.shift();              /* keep the newest `max` */
          _backfill.tfs[tf]={added:added,firstBar:bars[0].time,lastBar:bars[bars.length-1].time};
          if(lastPrice==null){_backfill.lastPrice=bars[bars.length-1].c;_backfill.lastPriceTime=bars[bars.length-1].time;} /* history baseline until a real tick lands */
        }
        _backfill.at=new Date().toISOString();
        if(added)publish(); /* chart + matrix fill in as each timeframe lands */
      }catch(e){
        _backfill.errors.push(tf+': '+(e&&e.message||e));
        _backfill.at=new Date().toISOString();
      }
      if(i<tfs.length-1)await new Promise(function(r){setTimeout(r,pace);});
    }
    return _backfill;
  })();
  return _backfillPromise;
}

function sma(a,n){if(a.length<n)return null;return a.slice(-n).reduce(function(s,v){return s+v;},0)/n;}
function ema(a,n){if(a.length<n)return null;var k=2/(n+1),e=a.slice(0,n).reduce(function(s,v){return s+v;},0)/n;for(var i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
function lwma(a,n){if(!a.length)return null;var x=a.slice(-n),d=n*(n+1)/2;return x.reduce(function(s,v,i){return s+v*(i+1);},0)/d;}

/* BB(20,2) + EMA50 + LWMA5/10 classification. CANONICAL PARITY: trend /
 * momentum / extreme / csak / reentry / (zone via the location overlay) use
 * the EXACT formulas of lib/bbma-engine.js classify() + lib/bbma-candle-watch.js
 * location() — the same code the CI watch (build-bbma-watch.js) and the Telegram
 * box run — so the app and the channel can never disagree on a reading.
 * Minimum 50 REAL candles (canonical values() gate) — no partial readings. */
function classify(a){
  if(!a||a.length<50)return{state:'INSUFFICIENT_DATA',candles:a?a.length:0,trend:'—',momentum:'—',reentry:'—',csak:'—',mhv:'—',extreme:'—',zone:'—',location:'—',ema50Position:'—',emaGap:'—',upperProximity:0,midProximity:0,lowerProximity:0,ema50Proximity:0};
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
  /* BB location — canonical 7-state model (matches lib/bbma-candle-watch.js
   * location(): tolerance = max(3% of band width, 0.015% of price),
   * precedence ABOVE -> BELOW -> near band -> near mid -> near EMA50). */
  var tol=Math.max((upper-lower)*0.03,Math.abs(last.close)*0.00015);
  var nearB=function(x,y){return Math.abs(x-y)<=tol;};
  var zone='INSIDE_BB';
  if(last.close>upper)zone='ABOVE_TOP_BB';
  else if(last.close<lower)zone='BELOW_LOW_BB';
  else if(nearB(last.high,upper)||nearB(last.close,upper))zone='TOP_BB';
  else if(nearB(last.low,lower)||nearB(last.close,lower))zone='LOW_BB';
  else if(nearB(last.close,mid)||last.low<=mid&&last.high>=mid)zone='MID_BB';
  else if(nearB(last.close,e50)||last.low<=e50&&last.high>=e50)zone='EMA50';
  /* Candle geometry (canonical lib/bbma-candle-watch.js candle{}): direction,
   * body ratio, and wick ratios — this is what the matrix LOC/EVT column shows
   * (distinct from the BB zone). */
  var body=Math.abs(last.close-last.open),range=Math.max(1e-12,last.high-last.low),bodyRatio=body/range;
  var candle={direction:dir,bodyRatio:+bodyRatio.toFixed(3),upperWick:+((last.high-Math.max(last.open,last.close))/range).toFixed(3),lowerWick:+((Math.min(last.open,last.close)-last.low)/range).toFixed(3)};
  var candleTag=candle.direction+(candle.upperWick>.45?' \u2191wick':candle.lowerWick>.45?' \u2193wick':'')+(candle.bodyRatio<.3?' \u00b7 doji':'');
  var mhv=trend==='UP'&&last.high<upper&&last.close>mid&&zone!=='ABOVE_TOP_BB'?'VALID_MHV':'NONE';
  /* csak + reentry: EXACT canonical lib/bbma-engine.js formulas (the old
   * runtime revision used weaker variants — a close>ma5High alone, and reentry
   * without the ma5Low/ma5High guard — so the app and CI disagreed). */
  var csak=dir==='UP'&&last.close>m5h&&last.close>m10h&&last.close>mid?'CSAK_UP':dir==='DOWN'&&last.close<m5l&&last.close<m10l&&last.close<mid?'CSAK_DOWN':'NONE';
  var re='NONE';
  if(trend==='UP'&&last.low<=Math.max(m5l,m10l)&&last.close>mid&&last.close>m5l)re='REENTRY_UP_ZONE';
  if(trend==='DOWN'&&last.high>=Math.min(m5h,m10h)&&last.close<mid&&last.close<m5h)re='REENTRY_DOWN_ZONE';
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
    mhv:mhv,
    zone:zone,
    candle:candle,
    candleEvent:candleTag,
    location:candleTag, /* matrix LOC/EVT column: candle direction + wick event (zone is the BB state) */
    tolerance:tol,
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
    event:null,
    backfill:{
      at:_backfill.at||null,
      lastPrice:_backfill.lastPrice!=null?_backfill.lastPrice.toFixed(2):null,
      tfs:_backfill.tfs,
      errors:_backfill.errors
    }
  };

  Object.keys(frames).forEach(function(tf){out.frames[tf]=classify(frames[tf]);});
  out.mtf=out.frames;
  out.timeframes=out.frames;
  /* Derived technical monitoring signals (real readings only). Kept SEPARATE
   * from out.alerts: publishability (send-bbma-telegram.js) depends on
   * out.alerts, which stays externally-supplied only. */
  out.techAlerts=technicalAlerts(out.frames);
  /* Canonical feed state + metrics (single derivation; UI only renders). */
  var _lastMs=_lastTickTimeMs();
  var _tickAge=_lastMs!=null?Math.max(0,now-_lastMs):null;
  var _bfActive=!!_backfillPromise&&_backfill.at==null;
  var _bfDone=_backfill.at!=null; /* backfill ran and finished (may be empty) */
  var _feedState;
  if(_tickAge==null){
    if(_bfActive){_feedState='BACKFILL';}
    else if(_bfDone&&_backfill.liveOverride!==true){_feedState='BACKFILL';} /* history loaded, still no live tick */
    else{_feedState=_feed.connected?'CONNECTING':'DEGRADED';}
  }else{
    if(_tickAge<=FRESH_WINDOW_MS){_feedState='LIVE';}
    else if(_tickAge<=STALE_AFTER_MS){_feedState='DEGRADED';}
    else if(_feed.connected){_feedState='RECONNECTING';}
    else{_feedState='BACKFILL';}
  }
  out.feed={
    state:_feedState,
    provider:_feed.provider||(hasTicks?'none':'—'),
    connected:_feed.connected,
    lastTickAt:_feed.lastTickAt||null,
    latencyMs:_tickAge,
    tickCount:_feed.tickCount,
    reconnectCount:_feed.reconnectCount,
    droppedTicks:_feed.droppedTicks,
    outOfOrderTicks:_feed.outOfOrderTicks,
    gapDetected:_feed.gapDetected,
    backfillRequired:!hasTicks
  };

  var w=typeof window!=='undefined'?window:globalThis;
  w.BBMA_RUNTIME=out;
  w.BBMA_DASHBOARD=out;
  try{if(typeof w.dispatchEvent==='function')w.dispatchEvent(new CustomEvent('bbma-runtime-updated',{detail:out}));}catch(e){}
}

function ingest(p,at,provider){
  p=Number(p);
  if(!isFinite(p)||p<=0)return;
  var t=at?new Date(at).getTime():Date.now();
  if(!isFinite(t))t=Date.now();
  var now=Date.now();
  var _prevMs=_lastTickTimeMs();
  if(_prevMs!=null&&t<_prevMs-1500){_feed.outOfOrderTicks++;} /* >1.5s behind last accepted */
  /* Reject out-of-window ticks (clock skew / stale poller / a device clock
   * running ahead) so an old or impossible price can never move a candle. */
  if(t<now-60*1000||t>now+5*60*1000){_feed.droppedTicks++;publish();return;} /* surface the drop; state recomputes from the last ACCEPTED tick */
  lastPrice=p;
  lastAt=new Date(t).toISOString();
  _feed.lastTickAt=lastAt;
  _feed.tickCount++;
  if(provider){_feed.provider=provider;}
  /* M1 gap detection: a completed 1-minute bucket skipped by this tick. */
  if(_prevMs!=null){
    var prevBucket=Math.floor(_prevMs/60000)*60000;
    var curBucket=Math.floor(t/60000)*60000;
    if(curBucket-prevBucket>60000){_feed.gapDetected=true;}
  }
  /* First real tick: the backfill is done (live data wins from here on). */
  _backfill.liveOverride=true;
  Object.keys(TFS).forEach(function(tf){add(tf,p,t);});
  publish();
}

/* Feed transport status is reported by LiveFeed (REST poll + WS) — the runtime
 * only stores it; the feed STATE (CONNECTING/LIVE/…) is derived in publish()
 * from tick age + this, so two sources can never disagree about liveness. */
function setFeedStatus(state,message){
  var up=(state==='live'||state==='streaming'||state==='connecting');
  if(up&&!_feed.connected){_feed.reconnectCount++;} /* offline->up transition */
  _feed.connected=up;
  if(state==='streaming'&&!_feed.provider){_feed.provider='stream';}
  if(state==='live'&&!_feed.provider){_feed.provider='poll';}
  publish();
}

function setAlerts(alerts,history){
  _externalAlerts=Array.isArray(alerts)?alerts:[];
  _externalAlertHistory=Array.isArray(history)?history:[];
  publish();
}

/* LIVE technical alerts derived from the current REAL MTF readings (the same
 * canonical classifier the CI watch runs). These are monitoring signals shown
 * in the dashboard ALERT OBSERVATION / LIVE BBMA ALERTS panels — NOT external
 * validated evidence: publishability still requires BBMARuntime.setAlerts()
 * from an external source (HELIX core / news-shadow pipeline) plus fresh ticks. */
/* Canonical BBMASignal schema version — bumped on any classification change so
 * a chart marker can be audited against the engine version that produced it. */
var BBMA_SIGNAL_VERSION='v1';
/* Wrap a technical reading in a provenance envelope (spec /calculate):
 *   { id, symbol, timeframe, candleId, candleTime, pattern, direction, status,
 *     evidence[], calculatedAt, source, version }
 * The envelope carries the EXACT candle + indicator values that triggered the
 * signal, so a chart marker is auditable — the UI never re-derives the logic. */
function withProvenance(sig,framesObj,tf){
  /* framesObj[tf] is the CANONICAL classify() RESULT for that TF:
  * { state, trend, momentum, extreme, csak, reentry, zone, band, values,
  *   lastTime, ... }. We read the exact trigger values from there so the
  *   marker is auditable and the UI never re-derives anything. */
  var fr=framesObj[tf]||{};
  var v=fr.values||null;
  var lastTime=fr.lastTime||null;
  function ev(name,value){return {name:name,value:value==null?null:(Math.round(value*100)/100)};}
  var evidence=[];
  if(v){
    evidence.push(ev('close',v.close),ev('bbUpper',v.bb&&v.bb.upper),ev('bbMid',v.bb&&v.bb.mid),ev('bbLower',v.bb&&v.bb.lower),ev('ema50',v.ema50));
    if(sig.pattern==='MOMENTUM')evidence.push(ev('momentum',fr.momentum));
    if(sig.pattern==='EXTREME')evidence.push(ev('ma5High',v.ma5High),ev('ma5Low',v.ma5Low));
    if(sig.pattern==='RE-ENTRY')evidence.push(ev('ma5High',v.ma5High),ev('ma10High',v.ma10High),ev('ma5Low',v.ma5Low),ev('ma10Low',v.ma10Low),ev('trend',fr.trend));
    if(sig.pattern==='CSA')evidence.push(ev('ma5High',v.ma5High),ev('ma10High',v.ma10High),ev('ma5Low',v.ma5Low),ev('ma10Low',v.ma10Low));
  }
  sig.candleId=lastTime;
  sig.candleTime=lastTime;
  sig.status=fr.state==='READY'?'READY':'INSUFFICIENT';
  /* Direction comes from the CANONICAL frame reading, not the signal id:
     momentum -> its UP/DOWN; CSA/reentry -> their UP/DOWN zone; otherwise the
     TF trend. This keeps the marker direction == the engine's. */
  var dir='NEUTRAL';
  if(sig.pattern==='MOMENTUM')dir=/UP/.test(fr.momentum||'')?'UP':/DOWN/.test(fr.momentum||'')?'DOWN':'NEUTRAL';
  else if(sig.pattern==='CSA')dir=/UP/.test(fr.csak||'')?'UP':/DOWN/.test(fr.csak||'')?'DOWN':'NEUTRAL';
  else if(sig.pattern==='RE-ENTRY')dir=/UP/.test(fr.reentry||'')?'UP':/DOWN/.test(fr.reentry||'')?'DOWN':'NEUTRAL';
  else if(sig.pattern==='EXTREME')dir=/HIGH/.test(fr.extreme||'')?'UP':/LOW/.test(fr.extreme||'')?'DOWN':'NEUTRAL';
  else dir=(fr.trend==='UP')?'UP':(fr.trend==='DOWN')?'DOWN':'NEUTRAL';
  sig.direction=dir;
  sig.evidence=evidence;
  sig.calculatedAt=new Date().toISOString();
  sig.source='LIVE_TICK_DERIVED';
  sig.version=BBMA_SIGNAL_VERSION;
  return sig;
}
function technicalAlerts(framesObj){
  var out=[];
  var P1=['H1','M15','H4'],P2=['M5','M30','D1'];
  var seen={};
  function push(id,level,tf,pattern,summary){
    if(seen[id])return;seen[id]=1;
    var sig={id:'tech-'+id,symbol:'XAU/USD',timeframe:tf,pattern:pattern,level:level,timeMYT:framesObj[tf]&&framesObj[tf].lastTime?new Date(Date.parse(framesObj[tf].lastTime)+8*3600000).toISOString().slice(11,16)+' MYT':'—',summary:summary,technical:true};
    withProvenance(sig,framesObj,tf);
    out.push(sig);
  }
  function scan(list,level,tfOrder){
    list.forEach(function(tf){
      var x=framesObj[tf];if(!x||x.state!=='READY')return;
      if(x.momentum==='MOMENTUM_UP')push('mom_up_'+tf,level,tf,'MOMENTUM','Momentum: close beyond the upper BB(20,2) band — extended move; chase risk.');
      if(x.momentum==='MOMENTUM_DOWN')push('mom_dn_'+tf,level,tf,'MOMENTUM','Momentum: close beyond the lower BB(20,2) band — extended move; fade risk.');
      if(x.extreme==='EXTREME_HIGH')push('ext_hi_'+tf,level,tf,'EXTREME','Extreme: LWMA-5 of highs printed above the upper band.');
      if(x.extreme==='EXTREME_LOW')push('ext_lo_'+tf,level,tf,'EXTREME','Extreme: LWMA-5 of lows printed below the lower band.');
      if(x.reentry==='REENTRY_UP_ZONE')push('re_up_'+tf,level,tf,'RE-ENTRY','Re-entry zone (UP): pullback into LWMA support while trend is up.');
      if(x.reentry==='REENTRY_DOWN_ZONE')push('re_dn_'+tf,level,tf,'RE-ENTRY','Re-entry zone (DOWN): push into LWMA resistance while trend is down.');
      if(x.csak==='CSAK_UP')push('csak_up_'+tf,level,tf,'CSA','CSA up: strong bullish close beyond the 5- and 10-bar high and above the mid band.');
      if(x.csak==='CSAK_DOWN')push('csak_dn_'+tf,level,tf,'CSA','CSA down: strong bearish close beyond the 5- and 10-bar low and below the mid band.');
    });
  }
  scan(P1,'HIGH');scan(P2,'MEDIUM');
  var order={HIGH:0,MEDIUM:1,LOW:2};
  out.sort(function(a,b){return order[a.level]-order[b.level];});
  return out.slice(0,8);
}

var w=typeof window!=='undefined'?window:globalThis;
w.BBMARuntime={
  ingest:ingest,
  setFeedStatus:setFeedStatus,
  setAlerts:setAlerts,
  withProvenance:withProvenance,
  SIGNAL_VERSION:BBMA_SIGNAL_VERSION,
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
/* Browser only: start the cold-load history backfill (real Twelve Data bars)
 * after the initial empty publish. No-op in Node (no fetch) and no-op when the
 * key/host is not configured. */
if(typeof w.addEventListener==='function'&&typeof w.fetch==='function'){
  backfillHistory().then(function(){ if(!lastPrice) publish(); }).catch(function(){ /* stays honestly empty */ });
}
})();
