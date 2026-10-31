'use strict';
const assert=require('node:assert/strict');
const O=require('../lib/oanda-spot-adapter');
const {collect,unavailable}=require('../build-oanda-spot.js');
const S=require('../lib/market-signal-review');
const now=Date.UTC(2026,9,30,12,0,0),at=new Date(now-60000).toISOString();
const bid=4050.1,ask=4050.4;
const pricing={prices:[{instrument:'XAU_USD',tradeable:true,
  time:at,bids:[{price:String(bid)}],asks:[{price:String(ask)}]}]};
const duration={M1:60000,M5:300000,M15:900000,M30:1800000,H1:3600000,
  H4:14400000,D1:86400000,W1:7*86400000,MN1:30*86400000};
function frame(tf,spread=5){
 const delta=duration[tf],bars=[];
 for(let i=199;i>=0;i--){
   const t=now-(i+1)*delta,base=4050+(200-i)*.01;
   bars.push({time:new Date(t).toISOString(),complete:true,
     mid:{o:base.toFixed(3),h:(base+spread).toFixed(3),
       l:(base-spread).toFixed(3),c:(base+.5).toFixed(3)}});
 }
 bars.push({time:new Date(now).toISOString(),complete:false,
   mid:{o:'4050',h:'4055',l:'4045',c:'4050'}});
 return {instrument:'XAU_USD',granularity:O.GRANULARITY[tf],candles:bars};
}
const frames=Object.fromEntries(Object.keys(O.GRANULARITY).map(tf=>[tf,frame(tf)]));
const result=O.analyzeBroker({quotePayload:pricing,candlePayloads:frames,now});
assert.equal(result.readyCount,9);
assert.equal(result.quote.state,'READY');
assert.equal(result.quote.bid,bid);
assert.equal(result.quote.ask,ask);
assert.equal(result.timeframes.MN1.sourceInterval,'M');
assert.equal(result.timeframes.W1.sourceInterval,'W');
const buy=S.buildMultiTimeframeTargets({signal:'BUY',quote:result.quote,atrMtf:result,
  now:new Date(now).toISOString(),marketOpen:true});
assert.equal(buy.readyCount,9);
assert.equal(buy.timeframes.M1.entry,ask);
assert.equal(buy.timeframes.M1.priceSide,'ASK');
const sell=S.buildMultiTimeframeTargets({signal:'SELL',quote:result.quote,atrMtf:result,
  now:new Date(now).toISOString(),marketOpen:true});
assert.equal(sell.timeframes.M1.entry,bid);
assert.equal(sell.timeframes.M1.priceSide,'BID');
assert(sell.timeframes.M1.tp1<bid);
assert(buy.timeframes.M1.tp1>ask);
assert.equal(O.quoteFromPricing({prices:[{...pricing.prices[0],tradeable:false,status:'non-tradeable'}]},{now}).reason,'MARKET_CLOSED');
assert.equal(O.quoteFromPricing({prices:[{...pricing.prices[0],asks:[]}]},{now}).reason,'INVALID_BID_ASK');
assert.equal(O.quoteFromPricing({prices:[{...pricing.prices[0],time:new Date(now-900000).toISOString()}]},{now}).reason,'STALE_QUOTE');
assert.equal(O.quoteFromPricing({prices:[]},{now}).reason,'BROKER_INSTRUMENT_NOT_AVAILABLE');
assert.equal(O.frameFromCandles({...frame('M1'),instrument:'GC=F'},require('../lib/atr-mtf-engine').FRAMES[0],{now}).reason,'BROKER_RESPONSE_INSTRUMENT_MISMATCH');
const corrupt=frame('M5');corrupt.candles[3].mid.c='99999';
assert.equal(O.frameFromCandles(corrupt,require('../lib/atr-mtf-engine').FRAMES[1],{now}).reason,'CORRUPT_SOURCE_BARS');
const short=frame('M1');short.candles=short.candles.slice(-10);
assert.equal(O.frameFromCandles(short,require('../lib/atr-mtf-engine').FRAMES[0],{now}).reason,'INSUFFICIENT_CLOSED_CANDLES');
const giantSpread={...result.quote,ask:bid+20};
const rejected=S.buildMultiTimeframeTargets({signal:'SELL',quote:giantSpread,atrMtf:result,
  now:new Date(now).toISOString(),marketOpen:true});
assert.equal(rejected.timeframes.M1.reason,'SPREAD_TOO_WIDE_FOR_ATR');
const mismatch=S.buildMultiTimeframeTargets({signal:'SELL',quote:{...result.quote,source:'yahoo:GC=F'},atrMtf:result,
  now:new Date(now).toISOString(),marketOpen:true});
assert.equal(mismatch.readyCount,0);
assert.equal(mismatch.timeframes.M1.reason,'INSTRUMENT_MISMATCH');
const weekend=S.buildMultiTimeframeTargets({signal:'SELL',quote:result.quote,atrMtf:result,
  now:new Date(now+2*86400000).toISOString(),marketOpen:false});
assert.equal(weekend.readyCount,0);
const noConfig=unavailable('BROKER_CREDENTIALS_NOT_CONFIGURED','practice',now);
assert.equal(noConfig.readyCount,0);
assert.equal(noConfig.timeframes.MN1.reason,'BROKER_CREDENTIALS_NOT_CONFIGURED');
async function networkTests(){
 let hits=[];
 const client=O.createClient({token:'SAMPLE_EXAMPLE_TOKEN_NOT_REAL',accountId:'101-001-999999-001',
   fetchImpl:async(url,opts)=>{
     hits.push([url,opts.method,opts.headers.Authorization]);
     return {ok:true,json:async()=>url.includes('/pricing?')?pricing:frame('M15')};
   }});
 await client.pricing();await client.candles('M15');
 assert.equal(hits.length,2);
 assert(hits.every(x=>x[0].startsWith('https://api-fxpractice.oanda.com/')));
 assert(hits.every(x=>x[1]==='GET'));
 assert(hits.every(x=>x[2].startsWith('Bearer ')));
 assert.throws(()=>O.createClient({token:'bad',accountId:'?'}),/BROKER_CREDENTIALS/);
 const disabled=await collect({env:{},now});
 assert.equal(disabled.state,'UNCONFIGURED');
 assert.equal(disabled.readyCount,0);
 assert.equal(disabled.quote.reason,'BROKER_CREDENTIALS_NOT_CONFIGURED');
 // The input bearer token/account is never serialized to the browser dataset.
 assert(!JSON.stringify(result).includes('SAMPLE_EXAMPLE_TOKEN_NOT_REAL'));
 console.log('OANDA nine-timeframe read-only adapter tests passed');
}
networkTests().catch(e=>{console.error(e);process.exitCode=1;});
