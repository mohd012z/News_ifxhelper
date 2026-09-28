'use strict';
/* VerificationBrain — §20: don't conflate validation / verification / confirmation.
 *
 *   VALIDATED   data is correct?        (DataBrain mayPredict + closed + dataClass)
 *   VERIFIED    claim supported?        (consensus gate: instrument, news, regime)
 *   PENDING     awaiting the next candle
 *   CONFIRMED / FALSIFIED  outcome actually happened (SettlementBrain)
 *
 * Wraps the ai consensus verification gate and the data-brain status. AI can
 * NEVER promote: the deterministic gate is the only publisher.
 */
var GS=(typeof require!=='undefined')?require('../ai/consensus-engine.js'):null;
function verify({data, candidate, snapshot, shadow}){
  var ok={stage:null,drivers:[],aiCanPublish:false};
  /* VALIDATED */
  if(!data||!data.mayPredict){ok.stage='REJECTED';ok.drivers.push('data not validated: '+(data&&data.status));return ok;}
  ok.stage='VALIDATED';
  /* VERIFIED */
  if(GS&&candidate&&snapshot){
    var g=GS.verify(candidate,snapshot,{shadow:shadow!==false});
    if(g.status==='REJECTED'){ok.stage='REJECTED';ok.drivers=ok.drivers.concat(g.drivers);return ok;}
    ok.publishable=g.publishable;ok.shadow=g.shadow;ok.stage=g.status;
    ok.aiVerdict=(g.aiVerdict||null);
  }else if(candidate){
    ok.stage='VERIFIED';
  }
  return ok;
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAVerificationBrain=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {verify:verify};});
