'use strict';
const V=require('./ohlc-validator');
function normalizeYahooChart(payload,meta={}){
 const r=payload&&payload.chart&&payload.chart.result&&payload.chart.result[0];if(!r)throw new Error('YAHOO_EMPTY_RESULT');
 const q=r.indicators&&r.indicators.quote&&r.indicators.quote[0]||{},ts=r.timestamp||[],out=[];
 for(let i=0;i<ts.length;i++){if([q.open&&q.open[i],q.high&&q.high[i],q.low&&q.low[i],q.close&&q.close[i]].some(v=>v==null))continue;out.push(V.provenance({time:new Date(ts[i]*1000).toISOString(),open:q.open[i],high:q.high[i],low:q.low[i],close:q.close[i],volume:q.volume&&q.volume[i]},meta));}
 return out;
}
async function fetchJson(url,{timeoutMs=8000,headers={}}={}){const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeoutMs);try{const t0=Date.now(),res=await fetch(url,{headers,signal:ac.signal});if(!res.ok)throw new Error('HTTP_'+res.status);return {json:await res.json(),httpMs:Date.now()-t0};}finally{clearTimeout(timer);}}
function yahooUrl(symbol,{interval='1m',range='1d'}={}){return 'https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval='+encodeURIComponent(interval)+'&range='+encodeURIComponent(range)+'&includePrePost=true&events=div%2Csplits';}
async function yahoo(symbol,opts={}){const fetchedAt=new Date().toISOString(),u=yahooUrl(symbol,opts),r=await fetchJson(u,opts);return {provider:'YAHOO_CHART',symbol,url:u,httpMs:r.httpMs,fetchedAt,candles:normalizeYahooChart(r.json,{provider:'YAHOO_CHART',symbol,timeframe:opts.interval||'1m',fetchedAt})};}
function closeDiffPct(a,b){if(!a||!b||!a.close||!b.close)return null;return Math.abs((+a.close-+b.close)/((+a.close+ +b.close)/2))*100;}
function crossCheck(primary,fallback,{maxCloseDiffPct=.15}={}){const pa=primary&&primary.candles&&primary.candles.at(-1),fb=fallback&&fallback.candles&&fallback.candles.at(-1),diff=closeDiffPct(pa,fb);return {state:diff==null?'INSUFFICIENT_DATA':diff<=maxCloseDiffPct?'ALIGNED':'CONFLICT',closeDiffPct:diff==null?null:+diff.toFixed(4),primary:primary&&primary.provider||null,fallback:fallback&&fallback.provider||null};}
async function withFallback(primaryFn,fallbackFn){let p=null,f=null,pe=null,fe=null;try{p=await primaryFn();}catch(e){pe=String(e.message||e);}if(!p&&fallbackFn){try{f=await fallbackFn();}catch(e){fe=String(e.message||e);}}return {selected:p||f||null,primary:p,fallback:f,errors:{primary:pe,fallback:fe},degraded:!p};}
module.exports={normalizeYahooChart,fetchJson,yahooUrl,yahoo,closeDiffPct,crossCheck,withFallback};
