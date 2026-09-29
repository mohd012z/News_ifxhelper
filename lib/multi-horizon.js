'use strict';
/* Multi-horizon settlement (spec: "Multi-horizon outcomes instead of
 * current next-candle-only settlement").
 *
 * The prior learning layer settled only the EXACT next candle. A prediction is
 * judged at +1, +2, +3, +5 candles, each with:
 *   actual direction, continuation (did it keep the predicted direction),
 *   MFE (max favorable excursion) and MAE (max adverse excursion), measured
 *   against the OPEN of the prediction candle.
 *
 * HINDSIGHT SAFETY: the horizon-k MFE/MAE use ONLY the candles up to and
 * including horizon k. The original prediction record is never overwritten —
 * settlement APPENDS outcome fields per horizon (the caller keeps prediction
 * fields immutable and adds actual[+1..+5]). A "FLAT"/UNKNOWN predicted
 * direction yields correct=null (a range call can't be scored as a
 * continuation) but MFE/MAE are still recorded.
 */
function dir(c){if(!c)return null;return c.close>c.open?'UP':c.close<c.open?'DOWN':'FLAT';}
function predictedDir(state){var s=String(state||'').toUpperCase();return s.indexOf('UP')>=0?'UP':s.indexOf('DOWN')>=0?'DOWN':s.indexOf('RANGE')>=0?'FLAT':'UNKNOWN';}
/**
 * settleHorizons({ openPrice, candles, predictedState, baseCandleTime, tfMinutes })
 *  candles: the closed candles AFTER baseCandleTime, in time order.
 * returns { horizons:{ '1':{...},'2':{...},'3':{...},'5':{...} }, available }
 */
function settleHorizons(input){
  input=input||{};
  var openPrice=+input.openPrice;
  var cands=input.candles||[];
  var pd=predictedDir(input.predictedState);
  var H=[1,2,3,5],out={};
  var have=cands.length;
  H.forEach(function(h){
    var seg=cands.slice(0,h);
    if(!seg.length||seg.length<h){out[h]={horizon:h,available:false};return;}
    var cont=null;
    if(pd==='UP')cont=seg[seg.length-1].close>openPrice;
    else if(pd==='DOWN')cont=seg[seg.length-1].close<openPrice;
    else cont=null; /* FLAT/UNKNOWN: continuation not defined */
    var mfe=0,mae=0;
    seg.forEach(function(c){
      var fav=pd==='UP'?+c.high-openPrice:(pd==='DOWN'?openPrice-+c.low:Math.max(+c.high-openPrice,openPrice-+c.low));
      var adv=pd==='UP'?openPrice-+c.low:(pd==='DOWN'?+c.high-openPrice:Math.min(openPrice-+c.low,+c.high-openPrice));
      if(pd==='FLAT'||pd==='UNKNOWN'){fav=Math.max(+c.high-openPrice,openPrice-+c.low);adv=0;}
      if(fav>mfe)mfe=fav;if(adv>mae)mae=adv;
    });
    out[h]={horizon:h,available:true,finalDir:dir(seg[seg.length-1]),
      continuation:cont,
      finalReturnPct:Number.isFinite(openPrice)&&openPrice?+(((+seg[seg.length-1].close-openPrice)/openPrice)*100).toFixed(4):null,
      mfe:openPrice?+((mfe/openPrice)*100).toFixed(4):0,
      mae:openPrice?+((mae/openPrice)*100).toFixed(4):0,
      lastCandleTime:seg[seg.length-1].time};
  });
  return {horizons:out,available:have,requestedMax:5,predictedDirection:pd};
}
/** Append-only: merge new horizon outcomes into an episode WITHOUT touching
 *    its prediction fields (hindsight-leak prevention). */
function mergeSettlement(episode,hz){
  var upd=Object.assign({},episode);
  upd.actual=upd.actual||{};
  var prev=episode.actual&&episode.actual.horizons||{};
  var merged=Object.assign({},prev,hz.horizons);
  upd.actual.horizons=merged;
  /* headline continuation = the +1 horizon (matches the old single-candle
     semantics) so historical stats stay comparable, but all horizons are kept. */
  var h1=merged['1']||merged[1];
  if(h1&&h1.available){
    upd.settled=true;
    if(h1.continuation!=null)upd.correct=h1.continuation;
    if(h1.finalDir!=null)upd.actualDirection=h1.finalDir;
    if(upd.actual.returnPct==null&&h1.finalReturnPct!=null)upd.actual.returnPct=h1.finalReturnPct;
    if(upd.actual.nextTime==null&&h1.lastCandleTime)upd.actual.nextTime=h1.lastCandleTime;
  }
  return upd;
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAMultiHorizon=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {settleHorizons:settleHorizons,mergeSettlement:mergeSettlement,predictedDir:predictedDir};});
