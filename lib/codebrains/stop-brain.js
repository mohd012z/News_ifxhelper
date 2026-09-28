'use strict';
/* StopBrain — §15: STOP here means "stop TRACKING the continuation
 * hypothesis", NOT an automatic stop-loss. It tells the system when to abandon
 * the current one-step/continuation idea.
 *
 * Triggers (any one fires a stop):
 *   OPPOSITE_CLOSED     a closed candle against the hypothesis
 *   MTF_BREAK           higher-TF structure broke
 *   NEWS_REGIME_CHANGE  news redefined the regime
 *   SOURCE_FAILURE      feed invalidated / stale
 *   STRONG_COUNTER      counter-evidence outweighs support
 */
function check(hypothesis,events){
  events=events||{};
  var stops=[];
  if(events.oppositeClosedCandle)stops.push('OPPOSITE_CLOSED');
  if(events.mtfStructureBreak)stops.push('MTF_BREAK');
  if(events.newsRegimeChange)stops.push('NEWS_REGIME_CHANGE');
  if(events.sourceFailure)stops.push('SOURCE_FAILURE');
  if(events.strongCounterEvidence)stops.push('STRONG_COUNTER');
  var active=stops.length>0;
  return {
    stop:active,
    triggers:stops,
    reason:active?('stopped tracking '+((hypothesis&&hypothesis.direction)||'hypothesis')+' — '+stops.join(', ')):'continuation hypothesis still active',
    isAutoStopLoss:false /* explicit: this is tracking, not a trade stop */
  };
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAStop=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {check:check};});
