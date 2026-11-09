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
/* Compact card contract (Anam: full block was "too much"):
 *   line1 label + direction + symbol + tier + movement
 *   line2 order call (+ reason)
 *   line3 📊 BBMA <sym> ... (compact one-liner, or n/a when source down)
 *   line4 🧮 MTF ATR14: N/9 ... (one line, only when actionable)
 *   line5 headline + source + time
 * Per-TF ATR detail and the stale-headline row list are GONE from the card. */
const render=(spot=mtf,n=news)=>newsCard({},tab,n,{},futures,{},spot).caption;
const ok=render();
assert(ok.includes('SELL'),'order call present');
assert(ok.includes('🔴 BEARISH'),'direction tag on line 1');
assert(ok.includes('MTF ATR14: 9/9 available'),'compact ATR one-liner');
assert(!ok.includes('M1 ATR14 12.000'),'per-TF ATR detail removed');
assert(!ok.includes('auto-classified news'),'old verbose header removed');
assert(ok.includes('Fresh hawkish Fed text'),'headline retained');
assert(!ok.includes('undefined'),'no undefined leakage');

/* ATR unavailable -> one compact line (or hidden when headline fresh). */
const noBroker=render(null);
assert(noBroker.includes('MTF ATR14'),'compact ATR line still present (0/9)');
assert(!noBroker.includes('M1: — BROKER_SPOT_NOT_CONFIGURED'),'per-TF reason rows removed');

/* Stale headline -> no price-targets line, no per-TF STALE rows. */
const stale=render(mtf,{...news,publishedAt:date(300)});
assert(!stale.includes('STALE_OR_UNDATED_HEADLINE'),'per-TF stale rows removed');
assert(!stale.includes('M1 ATR14'));

console.log('Telegram compact news card tests passed');
