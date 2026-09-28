'use strict';
/* LearningBrain — §18: "what should be remembered?"
 *
 * Builds the settled observation record that feeds the empirical memory +
 * metrics + calibration. Adds the richer dimensions the spec asks for
 * (waypoint behavior, regime, session, news strength, movement magnitude, stop
 * reason, end-movement reason). It is APPEND-ONLY — failed predictions are not
 * deleted.
 */
function record(hypothesis,settlement,ctx){
  ctx=ctx||{};
  var mag=ctx.movementMagnitude||null;
  return {
    schemaVersion:1,
    asOf:hypothesis?hypothesis.asOf:null,
    tf:hypothesis?hypothesis.tf:'M15',
    predicted:prediction(hypothesis),
    actual:settlement?settlement.actual:null,
    result:settlement?settlement.result:null,
    correct:settlement?settlement.correct:null,
    returnPct:settlement?settlement.actual&&settlement.actual.returnPct:null,
    regime:hypothesis?hypothesis.regime:null,
    session:hypothesis?hypothesis.session:null,
    newsStrength:hypothesis?hypothesis.newsStrength:null,
    bbZone:ctx.bbZone||null,
    movementMagnitude:mag,
    waypoint:ctx.waypoint||null,
    stopReason:ctx.stopReason||null,
    endMovementReason:ctx.endMovementReason||null,
    dataClass:ctx.dataClass||null,
    sourceId:ctx.sourceId||null,
    createdAt:new Date().toISOString(),
    settledAt:settlement?settlement.settledAt:null
  };
}
function prediction(h){
  return {direction:h.direction,movementClass:h.movementClass,expectedRange:h.expectedRange,waypoint:h.primaryWaypoint,falsifier:h.falsifier,strength:h.strength};
}
/* append-only: the returned store never rewrites a prior observation */
function append(store,obs){
  store=store||{observations:[]};
  store.observations=store.observations.concat([obs]);
  return store;
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMALearning=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {record:record,append:append};});
