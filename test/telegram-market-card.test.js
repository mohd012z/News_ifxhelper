'use strict';
const assert = require('node:assert/strict');
const { newsCard, resultCard } = require('../telegram-notify.js');
const {FRAMES}=require('../lib/atr-mtf-engine');

const historical={
  key:'news:gold:test',tabId:'gold',title:'U.S. dollar sees best month since June',
  impactScore:-0.12,priceAtDetect:4189.1,createdAt:'2026-09-30T21:14:42.079Z',
  checkpoints:[
    {key:'M15',dueAt:'2026-09-30T21:29:42.079Z',capturedAt:'2026-10-01T00:41:51.328Z',price:4173.4},
    {key:'MN1',dueAt:'2026-10-30T21:14:42.079Z',capturedAt:'2026-10-30T23:00:23.750Z',price:3884.9}
  ]
};
const retrospective=resultCard(historical).caption;
for(const needed of ['RESULT: OBSERVED','3884.900','-7.262%','GC=F','MN1','not predicted price %','futures'])
  assert(retrospective.includes(needed),needed);
for(const forbidden of ['undefined','~45 min later','FLAT / INCONCLUSIVE'])
  assert(!retrospective.includes(forbidden),forbidden);

const now=Date.now();
const tab={id:'gold',label:'GOLD · XAU/USD',price:{}};
const news={title:'Fresh hawkish Fed headline',impact:'bearish',signal:'SELL',
  impactPct:-0.12,tf:'Intraday',publishedAt:new Date(now-10*60000).toISOString()};
const quote={gold:{symbol:'GC=F',source:'yahoo:GC=F',price:4000,
  marketAt:new Date(now-3*60000).toISOString()}};
const maxAgesMinutes={M1:3,M5:8,M15:20,M30:30,H1:60,H4:180,D1:1200,W1:4320,MN1:28800};
const mtf={instrument:'GC=F',source:'yahoo:GC=F',market:'GOLD_FUTURES_PROXY',timeframes:{}};
FRAMES.forEach((f,i)=>{
  mtf.timeframes[f.tf]={
    tf:f.tf,state:'READY',instrument:'GC=F',source:'yahoo:GC=F',atr:(i+1)*10,
    sourceInterval:f.source,asOf:new Date(now-maxAgesMinutes[f.tf]*60000).toISOString()
  };
});
const atr={asOf:new Date(now-3600000).toISOString(),rows:[{id:'XAUUSD',atr:70,src:'yahoo:GC=F'}]};
const card=(n=news,q=quote,m=mtf)=>newsCard({},tab,n,atr,q,m).caption;
const valid=card();
assert(valid.includes('9/9 available'));
assert(valid.includes('GC=F gold FUTURES, not spot XAU/USD'));
assert(!valid.includes('Predicted move:'));
for(const tf of FRAMES.map(f=>f.tf)) assert(valid.includes(tf+' ATR14'),tf);
assert(valid.includes('M1 ATR14 10.000'));
assert(valid.includes('MN1 ATR14 90.000'));
assert(valid.includes('M1 ATR14 10.000 · SL 4012.000 · TP1 3985.000 · TP2 3975.000'));
assert(valid.includes('MN1 ATR14 90.000 · SL 4108.000 · TP1 3865.000 · TP2 3775.000'));

const missing=card(news,{});
assert(missing.includes('0/9 available'));
assert(missing.includes('M1: — QUOTE_UNAVAILABLE'));
assert(missing.includes('MN1: — QUOTE_UNAVAILABLE'));
const mismatch=card(news,{gold:{...quote.gold,symbol:'XAU/USD',source:'broker:XAU/USD'}});
assert(mismatch.includes('0/9 available'));
assert(mismatch.includes('M1: — INSTRUMENT_MISMATCH'));
const partial=structuredClone(mtf);
partial.timeframes.M1={...partial.timeframes.M1,state:'UNAVAILABLE',reason:'INSUFFICIENT_CLOSED_CANDLES',atr:null};
assert(card(news,quote,partial).includes('8/9 available'));
assert(card(news,quote,partial).includes('M1: — INSUFFICIENT_CLOSED_CANDLES'));
const oldNews=card({...news,publishedAt:new Date(now-5*3600000).toISOString()});
assert(!oldNews.includes('TP1 <b>'));
assert(oldNews.includes('STALE_OR_UNDATED_HEADLINE'));
const undated=card({...news,publishedAt:null});
assert(undated.includes('STALE_OR_UNDATED_HEADLINE'));
const staleQuote=card(news,{gold:{...quote.gold,marketAt:new Date(now-3*3600000).toISOString()}});
assert(staleQuote.includes('M1: — STALE_QUOTE'));
const noMtf=card(news,quote,null);
assert(noMtf.includes('9/9')===false);
assert(noMtf.includes('M1: — ATR_TIMEFRAME_MISSING'));
console.log('Telegram nine-timeframe cards passed');
