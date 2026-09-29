'use strict';
/* PredictionBrain — "what is the next-step hypothesis?" (§12).
 *
 * Only receives a VERIFIED consensus. Emits a OneStepHypothesis — not just a
 * direction, but direction + movement class + expected range + primary
 * waypoint + alternative scenario + falsifier + strength. It is a PENDING
 * hypothesis until the exact next candle settles it.
 */
function build({consensus, bbma, regime, session, news, history, snapshot}){
  var dir=consensus.direction||null;
  var movement=consensus.movementClass||'NORMAL';
  var range=consensus.expectedRange||null;
  var waypoint=primaryWaypoint(dir,regime);
  var alt=alternative(dir);
  var falsifier='exact next candle closes '+(dir==='UP'?'DOWN':dir==='DOWN'?'UP':'beyond the stated BB range');
  var strengthScore=strengthOf(consensus,history);
  return {
    schema:'OneStepHypothesis/v1',
    asOf:snapshot?snapshot.candleClose:null,
    tf:snapshot?snapshot.tf:'M15',
    direction:dir,
    movementClass:movement,
    expectedRange:range,
    primaryWaypoint:waypoint,
    alternativeScenario:alt,
    falsifier:falsifier,
    strength:strengthScore,
    regime:regime?regime.regime:null,
    session:session?session.session:null,
    newsStrength:news?news.strength:null,
    historySupport:history?history.status:null,
    status:'PENDING'
  };
}
function primaryWaypoint(dir,regime){
  if(dir==='UP')return 'MID_BB';
  if(dir==='DOWN')return 'MID_BB';
  return regime&&regime.regime==='SQUEEZE'?'BREAKOUT_EITHER':'RANGE_HOLD';
}
function alternative(dir){
  if(dir==='UP')return 'RANGE (mean reversion back to mid)';
  if(dir==='DOWN')return 'RANGE (mean reversion back to mid)';
  return 'BREAKOUT (squeeze resolves either way)';
}
function strengthOf(consensus,history){
  var s=0;
  if(consensus&&consensus.publishable)s+=1;
  if(history&&history.status==='OK'&&history.n>=10)s+=1;
  else if(history&&history.status==='OK')s+=0.5;
  if(consensus&&consensus.heuristicScore!=null&&consensus.heuristicScore>=70)s+=0.5;
  if(s>=2)return 'STRONG';if(s>=1)return 'MODERATE';return 'WEAK';
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAPrediction=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {build:build};});
