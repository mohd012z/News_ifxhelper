'use strict';
/* SettlementBrain — §17: "what actually happened?"
 *
 * Uses the EXACT next closed candle (by timeframe duration — the existing
 * learning-store rule, not "the candle after that"). Wraps the falsification
 * evaluate + the ai multi-horizon settlement. No retroactive editing: the
 * hypothesis is frozen, the outcome is appended.
 */
var FAL=(typeof require!=='undefined')?require('./falsification-brain.js'):null;
function nextCandleExact(candles,asOf,tfMin,now){
  candles=candles||[];
  var a=Date.parse(asOf);var step=tfMin*60000;
  var target=null;
  for(var i=0;i<candles.length;i++){
    var o=Date.parse(candles[i].time);if(!Number.isFinite(o))continue;
    if(o>a&&o<=a+step+5000){
      /* settle ONLY from a CLOSED next candle — never the forming one */
      if(now!=null&&o+step>now)continue;
      target=candles[i];break;
    }
  }
  return target||null;
}
/**
 * settle(hypothesis, { candles (closed, incl. next), anchorClose, direction,
 *           withinBand (for RANGE), dataInvalid, leakage })
 * returns { prediction, actual:{direction,returnPct,high,low}, result:CONFIRMED|FALSIFIED|INCONCLUSIVE|INVALIDATED, reason, correct }
 */
function settle(hypothesis,inp){
  inp=inp||{};
  var anchor=inp.anchorClose;
  var next=nextCandleExact(inp.candles,hypothesis.asOf,inp.tfMin||15,inp.now);
  if(!next)return {result:'UNSETTLED',reason:'exact next closed candle not yet available',correct:null};
  var close=next.close;
  var retPct=anchor?((close-anchor)/anchor)*100:0;
  var actualDir=close>anchor?'UP':close<anchor?'DOWN':'FLAT';
  var actual={direction:actualDir,returnPct:+retPct.toFixed(4),high:next.high,low:next.low,close:close,withinBand:inp.withinBand!=null?inp.withinBand:null};
  var evalRes=FAL?FAL.evaluate(hypothesis,actual,{dataInvalid:inp.dataInvalid,leakage:inp.leakage}):{verdict:'INCONCLUSIVE',reason:'falsification lib unavailable',correct:null};
  return {prediction:hypothesis.direction,actual:actual,result:evalRes.verdict,reason:evalRes.reason,correct:evalRes.correct,settledAt:next.time,horizon:'EXACT_NEXT'};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMASettlement=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {settle:settle,nextCandleExact:nextCandleExact};});
