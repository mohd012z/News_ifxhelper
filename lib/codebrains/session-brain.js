'use strict';
/* SessionBrain — "what session are we in, and where are we in it?" (P2).
 *
 * Wraps state-fingerprint.sessionOf (the single session authority — not
 * recomputed) and adds the opening-range features the spec asks for so memory
 * can learn "M15 Tokyo-first-candle LOW_BB REENTRY_UP NORMAL NO_NEWS -> ?".
 * Sessions: TOKYO / LONDON / NEW_YORK / ASIA_OVERNIGHT / WEEKEND / UNKNOWN.
 */
var FP=(typeof require!=='undefined')?require('../state-fingerprint.js'):null;
function n(v){return Number.isFinite(+v)?+v:null;}
function sessionOf(time){return FP?FP.sessionOf(time):'UNKNOWN';}
/**
 * features({ candles (closed, time-asc), asOf })
 * returns { session, firstSessionCandle, openingRange, distanceToHigh, distanceToLow, rangeATR }
 * openingRange = the first candle of the CURRENT session; distances from its
 * high/low to the anchor close.
 */
function features(inp){
  inp=inp||{};
  var c=inp.candles||[];
  var asOf=(inp.asOf!=null)?inp.asOf:(c.length?c[c.length-1].time:null);
  var upTo=asOf?c.filter(function(x){var o=Date.parse(x.time);return Number.isFinite(o)&&o<=Date.parse(asOf);}).sort(function(a,b){return Date.parse(a.time)-Date.parse(b.time);}):c;
  var last=upTo.length?upTo[upTo.length-1]:null;
  if(!last)return {session:'UNKNOWN',firstSessionCandle:false,openingRange:null,distanceToHigh:null,distanceToLow:null,rangeATR:null};
  var sess=sessionOf(last.time);
  var prev=upTo.length>1?sessionOf(upTo[upTo.length-2].time):null;
  var firstSessionCandle=prev!==sess;
  /* first candle of this session in the window */
  var openC=null;
  for(var i=upTo.length-1;i>=0;i--){if(sessionOf(upTo[i].time)===sess){openC=upTo[i];break;}}
  var close=n(last.close);
  var dToHigh=openC&&close!=null?(close-n(openC.high))/Math.abs(n(openC.high)||1):null;
  var dToLow=openC&&close!=null?(close-n(openC.low))/Math.abs(n(openC.low)||1):null;
  var rangeATR=openC?(n(openC.high)-n(openC.low)):null;
  return {session:sess,firstSessionCandle:firstSessionCandle,openingRange:openC?{time:openC.time,open:n(openC.open),high:n(openC.high),low:n(openC.low),close:n(openC.close)}:null,distanceToHigh:dToHigh==null?null:+dToHigh.toFixed(4),distanceToLow:dToLow==null?null:+dToLow.toFixed(4),rangeATR:rangeATR==null?null:+rangeATR.toFixed(4)};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMASessionBrain=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {sessionOf:sessionOf,features:features};});
