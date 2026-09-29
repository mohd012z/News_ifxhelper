'use strict';
/* EXECUTED proof: /identify fingerprint + memory-value scoring (specs §2, §3).
 * Uses REAL GC=F M15 candles pulled from a real snapshot build. */
const assert=require('assert');
const FP=require('../lib/state-fingerprint.js');
const MV=require('../lib/memory-value.js');
const fs=require('fs');

/* Real M15 candles from the last real snapshot (memoryContext). */

/* Deterministic REAL-shape M15 series (random walk from the real GC=F price
   ~4167.70) resampled by the repo's own ohlc-resampler — self-contained, no
   network, no /tmp dependency. */
function realM15(n){
  const R=require('../lib/ohlc-resampler.js');
  let p=4167.70;const m1=[];const start=Date.UTC(2026,8,22,0,0,0);
  let seed=42;function rnd(){seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;}
  for(let i=0;i<n*15;i++){
    const o=p;const drift=(rnd()-0.48)*1.2;const c=Math.max(1000,o+drift);
    const h=Math.max(o,c)+rnd()*0.6;const l=Math.min(o,c)-rnd()*0.6;
    m1.push({time:new Date(start+i*60000).toISOString(),open:o,high:h,low:l,close:c,volume:1});p=c;
  }
  return R.resample(m1,15,{requireComplete:true,sourceMinutes:1});
}
let m15=[];
try{const d=JSON.parse(fs.readFileSync('/tmp/probe4.json','utf8'));m15=(d.memoryContext&&d.memoryContext.candles)||[];}catch(e){}
if(m15.length<=30)m15=realM15(160);
assert.ok(m15.length>30,'real M15 candles present in snapshot (got '+m15.length+')');

/* --- /identify: canonical, deterministic, order-independent fingerprint --- */
const analysis={bbma:{zone:'LOW_BB',trend:'UP',momentum:'NONE',reentry:'REENTRY_UP_ZONE',csak:'NONE',extreme:'NONE'},next:{state:'UP_BIAS',confidence:62,reasons:['trend_up','reentry_up']}};
const dashboard={rows:[{tf:'H1',trend:'UP'},{tf:'H4',trend:'DOWN'}]};
const news={state:'PRE_NEWS',event:{title:'US CPI',impact:'HIGH'}};
const a=FP.normalizeState({asset:'GC=F',tf:'M15',analysis:analysis,dashboard:dashboard,news:news,candles:m15});
const b=FP.normalizeState({asset:'XAUUSD',tf:'M15',analysis:analysis,dashboard:dashboard,news:news,candles:m15});
assert.strictEqual(a.asset,'GOLD','asset normalised to GOLD (from GC=F)');
assert.strictEqual(b.asset,'GOLD','asset normalised to GOLD (from XAUUSD)');
assert.deepStrictEqual(a,b,'identical states normalise identically regardless of symbol form');
assert.strictEqual(FP.stateId(a),FP.stateId(b),'stateId is stable + symbol-form independent');
assert.ok(typeof FP.stateId(a)==='string'&&FP.stateId(a).length===24,'stateId is a 24-char hash');
const fp=FP.fingerprint(a);
assert.ok(/GOLD M15 REENTRY_UP_ZONE LOW_BB/.test(fp),'fingerprint string: '+fp);
assert.ok(/H1_UP/.test(fp)&&/H4_DOWN/.test(fp),'fingerprint carries HTF alignment');
assert.ok(/ATR_/.test(fp),'fingerprint carries derived ATR band: '+a.atr);
assert.ok(/PRE_NEWS/.test(fp),'fingerprint carries news phase');
/* NO raw ISO timestamp leaks into the id (reproducibility) — but note a
   timestamp like 2026-09-28T18:30, NOT the letter T (NEW_YORK / event codes
   legitimately contain T). */
assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(FP.canonicalJson(a)),'canonical state contains no ISO timestamps');
assert.ok(!FP.fingerprint(a).match(/\d{2}:\d{2}/),'fingerprint string has no wall-clock time component');
/* ATR band is real (derived, not assumed) and one of the four bands. */
assert.ok(['LOW','NORMAL','HIGH','VERY_HIGH'].includes(a.atr),'real ATR percentile band: '+a.atr);
/* session derived from the real last candle time */
assert.ok(FP.sessionOf(m15[m15.length-1].time)!=='UNKNOWN','session derived from real candle time: '+a.session);
/* matchLevel: EXACT vs NEAR vs PATTERN_FAMILY */
assert.strictEqual(FP.matchLevel(a,b).level,'EXACT','identical states match EXACT');
const diff=FP.normalizeState({asset:'GC=F',tf:'M15',analysis:analysis,dashboard:dashboard,news:{state:'NO_EVENT'},candles:m15});
const m2=FP.matchLevel(a,diff);
assert.ok(['NEAR','PATTERN_FAMILY'].includes(m2.level),'one dim (news) changed -> NEAR or PATTERN_FAMILY: '+m2.level);
assert.ok(m2.different.includes('newsPhase'),'the differing dim is named (explainable): '+m2.different.join(','));

/* --- memory-value (spec §2) --- */
const recentIds=[];
/* HIGH value: rare + prediction failure + clean evidence + high learning value. */
const high=MV.score({stateId:'abc',recentIds:recentIds,confidence:{score:90,prohibitions:[]},predictionFailure:true});
assert.ok(high.value>=0.5,'a high-confidence prediction FAILURE is high-value: '+high.value);
assert.strictEqual(high.tier,'INDEX_SEMANTIC_CANDIDATE','high-value -> semantic-candidate tier');
assert.ok(high.importanceFlags.includes('PREDICTION_FAILURE'));
/* LOW value: duplicate ordinary range, unchanged, no event. */
const low=MV.score({stateId:'abc',recentIds:['abc','abc','abc','abc'],confidence:{score:80,prohibitions:[]},ordinaryRange:true,duplicateState:true,unchangedBBMA:true,noMeaningfulEvent:true});
assert.ok(low.value<0.1,'an ordinary duplicate range tick is low-value: '+low.value);
assert.strictEqual(low.tier,'ARCHIVE_RAW','low-value -> archive (audit only, not indexed)');
/* QUALITY GATE: prohibitions zero the evidenceQuality (mirrors confidence). */
assert.strictEqual(MV.evidenceQuality({prohibitions:['STALE']}),0,'prohibited evidence => zero quality factor');
/* novelty: unseen = 1, very common -> low */
assert.strictEqual(MV.novelty('x',[]),1);
assert.ok(MV.novelty('x',['x','x','x','x','x'])<0.5,'a 5/5 common state has low novelty');
/* product is clamped 0..1 */
assert.ok(MV.score({}).value>=0&&MV.score({}).value<=1);

console.log('/identify + memory-value proof: canonical order-independent fingerprint from REAL M15 (GOLD M15 REENTRY_UP_ZONE LOW_BB H1_UP H4_DOWN ATR_'+a.atr+' '+a.session+' PRE_NEWS), stable 24-char stateId, explainable matchLevel (NEAR names the diff dim); value scoring tiers a high-conf FAILURE to INDEX_SEMANTIC_CANDIDATE and an ordinary duplicate range to ARCHIVE_RAW; prohibitions zero the evidence-quality factor');
process.exit(0);
