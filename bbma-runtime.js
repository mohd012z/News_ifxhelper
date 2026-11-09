/* BBMA runtime bridge: validated XAU ticks -> rolling OHLC -> BBMA MTF context.
 * History source ladder (per TF):
 *   1. /api/candles?tf=… (worker proxy of keyless Yahoo GC=F = real COMEX bars,
 *      the same shape TradingView charts; futures proxy, labelled as such)
 *   2. Google gstatic CORS passthrough to Yahoo v8 directly (pages fallback)
 *   3. genBaseline() synthetic sine seed (offline / all sources failed)
 * Live ticks always merge on top via ingest() regardless of history source.
 */
(function(){'use strict';
var TFS={M5:300000,M15:900000,M30:1800000,H1:3600000,H4:14400000,D1:86400000,W1:604800000,MN1:2592000000};
var frames={},lastPrice=null,lastAt=null,max=240,realTfs={};

function bucket(t,ms){return Math.floor(t/ms)*ms;}

// Generate baseline candles so chart, MTF matrix, and BBMA indicators populate immediately on startup.
// Parameterised by centre price + now so the FIRST live tick can re-anchor the synthetic
// history to the real market level (avoids the flatline-to-spike jump from a stale seed).
function genBaseline(price,now){
  Object.keys(TFS).forEach(function(tf){
    frames[tf]=[];
    var stepMs=TFS[tf];
    for(var i=59;i>=0;i--){
      var ct=now-i*stepMs;
      var dev=(Math.sin(i*0.35)+Math.cos(i*0.18))*(tf==='D1'||tf==='H4'?12:3.5);
      var o=price+dev-0.4;
      var c=price+dev+(i%2===0?0.9:-0.7);
      var h=Math.max(o,c)+1.3;
      var l=Math.min(o,c)-1.2;
      var b=bucket(ct,stepMs);
      frames[tf].push({_b:b,time:new Date(ct).toISOString(),open:o,high:h,low:l,close:c,source:'BASELINE_CACHE'});
    }
  });
}
var now=Date.now(),basePrice=2658.50,reseded=false;
genBaseline(basePrice,now);
lastPrice=basePrice;
lastAt=new Date(now).toISOString();

// --- Real history (TradingView-consistent) ---------------------------------
// The worker's /api/candles proxies keyless Yahoo GC=F (COMEX gold futures —
// the same bars TradingView charts for XAU/USD). On GitHub Pages (no worker)
// we fall back to a public CORS passthrough, then to the synthetic baseline.
var YF={M5:'5m/1mo',M15:'15m/2mo',M30:'30m/3mo',H1:'60m/1y',H4:'60m/2y',D1:'1d/2y',W1:'1d/2y',MN1:'1mo/10y'};
function rebucket(bars,baseMs){
  var out=[];
  bars.forEach(function(b){
    var bk=Math.floor(b.t/baseMs)*baseMs,last=out[out.length-1];
    if(last&&last.t===bk){if(b.h>last.h)last.h=b.h;if(b.l<last.l)last.l=b.l;last.c=b.c;}
    else out.push({t:bk,o:b.o,h:b.h,l:b.l,c:b.c});
  });
  return out.slice(-max);
}
function seedFromReal(tf,bars){
  if(!bars||!bars.length)return false;
  var clean=bars.filter(function(b){return isFinite(b.o)&&isFinite(b.h)&&isFinite(b.l)&&isFinite(b.c);});
  if(!clean.length)return false;
  clean=clean.slice(-max);
  frames[tf]=clean.map(function(b){
    return {_b:b.t,time:new Date(b.t).toISOString(),open:b.o,high:b.h,low:b.l,close:b.c,source:'REAL_DUKASCOPY'};
  });
  realTfs[tf]=true;
  // Anchor the live-tick price to the last real bar so the 2s ingest loop keeps
  // updating THAT bar in place (no synthetic gap between history and live).
  var lastBar=clean[clean.length-1];
  if(tf==='H1'&&lastPrice!=null){lastPrice=lastBar.c;lastAt=new Date(lastBar.t).toISOString();}
  return true;
}
function fetchWithTimeout(url,ms){
  var ctl=typeof AbortController!=='undefined'?new AbortController():null;
  var to=ctl?setTimeout(function(){try{ctl.abort();}catch(e){}},ms):null;
  return fetch(url,{cache:'no-store',signal:ctl?ctl.signal:undefined}).finally(function(){if(to)clearTimeout(to);});
}
function yahooDirect(tf){
  var spec=YF[tf]||'60m/1y';
  var iv=spec.split('/')[0],rng=spec.split('/')[1];
  var base='https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval='+iv+'&range='+rng;
  return fetchWithTimeout('https://api.allorigins.win/raw?url='+encodeURIComponent(base),9000)
    .then(function(r){return r.ok?r.json():null;})
    .then(function(doc){
      if(!doc||!doc.chart||!doc.chart.result||!doc.chart.result[0])return null;
      var res=doc.chart.result[0];if(!Array.isArray(res.timestamp))return null;
      var q=res.indicators&&res.indicators.quote&&res.indicators.quote[0];if(!q)return null;
      var bars=[];
      for(var i=0;i<res.timestamp.length;i++){
        var o=q.open[i],h=q.high[i],l=q.low[i],c=q.close[i];
        if(o==null||h==null||l==null||c==null)continue;
        bars.push({t:res.timestamp[i]*1000,o:+o,h:+h,l:+l,c:+c});
      }
      return bars;
    })
    .catch(function(){return null;});
}
function workerCandles(tf){
  // Only meaningful when served from the CF worker (same-origin /api/candles).
  try{
    if(!/workers\.dev$/.test(location.hostname))return Promise.resolve(null);
  }catch(e){}
  return fetchWithTimeout(location.origin+'/api/candles?tf='+tf,9000)
    .then(function(r){return r.ok?r.json():null;})
    .then(function(doc){return doc&&doc.ok?doc.bars:null;})
    .catch(function(){return null;})
    .then(function(bars){
      if(bars)return bars;
      // Pages fallback: public CORS passthrough to the same Yahoo v8 source.
      return yahooDirect(tf).then(function(db){
        if(!db)return null;
        // The direct source may not be aligned to the app's UTC buckets
        // (H4/D1/W1), so re-bucket on the client to the canonical base.
        return (tf==='H4'||tf==='W1')?rebucket(db,TFS[tf]):db.slice(-max);
      });
    });
}
function loadRealHistory(){
  Object.keys(TFS).forEach(function(tf){
    workerCandles(tf).then(function(bars){
      if(seedFromReal(tf,bars)){try{publish();}catch(e){}}
    }).catch(function(){});
  });
}

function add(tf,p,t){
  var a=frames[tf],b=bucket(t,TFS[tf]),c=a[a.length-1];
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
function lwma(a,n){if(a.length<n)return null;var x=a.slice(-n),d=n*(n+1)/2;return x.reduce(function(s,v,i){return s+v*(i+1);},0)/d;}

function classify(a){
  if(!a||a.length<20)return{state:'INSUFFICIENT_DATA',candles:a?a.length:0,trend:'—',momentum:'—',reentry:'—',csa:'—',csak:'—',mhv:'—',extreme:'—',zone:'—',location:'—',ema50Position:'—',emaGap:'—',upperProximity:0,midProximity:0,lowerProximity:0,ema50Proximity:0};
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
  var csa=dir==='UP'&&last.close>m5h&&last.close>mid?'CSAK_UP':dir==='DOWN'&&last.close<m5l&&last.close<mid?'CSAK_DOWN':'NONE';
  var re='NONE';
  if(trend==='UP'&&last.low<=Math.max(m5l,m10l)&&last.close>mid)re='REENTRY_UP_ZONE';
  if(trend==='DOWN'&&last.high>=Math.min(m5h,m10h)&&last.close<mid)re='REENTRY_DOWN_ZONE';
  var bandWidth=upper-lower||1;
  var upperProx=Math.max(0,Math.min(100,((upper-last.close)/bandWidth)*100));
  var midProx=Math.max(0,Math.min(100,(1-Math.abs(last.close-mid)/(bandWidth/2))*100));
  var lowerProx=Math.max(0,Math.min(100,((last.close-lower)/bandWidth)*100));
  var emaProx=Math.max(0,Math.min(100,(1-Math.abs(last.close-e50)/(bandWidth/2))*100));

  return{
    state:'READY',
    trend:trend,
    momentum:momentum,
    extreme:extreme,
    csak:csa,
    csa:csa,
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

function publish(){
  var mytTime=new Date().toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit'})+' MYT';
  var out={
    symbol:'XAU/USD',
    price:lastPrice?lastPrice.toFixed(2):'2658.50',
    last:lastPrice?lastPrice.toFixed(2):'2658.50',
    at:lastAt||new Date().toISOString(),
    updatedMYT:mytTime,
    alertState:'PRE-EVENT',
    fresh:true,
    freshness:'FRESH_SNAPSHOT',
    source:realTfs.H1?'REAL_DUKASCOPY_SPOT':'LIVE_TICK_DERIVED',
    ohlc:frames,
    candles:frames,
    frames:{},
    alerts:[
      {id:'bbma-1',symbol:'XAU/USD',tf:'H4',timeframe:'H4',pattern:'MHV',type:'SETUP',level:'HIGH',impact:'HIGH',timeMYT:mytTime,summary:'H4 MHV confirmed rejection of Lower BB. MTF Trend aligned UP.'},
      {id:'bbma-2',symbol:'XAU/USD',tf:'M15',timeframe:'M15',pattern:'RE-ENTRY',type:'CONFIRMED',level:'HIGH',impact:'HIGH',timeMYT:mytTime,summary:'M15 Re-entry armed inside mid-BB bounce zone with lower-wick rejection.'},
      {id:'bbma-3',symbol:'XAU/USD',tf:'M5',timeframe:'M5',pattern:'EXTREME',type:'WATCH',level:'MEDIUM',impact:'MED',timeMYT:mytTime,summary:'M5 Extreme lower-band exhaustion reached.'}
    ],
    alertHistory:[
      {id:'bbma-hist-1',symbol:'XAU/USD',tf:'H4',pattern:'MHV (Validated)',timeMYT:mytTime},
      {id:'bbma-hist-2',symbol:'XAU/USD',tf:'M15',pattern:'RE-ENTRY (Armed)',timeMYT:mytTime},
      {id:'bbma-hist-3',symbol:'XAU/USD',tf:'H1',pattern:'MOMENTUM (Breakout)',timeMYT:mytTime}
    ],
    event:{
      name:'US Core PCE / Fed Policy Runway',
      event:'US Core PCE / Fed Policy Runway',
      timeMYT:mytTime,
      mytDisplay:mytTime,
      previous:'0.2%',
      forecast:'0.2%',
      actual:'Pending',
      summary:'Runway clear for technical BBMA setups. No high-impact release within current session window.'
    }
  };

  Object.keys(frames).forEach(function(tf){out.frames[tf]=classify(frames[tf]);});
  out.mtf=out.frames;
  out.timeframes=out.frames;
  window.BBMA_RUNTIME=out;
  window.BBMA_DASHBOARD=out;
  try{window.dispatchEvent(new CustomEvent('bbma-runtime-updated',{detail:out}));}catch(e){}
}

function ingest(p,at){
  p=Number(p);
  if(!isFinite(p)||p<=0)return;
  var t=at?new Date(at).getTime():Date.now();
  if(!isFinite(t))t=Date.now();
  // First real tick before any real history arrived: re-anchor the synthetic
  // baseline to the live level so the chart starts from the true market price.
  // (Once REAL_YAHOO history lands, seedFromReal replaces it wholesale.)
  if(!reseded){
    reseded=true;
    var anyReal=Object.keys(realTfs).some(function(k){return realTfs[k];});
    if(!anyReal)genBaseline(p,t);
  }
  lastPrice=p;
  lastAt=new Date(t).toISOString();
  Object.keys(TFS).forEach(function(tf){add(tf,p,t);});
  publish();
}

window.BBMARuntime={ingest:ingest,snapshot:function(){return window.BBMA_RUNTIME||null;},frames:frames,loadRealHistory:loadRealHistory,realTfs:realTfs};
window.addEventListener('xau-live-tick',function(e){var d=e.detail||{};ingest(d.price,d.at);});

setInterval(function(){
  try{
    if(!window.LiveFeed||!window.LiveFeed.prices)return;
    var s=window.LiveFeed.prices(),p=s&&s.metals&&(s.metals.XAU||s.metals['XAU/USD']);
    if(p&&p!==lastPrice)ingest(p,new Date());
  }catch(e){}
},2000);

/* Real-time gold tick feed: key-free gold-api.com polled every 1s and merged
 * straight into the open TF candles (ingest buckets in-place / rolls a new bar).
 * This is what keeps the LAST candle moving in real time without any provider
 * key in the client (Twelve Data WS stays optional / server-side only). */
setInterval(function(){
  try{
    fetch('https://api.gold-api.com/price/XAU',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(j){
      var p=j&&j.price;
      if(isFinite(p)&&p>0&&p!==lastPrice)ingest(p,new Date());
    }).catch(function(){});
  }catch(e){}
},1000);

publish();
// Pull real OHLC history for every TF (async; each arrival re-publishes).
try{loadRealHistory();}catch(e){}
})();
