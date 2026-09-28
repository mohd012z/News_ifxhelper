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

/* F5: exact vs supporting evidence must be UNAMBIGUOUS (never quote broad as exact) */
assert.equal(ev.exactEvidence.tier,'exact');
assert.equal(ev.exactEvidence.n,5);
assert.equal(ev.exactEvidence.publishable,false);
assert.equal(ev.supportingEvidence.tier,'pattern');
assert.equal(ev.supportingEvidence.n,25);
assert.ok(ev.supportingEvidence.note.indexOf('NOT the exact setup')>=0);
assert.equal(ev.overallStatus,'PARTIAL_SUPPORT');
/* when exact is publishable, no supporting tier is claimed */
const exactPub=[];for(let i=0;i<30;i++)exactPub.push({...settled,id:'p'+i});
const ev2=L.evidenceFor(base,exactPub,{minSamples:20});
assert.equal(ev2.exactEvidence.publishable,true);
assert.equal(ev2.supportingEvidence,null);
assert.equal(ev2.overallStatus,'EXACT_SUPPORT');
/* nothing anywhere -> INSUFFICIENT_EVIDENCE */
const ev3=L.evidenceFor(base,[],{minSamples:20});
assert.equal(ev3.overallStatus,'INSUFFICIENT_EVIDENCE');
assert.equal(ev3.exactEvidence.n,0);

/* F6: MFE/MAE are direction-aware (favorable/adverse) */
const downBase={...base,analysis:{...base.analysis,next:{state:'DOWN_BIAS',confidence:80,reasons:['test']}}};
const upSet=L.settle(L.createObservation(base),{time:'2026-09-29T00:15:00Z',open:100,high:104,low:98,close:101});
assert.equal(upSet.excursion.highExcursionPct,4);
assert.equal(upSet.excursion.lowExcursionPct,-2);
assert.equal(upSet.excursion.favorableExcursionPct,4);   /* UP call: high side is favorable */
assert.equal(upSet.excursion.adverseExcursionPct,-2);    /* UP call: low side is adverse */
const dnSet=L.settle(L.createObservation(downBase),{time:'2026-09-29T00:15:00Z',open:100,high:104,low:98,close:101});
assert.equal(dnSet.excursion.favorableExcursionPct,-2);  /* DOWN call: low side is favorable */
assert.equal(dnSet.excursion.adverseExcursionPct,4);     /* DOWN call: high side is adverse */
/* FLAT/UNKNOWN call: direction-neutral (no favorable/adverse) */
const flatBase={...base,analysis:{...base.analysis,next:{state:'RANGE_OR_BREAKOUT_WATCH',confidence:50,reasons:['test']}}};
const flSet=L.settle(L.createObservation(flatBase),{time:'2026-09-29T00:15:00Z',open:100,high:104,low:98,close:101});
assert.equal(flSet.excursion.favorableExcursionPct,4);   /* non-DOWN defaults to high side */
assert.ok(flSet.excursion.note.indexOf('neutral')>=0||flSet.excursion.note.indexOf('FLAT')>=0||flSet.excursion.note.indexOf('UNKNOWN')>=0);
/* raw mfePct/maePct preserved (main's contract) — directional set is ADDITIVE */
assert.equal(dnSet.mfePct,4);
assert.equal(dnSet.maePct,-2);

console.log('bbma outcome quality tests passed');
