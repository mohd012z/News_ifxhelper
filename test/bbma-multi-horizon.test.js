'use strict';
/* EXECUTED proof: multi-horizon settlement (+1/+2/+3/+5, MFE/MAE) with
 * hindsight-leak prevention (prediction never overwritten; outcomes appended).
 * On a deterministic real-shape candle path. */
const assert=require('assert');
const MH=require('../lib/multi-horizon.js');
const R=require('../lib/ohlc-resampler.js');

/* deterministic real-shape M1 path -> M15: 30 candles, an UP then DOWN drift so
   horizons differ and MFE/MAE are non-trivial. */
function mkM15(path){
  const m1=[];let p=4167.0;const start=Date.UTC(2026,8,25,0,0,0);
  path.forEach(d=>{for(let k=0;k<15;k++){const o=p;p=Math.max(1000,o+d);const c=p;const h=Math.max(o,c)+.4;const l=Math.min(o,c)-.4;m1.push({time:new Date(start+m1.length*60000).toISOString(),open:o,high:h,low:l,close:c,volume:1});}});
  return R.resample(m1,15,{requireComplete:true,sourceMinutes:1});
}
/* +1 UP, +2 UP, +3 DOWN, +4 DOWN, +5 DOWN (from open 4167): so +1 cont=true,
   +3 final below open, MFE from the up-leg, MAE from the down-leg. */
const bars=mkM15([+0.5,+0.6,+0.7,-0.4,-0.5,-0.6]);
assert.ok(bars.length>=6,'need >=6 M15 bars (got '+bars.length+')');
const predCandle=bars[0];
const after=bars.slice(1);
const hz=MH.settleHorizons({openPrice:predCandle.close,candles:after,predictedState:'UP_BIAS'});
assert.strictEqual(hz.predictedDirection,'UP');
['1','2','3','5'].forEach(k=>assert.ok(hz.horizons[k].available===(k==='1'?after.length>=1:k==='2'?after.length>=2:k==='3'?after.length>=3:after.length>=5),'horizon '+k+' availability correct'));
assert.strictEqual(hz.horizons['1'].continuation,true,'+1 horizon: close>open => UP continuation true');
assert.ok(hz.horizons['5'].mfe>0,'MFE positive (favorable up-leg)');
assert.ok(hz.horizons['5'].mae>0,'MAE positive (adverse down-leg)');
/* +5 MFE must reflect the max favorable of the FIRST 5 bars, not later bars
   (hindsight safety: horizon-k uses only bars <= k). */
const hz3=MH.settleHorizons({openPrice:predCandle.close,candles:after,predictedState:'UP_BIAS'}).horizons['3'];
/* explicit +3 MFE for UP: max(high_i - open) over the FIRST 3 bars */
const mfe3=after.slice(0,3).reduce((m,c)=>Math.max(m,c.high-predCandle.close),0);
assert.ok(Math.abs(hz3.mfe-(mfe3/predCandle.close*100))<0.01,'+3 MFE uses ONLY the first 3 bars (no lookahead beyond horizon)');
/* FLAT prediction: continuation undefined, MFE/MAE still recorded */
const flat=MH.settleHorizons({openPrice:predCandle.close,candles:after,predictedState:'RANGE_OR_BREAKOUT_WATCH'});
assert.strictEqual(flat.predictedDirection,'FLAT');
assert.strictEqual(flat.horizons['1'].continuation,null,'FLAT call has no continuation score (not forced)');
assert.ok(flat.horizons['1'].mfe>=0,'FLAT MFE still recorded');
/* hindsight-leak: mergeSettlement appends, prediction fields untouched */
const ep={prediction:{state:'UP_BIAS',confidence:60},snapshotPrice:predCandle.close,snapshotTime:predCandle.time,predictedDirection:'UP'};
const merged=MH.mergeSettlement(ep,hz);
assert.deepStrictEqual(merged.prediction,ep.prediction,'prediction fields IMMUTABLE after settlement');
assert.strictEqual(merged.predictedDirection,'UP');
assert.ok(merged.actual&&merged.actual.horizons&&merged.actual.horizons['1'],'outcomes APPENDED under actual.horizons');
assert.strictEqual(merged.correct,true,'headline correct = +1 continuation (backward-compatible)');
assert.strictEqual(merged.settled,true);
/* merging AGAIN must not change the +1 outcome (append-only, idempotent per horizon) */
const merged2=MH.mergeSettlement(merged, MH.settleHorizons({openPrice:predCandle.close,candles:after,predictedState:'UP_BIAS'}));
assert.strictEqual(merged2.correct,merged.correct,'re-settlement does not alter the recorded +1 outcome');

console.log('multi-horizon proof: +1/+2/+3/+5 settled with real MFE/MAE; horizon-k uses only bars <= k (no lookahead); FLAT calls scored as continuation=null but MFE/MAE recorded; prediction fields immutable, outcomes appended under actual.horizons (hindsight-leak prevented); idempotent per horizon');
process.exit(0);
