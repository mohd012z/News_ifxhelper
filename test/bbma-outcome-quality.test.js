'use strict';
const assert=require('assert');
const L=require('../lib/bbma-learning');

const base={generationId:'gen-1',sourceGeneratedAt:'2026-09-29T00:00:00Z',symbol:'GC=F',tf:'M15',candle:{time:'2026-09-29T00:00:00Z',open:100,high:101,low:99,close:100.5},analysis:{bbma:{zone:'MID_BB',trend:'UP',extreme:'NONE',momentum:'NONE',reentry:'REENTRY_BUY',csak:'NONE'},squeeze:{squeeze:'NORMAL'},next:{state:'UP_BIAS',confidence:80,reasons:['test']}},marketMode:'NORMAL'};

const settled=L.settle(L.createObservation(base),{time:'2026-09-29T00:15:00Z',open:100,high:104,low:98,close:101});
assert.equal(settled.correct,true);
assert.equal(settled.mfePct,4);
assert.equal(settled.maePct,-2);
assert.equal(settled.rangePct,6);
assert.equal(settled.closeLocationPct,50);

const exact=[];for(let i=0;i<5;i++)exact.push({...settled,id:'e'+i});
const near=[];for(let i=0;i<20;i++)near.push({...settled,id:'n'+i,marketMode:'POST_NEWS',location:'TOP_BB'});
const ev=L.evidenceFor(base,[...exact,...near],{minSamples:20});
assert.equal(ev.sampleSize,5);
assert.equal(ev.publishable,false);
assert.equal(ev.evidenceTiers.exact.samples,5);
assert.ok(ev.evidenceTiers.pattern.samples>=25);
assert.equal(ev.evidenceTiers.pattern.publishable,true);
assert.equal(ev.bestAvailableTier,'pattern');

console.log('bbma outcome quality tests passed');
