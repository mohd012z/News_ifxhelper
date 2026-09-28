'use strict';
/* ValidationBrain — "is the data correct?" (distinct from Verification/
 * Confirmation in §20). Composes the DataBrain status + the closed-candle gate
 * into a single VALID | DEGRADED | REJECTED verdict with the drivers, BEFORE
 * any feature is built. This is the "VALIDATED" stage.
 */
var DB=(typeof require!=='undefined')?require('./data-brain.js'):null;
var GATE=(typeof require!=='undefined')?require('../ai/closed-candle-gate.js'):null;
function validate(input){
  input=input||{};
  var out={verdict:'REJECTED',drivers:[],dataStatus:null,ok:false};
  if(!DB)return out;
  var d=DB.classify({candles:input.candles,source:input.source,now:input.now,tfMin:input.tfMin||1});
  out.dataStatus=d.status;
  if(d.status==='SYNTHETIC'){out.drivers.push('synthetic data refused');return out;}
  if(d.status==='FORMING'){out.drivers.push('no closed candle yet');return out;}
  if(d.status==='STALE'){out.drivers.push('stale feed');return out;}
  if(d.status==='INVALID'){out.drivers.push('invalid OHLC');return out;}
  /* closed-candle contiguity over the analysis window */
  if(GATE&&input.analysisCandles){
    var g=GATE.gate(input.analysisCandles,{expectedMin:input.tfMin||15,maxLagMin:60,now:input.now});
    if(!g.ok){out.drivers.push('closed-candle gate: '+g.reason);return out;}
    out.closedCount=g.closedCount;
  }
  out.verdict=d.status==='DEGRADED'?'DEGRADED':'VALID';
  out.ok=true;
  out.dataClass=d.dataClass;
  out.note=d.reason;
  return out;
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAValidation=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {validate:validate};});
