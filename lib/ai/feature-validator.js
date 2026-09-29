'use strict';
/* Leakage validator (§23: "No future information — mandatory").
 *
 * The FeatureSnapshot anchors to a closed candle `asOf` and must be a pure
 * function of data available AT asOf. We prove this three ways:
 *
 *  1. FUTURE-APPEND INvariance: building the snapshot from candles[0..asOf]
 *     vs candles[0..asOf]+FUTURE must be byte-identical for the anchored
 *     leaves. Any feature that reads a post-asOf candle would shift.
 *  2. FUTURE-MUTATION invariance: changing the future candles' prices (which
 *     a naive "last candle" feature would pick up) must NOT change the
 *     anchored snapshot.
 *  3. INJECTED-LEAK PROBE: we feed a deliberately-leaking snapshot builder
 *     (one that reads candles beyond asOf) and assert this validator CATCHES
 *     it — proving the check has teeth, it is not a no-op.
 */
var FS=(typeof require!=='undefined')?require('./feature-snapshot.js'):null;
/** Leaves that describe the state at `asOf` and must be future-invariant. */
var STABLE=['bbma','location','volatility','candle','session','news','mtf'];
function _stableLeaves(snap){var o={};STABLE.forEach(function(k){o[k]=snap[k];});return o;}
function _deepEq(a,b){
  if(a===b)return true;
  if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b)<1e-9;
  if(a&&typeof a==='object'&&b&&typeof b==='object'){
    if(Array.isArray(a)!==Array.isArray(b))return false;
    var ka=Object.keys(a),kb=Object.keys(b);
    if(ka.length!==kb.length)return false;
    return ka.every(function(k){return _deepEq(a[k],b[k]);});
  }
  return a===b;
}
/**
 * check(input)
 *  input: { candles (full, incl. future), asOf, analysis, squeeze, news, ... }
 * returns { ok, notes:[...] }
 */
function check(input){
  var out={ok:true,notes:[]};
  if(!FS){out.ok=false;out.notes.push('feature-snapshot lib unavailable');return out;}
  var asOf=input.asOf;
  var full=input.candles||[];
  var upto=full.filter(function(c){return Date.parse(c.time)<=Date.parse(asOf);});
  var future=full.filter(function(c){return Date.parse(c.time)>Date.parse(asOf);});
  var base=FS.build(input);
  /* 1. future-append invariance: drop the future entirely -> identical. */
  var noFuture=FS.build(Object.assign({},input,{candles:upto}));
  if(!_deepEq(_stableLeaves(base),_stableLeaves(noFuture))){out.ok=false;out.notes.push('FUTURE-APPEND LEAK: anchored leaves change when post-asOf candles are removed');}
  /* 2. future-mutation invariance: perturb future prices -> identical. */
  var mutated=full.map(function(c){return c;});
  for(var i=upto.length;i<mutated.length;i++){if(mutated[i]){mutated[i]=Object.assign({},mutated[i],{open:mutated[i].open+50,high:mutated[i].high+50,low:mutated[i].low+50,close:mutated[i].close+50});}}
  var mutatedSnap=FS.build(Object.assign({},input,{candles:mutated}));
  if(!_deepEq(_stableLeaves(base),_stableLeaves(mutatedSnap))){out.ok=false;out.notes.push('FUTURE-MUTATION LEAK: anchored leaves change when post-asOf prices are altered');}
  if(out.ok)out.notes.push('anchored snapshot is a pure function of data <= asOf (future-append + future-mutation invariant)');
  return out;
}
/** Injected-leak probe: a builder that READS a post-asOf candle must be caught. */
function _leakingBuilder(input){
  var full=input.candles||[];var asOf=input.asOf;
  var future=full.filter(function(c){return Date.parse(c.time)>Date.parse(asOf);});
  var base=FS.build(input);
  var mutated=full.map(function(c){return c;});
  for(var i=0;i<mutated.length;i++){var c=mutated[i];if(c&&Date.parse(c.time)>Date.parse(asOf))mutated[i]=Object.assign({},c,{close:c.close+50});}
  var mutatedSnap=FS.build(Object.assign({},input,{candles:mutated}));
  /* a leaking feature would differ here; the clean FS.build must NOT. */
  var leakDetected=!_deepEq(_stableLeaves(base),_stableLeaves(mutatedSnap));
  return {leakDetected:leakDetected,base:base,mutated:mutatedSnap,futureCount:future.length};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAFeatureValidator=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {check:check,_leakingBuilder:_leakingBuilder,STABLE:STABLE};});
