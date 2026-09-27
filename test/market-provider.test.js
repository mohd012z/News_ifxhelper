'use strict';
const assert=require('assert'),P=require('../lib/market-provider');
const payload={chart:{result:[{timestamp:[1000,1060],indicators:{quote:[{open:[100,101],high:[102,103],low:[99,100],close:[101,102],volume:[1,2]}]}}]}};
const rows=P.normalizeYahooChart(payload,{provider:'TEST',symbol:'X',timeframe:'1m',fetchedAt:'2026-01-01T00:00:00Z'});assert.equal(rows.length,2);assert.equal(rows[1].close,102);assert.equal(rows[0].provider,'TEST');
assert(P.yahooUrl('GC=F',{interval:'1m',range:'1d'}).includes('GC%3DF'));
const a={provider:'A',candles:[{close:100}]},b={provider:'B',candles:[{close:100.1}]};assert.equal(P.crossCheck(a,b,{maxCloseDiffPct:.2}).state,'ALIGNED');
const c={provider:'C',candles:[{close:102}]};assert.equal(P.crossCheck(a,c,{maxCloseDiffPct:.2}).state,'CONFLICT');
(async()=>{const x=await P.withFallback(async()=>{throw new Error('down')},async()=>({provider:'B',candles:[]}));assert.equal(x.degraded,true);assert.equal(x.selected.provider,'B');console.log('market provider tests passed');})().catch(e=>{console.error(e);process.exit(1);});
