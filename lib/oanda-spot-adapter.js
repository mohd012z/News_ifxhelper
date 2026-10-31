'use strict';
/* Read-only OANDA v20 XAU_USD provider. Never stores credentials or sends orders.
 * Direct broker candle granularities preserve provider-aligned W1/MN1 boundaries.
 */
const {FRAMES,wilderATR}=require('./atr-mtf-engine');
const HOSTS=Object.freeze({practice:'https://api-fxpractice.oanda.com',live:'https://api-fxtrade.oanda.com'});
const GRANULARITY=Object.freeze({M1:'M1',M5:'M5',M15:'M15',M30:'M30',H1:'H1',H4:'H4',D1:'D',W1:'W',MN1:'M'});
const SYMBOL='XAU_USD', DISPLAY='XAU/USD';
const pos=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
const iso=v=>{if(typeof v!=='string')return null;let ms=Date.parse(v);return Number.isFinite(ms)?new Date(ms).toISOString():null;};
function errorCode(e) {
 const s=String(e&&e.message||e);
 return /^HTTP_(400|401|403|404|405|429|5\d\d)$/.test(s)||['REQUEST_TIMEOUT','INVALID_RESPONSE'].includes(s)?s:'BROKER_REQUEST_FAILED';
}
function quoteFromPricing(payload,{now=Date.now(),environment='practice'}={}){
 const x=(payload&&Array.isArray(payload.prices)?payload.prices:[]).find(p=>p.instrument===SYMBOL);
 if(!x)return {state:'UNAVAILABLE',reason:'BROKER_INSTRUMENT_NOT_AVAILABLE'};
 if(x.tradeable!==true&&x.status!=='tradeable')return {state:'UNAVAILABLE',reason:'MARKET_CLOSED'};
 const bid=pos(x.bids&&x.bids[0]&&x.bids[0].price),ask=pos(x.asks&&x.asks[0]&&x.asks[0].price),at=iso(x.time);
 if(bid===null||ask===null||ask<bid)return {state:'UNAVAILABLE',reason:'INVALID_BID_ASK'};
 const age=at?(now-Date.parse(at))/60000:null;
 if(age===null||age<-.5||age>5)return {state:'UNAVAILABLE',reason:'STALE_QUOTE'};
 const mid=(bid+ask)/2;
 return {state:'READY',symbol:DISPLAY,source:'oanda:'+environment+':'+SYMBOL,
   provider:'OANDA_V20',market:'BROKER_OTC_XAU_USD',marketOpen:true,
   bid,ask,price:+mid.toFixed(6),spread:+(ask-bid).toFixed(6),
   spreadPct:+((ask-bid)/mid*100).toFixed(5),marketAt:at,
   note:'Broker-specific OTC quote, indicative; not an order execution.'};
}
function frameFromCandles(payload,frame,{now=Date.now(),environment='practice'}={}){
 const base={tf:frame.tf,instrument:DISPLAY,source:'oanda:'+environment+':'+SYMBOL,
   sourceInterval:GRANULARITY[frame.tf],provider:'OANDA_V20',state:'UNAVAILABLE',
   reason:'INSUFFICIENT_CLOSED_CANDLES',atr:null,asOf:null,last:null,closedBars:0,period:14,priceComponent:'MID'};
 if(!payload||payload.instrument!==SYMBOL||payload.granularity!==GRANULARITY[frame.tf])
   return {...base,reason:'BROKER_RESPONSE_INSTRUMENT_MISMATCH'};
 if(!Array.isArray(payload.candles))return {...base,reason:'BROKER_CANDLES_MISSING'};
 const rows=[],seen=new Set();
 for(const c of payload.candles){
   if(c&&c.complete===false)continue;
   const at=iso(c&&c.time),v=c&&c.mid||{},o=pos(v.o),h=pos(v.h),l=pos(v.l),cl=pos(v.c);
   if(!at||[o,h,l,cl].some(n=>n===null)||h<l||o>h||o<l||cl>h||cl<l
      ||Date.parse(at)>now||seen.has(at))return {...base,reason:'CORRUPT_SOURCE_BARS'};
   rows.push({t:Date.parse(at),time:at,o,h,l,c:cl});seen.add(at);
 }
 rows.sort((a,b)=>a.t-b.t);
 if(rows.length<15)return {...base,closedBars:rows.length};
 const last=rows.at(-1),atr=wilderATR(rows),age=(now-last.t)/3600000;
 const reason=atr===null?'INVALID_ATR':age>frame.atrAgeHours?'STALE_CANDLES':null;
 return {...base,reason,state:reason?'UNAVAILABLE':'READY',
   atr:atr===null?null:+atr.toFixed(6),last:+last.c.toFixed(6),
   asOf:last.time,closedBars:rows.length,ageHours:+age.toFixed(2)};
}
function analyzeBroker({quotePayload,candlePayloads,environment='practice',now=Date.now(),errors={}}={}){
 const quote=quotePayload?quoteFromPricing(quotePayload,{environment,now}):
   {state:'UNAVAILABLE',reason:errors.pricing||'QUOTE_UNAVAILABLE'};
 const timeframes={};
 for(const frame of FRAMES){
   timeframes[frame.tf]=errors[frame.tf]?{
     tf:frame.tf,state:'UNAVAILABLE',reason:errors[frame.tf],instrument:DISPLAY,
     source:'oanda:'+environment+':'+SYMBOL,atr:null,asOf:null,
     sourceInterval:GRANULARITY[frame.tf]
   }:frameFromCandles(candlePayloads&&candlePayloads[frame.tf],frame,{environment,now});
 }
 const ready=Object.values(timeframes).filter(x=>x.state==='READY').length;
 return {schemaVersion:1,generatedAt:new Date(now).toISOString(),instrument:DISPLAY,
   provider:'OANDA_V20',source:'oanda:'+environment+':'+SYMBOL,
   market:'BROKER_OTC_XAU_USD',isBrokerSpot:true,notFutures:true,
   state:quote.state==='READY'?(ready===9?'READY':ready?'PARTIAL':'UNAVAILABLE'):'QUOTE_UNAVAILABLE',
   quote,readyCount:ready,total:9,timeframes,note:'Provider-native completed midpoint candles; read-only broker bid/ask quote.'};
}
function createClient({token,accountId,environment='practice',fetchImpl=global.fetch,timeoutMs=12000}={}){
 if(!HOSTS[environment])throw Error('INVALID_BROKER_ENV');
 if(typeof token!=='string'||token.length<10||!accountId||!/^[a-zA-Z0-9-]+$/.test(accountId))
   throw Error('BROKER_CREDENTIALS_MISSING_OR_INVALID');
 if(typeof fetchImpl!=='function')throw Error('FETCH_UNAVAILABLE');
 const root=HOSTS[environment]+'/v3/accounts/'+accountId;
 async function request(path){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
   try{
     const response=await fetchImpl(root+path,{method:'GET',
       headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:controller.signal});
     if(!response.ok)throw Error('HTTP_'+response.status);
     const result=await response.json();if(!result||typeof result!=='object')throw Error('INVALID_RESPONSE');
     return result;
   }catch(e){throw Error(e.name==='AbortError'?'REQUEST_TIMEOUT':errorCode(e));}
   finally{clearTimeout(timer);}
 }
 return {
   pricing:()=>request('/pricing?instruments='+SYMBOL+'&includeUnitsAvailable=false'),
   candles:tf=>{if(!GRANULARITY[tf])throw Error('UNSUPPORTED_TIMEFRAME');
     return request('/instruments/'+SYMBOL+'/candles?price=M&count=200&smooth=false'
       +'&weeklyAlignment=Monday&granularity='+GRANULARITY[tf]);}
 };
}
module.exports={SYMBOL,DISPLAY,HOSTS,GRANULARITY,quoteFromPricing,frameFromCandles,
  analyzeBroker,createClient,errorCode};
