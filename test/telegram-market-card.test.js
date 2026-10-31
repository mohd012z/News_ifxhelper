'use strict';
const assert = require('node:assert/strict');
const { newsCard, resultCard } = require('../telegram-notify.js');

const historical = {
  key:'news:gold:test', tabId:'gold', title:'U.S. dollar sees best month since June',
  impactScore:-0.12, priceAtDetect:4189.1, createdAt:'2026-09-30T21:14:42.079Z',
  checkpoints:[
    {key:'M15',dueAt:'2026-09-30T21:29:42.079Z',capturedAt:'2026-10-01T00:41:51.328Z',price:4173.4},
    {key:'MN1',dueAt:'2026-10-30T21:14:42.079Z',capturedAt:'2026-10-30T23:00:23.750Z',price:3884.9}
  ]
};
const retrospective = resultCard(historical).caption;
for(const required of ['RESULT: OBSERVED', '3884.900', '-7.262%', 'GC=F', 'MN1',
  'not predicted price %', 'futures']) assert(retrospective.includes(required), required);
for(const forbidden of ['undefined', '~45 min later', 'FLAT / INCONCLUSIVE'])
  assert(!retrospective.includes(forbidden), forbidden);

const now=Date.now();
const tab={id:'gold',label:'GOLD · XAU/USD',price:{}};
const news={title:'Fresh hawkish Fed headline',impact:'bearish',signal:'SELL',
  impactPct:-0.12,tf:'Intraday',publishedAt:new Date(now-10*60000).toISOString()};
const atr={asOf:new Date(now-3600000).toISOString(),
  rows:[{id:'XAUUSD',atr:70,src:'yahoo:GC=F'}]};
const quote={gold:{symbol:'GC=F',price:4000,marketAt:new Date(now-3*60000).toISOString()}};
const valid=newsCard({},tab,news,atr,quote).caption;
for(const expected of ['GC=F gold FUTURES', 'TP1 <b>3895.000', 'TP2 <b>3825.000',
  'SL <b>4084.000', 'Headline impact score']) assert(valid.includes(expected),expected);
assert(!valid.includes('Predicted move:'));

const mismatch=newsCard({},tab,news,atr,{gold:{...quote.gold,symbol:'XAU/USD'}}).caption;
assert(mismatch.includes('INSTRUMENT_MISMATCH'));
assert(!mismatch.includes('TP1 <b>'));
const noQuote=newsCard({},tab,news,atr,{}).caption;
assert(noQuote.includes('TP/SL unavailable'));
const staleHeadline=newsCard({},tab,{...news,publishedAt:new Date(now-5*3600000).toISOString()},atr,quote).caption;
assert(staleHeadline.includes('STALE_OR_UNDATED_HEADLINE'));
const undated=newsCard({},tab,{...news,publishedAt:null},atr,quote).caption;
assert(undated.includes('STALE_OR_UNDATED_HEADLINE'));
const staleQuote=newsCard({},tab,news,atr,{gold:{...quote.gold,marketAt:new Date(now-3*3600000).toISOString()}}).caption;
assert(staleQuote.includes('STALE_QUOTE'));
const missingAtr=newsCard({},tab,news,{asOf:atr.asOf,rows:[]},quote).caption;
assert(missingAtr.includes('INSTRUMENT_MISMATCH'));
console.log('Telegram market card tests passed');
