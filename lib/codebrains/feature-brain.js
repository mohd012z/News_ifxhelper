'use strict';
/* FeatureBrain — factory for the immutable, LOCKED FeatureSnapshot.v1 (§3).
 *
 * Assembles the snapshot from the proven primitives (state-fingerprint + the
 * ai feature-snapshot) and locks it. After the snapshot is built it must never
 * be updated on learning the next candle — it is the single source of truth
 * for one prediction. Composes, does not recompute BBMA (zone/trend come from
 * the W.location the caller passes).
 */
var FS=(typeof require!=='undefined')?require('../ai/feature-snapshot.js'):null;
var SES=(typeof require!=='undefined')?require('./session-brain.js'):null;
function build(inp){
  inp=inp||{};
  if(!FS)return {error:'feature-snapshot unavailable'};
  var c=inp.candles||[];
  var asOf=(inp.asOf!=null)?inp.asOf:(c.length?c[c.length-1].time:null);
  var mtf=inp.mtf||{};
  /* session brain enriches the snapshot with opening-range features */
  var sess=SES?SES.features({candles:c,asOf:asOf}):{session:'UNKNOWN',firstSessionCandle:false};
  var snap=FS.build({
    candles:c,asOf:asOf,tf:inp.tf||'M15',analysis:inp.analysis||{},squeeze:inp.squeeze||null,
    news:inp.news||{state:'NO_EVENT'},instrument:inp.instrument||null,
    dataClass:inp.dataClass||'UNKNOWN',generationId:inp.generationId||null,mtf:mtf,now:inp.now
  });
  /* lock + audit refs (deep-frozen already by FS; attach immutable metadata) */
  var locked={
    schema:'FeatureSnapshot.v1',
    snapshotId:snapId(snap),
    lockedAt:inp.now?new Date(inp.now).toISOString():new Date().toISOString(),
    asOf:snap.candleClose,
    tf:snap.tf,
    symbol:snap.symbol,instrumentId:snap.instrumentId,dataClass:snap.dataClass,
    session:sess,
    snap:snap
  };
  try{Object.freeze(locked);Object.freeze(locked.snap);}catch(e){}
  return locked;
}
function snapId(snap){
  try{
    var crypto=require('crypto');
    return 'fs-'+crypto.createHash('sha256').update(JSON.stringify({a:snap.candleClose,b:snap.tf,c:snap.symbol,d:snap.instrumentId,e:snap.bbma,f:snap.volatility,g:snap.session})).digest('hex').slice(0,20);
  }catch(e){return 'fs-'+Math.abs(JSON.stringify(snap.candleClose+snap.tf).length); }
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAFeatureBrain=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {build:build};});
