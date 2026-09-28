'use strict';
/* Data-class classification (P0-C: ban synthetic/demo from the prediction path).
 *
 * Every price source is classified so the prediction/learning gate can REJECT
 * anything that is not real market data. Classes:
 *   OBSERVED            a real observed tick/candle from a live source
 *   DERIVED_FROM_OBSERVED  candles legitimately derived from observed data
 *                         (resampled M1/M5->M15, EMA/BB computed, etc.)
 *   CACHED_OBSERVED     a previously-observed snapshot re-used from cache
 *   SYNTHETIC           generated, never observed (BASELINE_CACHE, sin/cos)
 *   DEMO                hard-coded demo/sample data
 *
 * The prediction gate accepts ONLY OBSERVED / DERIVED_FROM_OBSERVED (and, when
 * explicitly allowed, CACHED_OBSERVED). SYNTHETIC and DEMO MUST NEVER ENTER
 * prediction training, empirical memory, accuracy calculation, or evidence.
 */
var DEMO_SRC=/DEMO|SAMPLE|BASELINE_CACHE|BASELINE|SYNTHETIC|SIMULAT/i;
var DERIVED_SRC=/DERIVED|RESAMPL|BACKFILL|REPLAY/i;
var OBSERVED_SRC=/LIVE|OBSERVED|TWELVEDATA|GOLD_API|COINBASE|OKX|BINANCE|COINGECKO|YAHOO|REAL/i;
function classify(src){
  src=String(src||'');
  if(/SYNTHETIC|BASELINE_CACHE|BASELINE|SIMULAT/i.test(src))return 'SYNTHETIC';
  if(/DEMO|SAMPLE/i.test(src))return 'DEMO';
  if(/CACHED|CACHE|REPLAY/i.test(src))return 'CACHED_OBSERVED';
  if(DERIVED_SRC.test(src))return 'DERIVED_FROM_OBSERVED';
  if(OBSERVED_SRC.test(src))return 'OBSERVED';
  return 'UNKNOWN';
}
/** True iff the source may be used for prediction/learning/evidence. */
function isPredictable(cls,allowCached){
  if(cls==='OBSERVED'||cls==='DERIVED_FROM_OBSERVED')return true;
  if(cls==='CACHED_OBSERVED')return !!allowCached;
  return false; /* SYNTHETIC / DEMO / UNKNOWN are NEVER predictable */
}
/** Gate result with a human-auditable reason. */
function gate(src,allowCached){
  var cls=classify(src);
  var ok=isPredictable(cls,allowCached);
  return {dataClass:cls,allowed:ok,reason:ok?('clean source: '+cls):('REJECTED for prediction: '+cls+' must never enter the prediction/evidence path')};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMADataClass=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {classify:classify,isPredictable:isPredictable,gate:gate};});
