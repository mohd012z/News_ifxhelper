'use strict';
/* WaypointBrain — §14: waypoints are OBSERVATION CHECKPOINTS, not take-profits.
 *
 * For a directional hypothesis, the price must pass through structural levels
 * (MID_BB -> EMA50 -> TOP_BB / session high). At each we record:
 *   REACHED | REJECTED | ACCEPTED | BROKEN | NOT_REACHED
 * This is far more information-rich than "wrong prediction".
 */
function waypointsFor(direction,ctx){
  ctx=ctx||{};
  if(direction==='UP')return ['MID_BB','EMA50','TOP_BB','SESSION_HIGH'];
  if(direction==='DOWN')return ['MID_BB','EMA50','LOW_BB','SESSION_LOW'];
  return ['RANGE_UPPER','RANGE_LOWER']; /* range: the band edges */
}
/* evaluate how far price got toward the target before the move ended */
function evaluate(direction,ctx,progression){
  ctx=ctx||{};progression=progression||{};
  var wps=waypointsFor(direction,ctx);
  var reached=progression.maxFavorable||0; /* how many levels were touched */
  var broken=progression.broken||false;    /* structure broke / stop triggered */
  var out=wps.map(function(w,i){
    if(broken&&i>=reached)return {level:w,status:'BROKEN'};
    if(i<reached)return {level:w,status:'REACHED'};
    return {level:w,status:'NOT_REACHED'};
  });
  var last=out[out.length-1]||{status:'NOT_REACHED'};
  var state=broken?'BROKEN':(reached>=wps.length?'REACHED_ALL':(reached>0?'PARTIAL':'NOT_REACHED'));
  return {waypoints:out,endState:state,reached:reached,of:wps.length,broken:broken};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAWaypoint=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {waypointsFor:waypointsFor,evaluate:evaluate};});
