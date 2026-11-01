/* BBMA runtime bridge: validated XAU ticks -> rolling OHLC -> BBMA MTF context. */
(function(){'use strict';
var TFS={M5:300000,M15:900000,M30:1800000,H1:3600000,H4:14400000,D1:86400000,W1:604800000,MN1:2592000000};
var frames={},lastPrice=null,lastAt=null,max=240;

function bucket(t,ms){return Math.floor(t/ms)*ms;}

// Generate baseline candles so chart, MTF matrix, and BBMA indicators populate immediately on startup
var now=Date.now(),basePrice=2658.50;
Object.keys(TFS).forEach(function(tf){
  frames[tf]=[];
  var stepMs=TFS[tf];
  for(var i=59;i>=0;i--){
    var ct=now-i*stepMs;
    var dev=(Math.sin(i*0.35)+Math.cos(i*0.18))*(tf==='D1'||tf==='H4'?12:3.5);
    var o=basePrice+dev-0.4;
    var c=basePrice+dev+(i%2===0?0.9:-0.7);
    var h=Math.max(o,c)+1.3;
    var l=Math.min(o,c)-1.2;
    var b=bucket(ct,stepMs);
    frames[tf].push({_b:b,time:new Date(ct).toISOString(),open:o,high:h,low:l,close:c,source:'BASELINE_CACHE'});
  }
});
// Demo OHLC may be used for chart layout, never as a live quote.
lastPrice=null;
lastAt=null;

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
    price:lastPrice?lastPrice.toFixed(2):null,
    last:lastPrice?lastPrice.toFixed(2):null,
    at:lastAt||null,
    updatedMYT:mytTime,
    alertState:'UNVERIFIED',
    fresh:false,
    freshness:lastAt?'UNVERIFIED_BROWSER_TICK':'DEMO_BASELINE',
    source:lastAt?'UNVERIFIED_BROWSER_TICK':'BASELINE_CACHE',
    ohlc:frames,
    candles:frames,
    frames:{},
    // Do not fabricate a validated setup, history, or macro event.
    alerts:[],
    alertHistory:[],
    event:null
  };

  Object.keys(frames).forEach(function(tf){
    var info=classify(frames[tf]);
    // Mixed synthetic baseline and browser events cannot authenticate a BBMA setup.
    info.state=lastAt?'UNVERIFIED_BROWSER_TICK':'DEMO_ONLY';
    info.trend='—';info.momentum='—';info.reentry='—';info.csa='—';info.csak='—';
    info.mhv='—';info.extreme='—';
    out.frames[tf]=info;
  });
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
  lastPrice=p;
  lastAt=new Date(t).toISOString();
  Object.keys(TFS).forEach(function(tf){add(tf,p,t);});
  publish();
}

window.BBMARuntime={ingest:ingest,snapshot:function(){return window.BBMA_RUNTIME||null;},frames:frames};
window.addEventListener('xau-live-tick',function(e){var d=e.detail||{};ingest(d.price,d.at);});

setInterval(function(){
  try{
    if(!window.LiveFeed||!window.LiveFeed.snapshot)return;
    var s=window.LiveFeed.snapshot(),p=s&&s.metals&&(s.metals.XAU||s.metals['XAU/USD']);
    if(p&&p!==lastPrice)ingest(p,new Date());
  }catch(e){}
},2000);

publish();
})();
