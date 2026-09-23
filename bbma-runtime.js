/* BBMA runtime bridge: converts validated XAU live ticks into rolling OHLC,
 * derives M5..MN1 frames, calculates BBMA context, and notifies the dashboard.
 * Tick-built candles are clearly tagged as runtime-derived; no signal is fabricated
 * until enough candles exist for the requested calculation.
 */
(function(){'use strict';
var TFS={M5:300000,M15:900000,M30:1800000,H1:3600000,H4:14400000,D1:86400000,W1:604800000,MN1:2592000000};
var frames={}, lastPrice=null, lastAt=null, max=240;
Object.keys(TFS).forEach(function(tf){frames[tf]=[];});
function bucket(t,ms){return Math.floor(t/ms)*ms;}
function add(tf,p,t){var a=frames[tf],b=bucket(t,TFS[tf]),c=a[a.length-1];if(!c||c._b!==b){c={_b:b,time:new Date(b).toISOString(),open:p,high:p,low:p,close:p,source:'LIVE_TICK_DERIVED'};a.push(c);if(a.length>max)a.shift();}else{c.high=Math.max(c.high,p);c.low=Math.min(c.low,p);c.close=p;}}
function sma(a,n){if(a.length<n)return null;return a.slice(-n).reduce(function(s,v){return s+v;},0)/n;}
function ema(a,n){if(a.length<n)return null;var k=2/(n+1),e=a.slice(0,n).reduce(function(s,v){return s+v;},0)/n;for(var i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
function lwma(a,n){if(a.length<n)return null;var x=a.slice(-n),d=n*(n+1)/2;return x.reduce(function(s,v,i){return s+v*(i+1);},0)/d;}
function classify(a){if(!a||a.length<50)return {state:'INSUFFICIENT_DATA',candles:a?a.length:0};var closes=a.map(function(x){return x.close;}), highs=a.map(function(x){return x.high;}), lows=a.map(function(x){return x.low;}),mid=sma(closes,20),sq=a.slice(-20).reduce(function(s,x){return s+Math.pow(x.close-mid,2);},0)/20,sd=Math.sqrt(sq),upper=mid+2*sd,lower=mid-2*sd,e50=ema(closes,50),m5h=lwma(highs,5),m10h=lwma(highs,10),m5l=lwma(lows,5),m10l=lwma(lows,10),last=a[a.length-1],trend=last.close>mid&&last.close>e50?'UP':last.close<mid&&last.close<e50?'DOWN':'MIXED',momentum=last.close>upper?'MOMENTUM_UP':last.close<lower?'MOMENTUM_DOWN':'NONE',extreme=m5h>upper?'EXTREME_HIGH':m5l<lower?'EXTREME_LOW':'NONE',dir=last.close>last.open?'UP':last.close<last.open?'DOWN':'FLAT',csa=dir==='UP'&&last.close>m5h&&last.close>m10h&&last.close>mid?'CSAK_UP':dir==='DOWN'&&last.close<m5l&&last.close<m10l&&last.close<mid?'CSAK_DOWN':'NONE',re='NONE';if(trend==='UP'&&last.low<=Math.max(m5l,m10l)&&last.close>mid&&last.close>m5l)re='REENTRY_UP_ZONE';if(trend==='DOWN'&&last.high>=Math.min(m5h,m10h)&&last.close<mid&&last.close<m5h)re='REENTRY_DOWN_ZONE';return {state:'READY',trend:trend,momentum:momentum,extreme:extreme,csak:csa,csa:csa,reentry:re,bb:{upper:upper,mid:mid,lower:lower},ema50:e50,close:last.close,lastTime:last.time,candles:a.length};}
function publish(){var out={symbol:'XAU/USD',price:lastPrice,at:lastAt,source:'LIVE_TICK_DERIVED',ohlc:frames,frames:{}};Object.keys(frames).forEach(function(tf){out.frames[tf]=classify(frames[tf]);});window.BBMA_RUNTIME=out;window.BBMA_DASHBOARD=out;try{window.dispatchEvent(new CustomEvent('bbma-runtime-updated',{detail:out}));}catch(e){} }
function ingest(p,at){p=Number(p);if(!isFinite(p)||p<=0)return;var t=at?new Date(at).getTime():Date.now();if(!isFinite(t))t=Date.now();lastPrice=p;lastAt=new Date(t).toISOString();Object.keys(TFS).forEach(function(tf){add(tf,p,t);});publish();}
window.BBMARuntime={ingest:ingest,snapshot:function(){return window.BBMA_RUNTIME||null;},frames:frames};
window.addEventListener('xau-live-tick',function(e){var d=e.detail||{};ingest(d.price,d.at);});
/* Bridge existing LiveFeed without replacing app callbacks: poll its public history snapshot. */
setInterval(function(){try{if(!window.LiveFeed||!window.LiveFeed.snapshot)return;var s=window.LiveFeed.snapshot(),p=s&&s.metals&&(s.metals.XAU||s.metals['XAU/USD']);if(p&&p!==lastPrice)ingest(p,new Date());}catch(e){}},2000);
publish();
})();
