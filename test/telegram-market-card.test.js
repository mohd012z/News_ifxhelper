'use strict';
const assert=require('node:assert/strict');
const {newsCard,resultCard}=require('../telegram-notify.js');
const {FRAMES}=require('../lib/atr-mtf-engine');
const hist={tabId:'gold',title:'historical Fed reaction',impactScore:-.12,
  priceAtDetect:4189.1,createdAt:'2026-09-30T21:14:42.079Z',
  checkpoints:[{key:'MN1',dueAt:'2026-10-30T21:14:42.079Z',
    capturedAt:'2026-10-30T23:00:23.750Z',price:3884.9}]};
const retrospective=resultCard(hist).caption;
for(const wanted of ['RESULT: OBSERVED','-7.262%','3884.900','GC=F','not predicted price %'])
  assert(retrospective.includes(wanted),wanted);
for(const invalid of ['undefined','~45 min later','FLAT / INCONCLUSIVE'])
  assert(!retrospective.includes(invalid),invalid);
const now=Date.now(),date=m=>new Date(now-m*60000).toISOString();
const tab={id:'gold',label:'Gold / XAU/USD',price:{}};
const news={title:'Fresh hawkish Fed text',signal:'SELL',impact:'bearish',
  impactPct:-.12,publishedAt:date(10),tf:'Intraday'};
const futures={gold:{symbol:'GC=F',source:'yahoo:GC=F',
  price:4050,marketAt:date(1)}};
const brokerQuote={state:'READY',symbol:'XAU/USD',source:'oanda:practice:XAU_USD',
  price:4050.25,bid:4050.1,ask:4050.4,spread:.3,marketOpen:true,marketAt:date(1)};
const mtf={instrument:'XAU/USD',source:'oanda:practice:XAU_USD',
  market:'BROKER_OTC_XAU_USD',provider:'OANDA_V20',
  quote:brokerQuote,timeframes:{}};
FRAMES.forEach((f,i)=>mtf.timeframes[f.tf]={
  tf:f.tf,state:'READY',source:'oanda:practice:XAU_USD',
  instrument:'XAU/USD',atr:(i+1)*12,asOf:date(Math.min(f.atrAgeHours*30,120)),
  sourceInterval:f.tf,provider:'OANDA_V20'
});
const render=(spot=mtf,n=news)=>newsCard({},tab,n,{},futures,{},spot).caption;
const ok=render();
assert(ok.includes('9/9 available'));
assert(ok.includes('OANDA broker XAU/USD spot (NOT GC=F futures)'));
assert(ok.includes('Bid 4050.100 / Ask 4050.400'));
for(const tf of FRAMES.map(f=>f.tf))assert(ok.includes(tf+' ATR14'),tf);
assert(ok.includes('M1 ATR14 12.000 · BID Entry 4050.100'));
assert(ok.includes('MN1 ATR14 108.000 · BID Entry 4050.100'));
assert(ok.includes('TP1 4032.100'));
assert(!ok.includes('GC=F gold FUTURES, not spot XAU/USD'));
const unconfigured={...mtf,state:'UNCONFIGURED',quote:{
  state:'UNAVAILABLE',reason:'BROKER_CREDENTIALS_NOT_CONFIGURED'}};
const missing=render(unconfigured);
assert(missing.includes('0/9 available'));
assert(missing.includes('M1: — BROKER_CREDENTIALS_NOT_CONFIGURED'));
assert(!missing.includes('M1 ATR14'));
const noBroker=render(null);
assert(noBroker.includes('0/9 available'));
assert(noBroker.includes('M1: — BROKER_SPOT_NOT_CONFIGURED'));
const oandaMismatch=structuredClone(mtf);
oandaMismatch.quote.source='yahoo:GC=F';
const mixed=render(oandaMismatch);
assert(mixed.includes('0/9 available'));
assert(mixed.includes('M1: — INSTRUMENT_MISMATCH'));
const partial=structuredClone(mtf);
partial.timeframes.M1={...partial.timeframes.M1,state:'UNAVAILABLE',
  reason:'INSUFFICIENT_CLOSED_CANDLES',atr:null};
assert(render(partial).includes('8/9 available'));
assert(render(partial).includes('M1: — INSUFFICIENT_CLOSED_CANDLES'));
const stale=render(mtf,{...news,publishedAt:date(300)});
assert(stale.includes('STALE_OR_UNDATED_HEADLINE'));
assert(!stale.includes('M1 ATR14'));
const staleQuote=structuredClone(mtf);
staleQuote.quote.marketAt=date(300);
assert(render(staleQuote).includes('M1: — STALE_QUOTE'));
const wide=structuredClone(mtf);
wide.quote.ask=4060;
wide.quote.bid=4050;
assert(render(wide).includes('M1: — SPREAD_TOO_WIDE_FOR_ATR'));
console.log('Telegram nine-timeframe broker spot card tests passed');
