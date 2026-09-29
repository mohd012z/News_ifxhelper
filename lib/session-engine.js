'use strict';
/* SessionEngine — production Tokyo/US FIRST-COMPLETED-CANDLE engine (P1).
 *
 * Not the chart label layer (label-layout-engine.js) — this is the DATA engine
 * that memory + prediction read. It answers: "what was the first COMPLETED
 * candle of the current session, and where is price relative to it?"
 *
 * DST-safe (no hardcoded US time all year):
 *   Tokyo cash open  09:00 JST  = 00:00 UTC   (JST has no DST)
 *   US    cash open  09:30 ET   = 13:30 UTC (EST) / 12:30 UTC (EDT)
 * The US offset is computed from the real US DST rule (2nd Sun Mar 02:00 ->
 * 1st Sun Nov 02:00 local), so "US first candle" tracks DST automatically.
 *
 * A candle's .time is its OPEN time; it is COMPLETED when open + tf <= now.
 * "First completed candle" = the first closed candle whose open >= sessionOpen.
 */
var TF={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240,D1:1440};
function n(v){return Number.isFinite(+v)?+v:null;}
/* ---- US DST (2007+ stable rule) ---- */
function _nthWeekday(year,month,weekday,nth){ /* month 0-based, weekday 0=Sun */
  var first=new Date(Date.UTC(year,month,1));
  var off=(weekday-first.getUTCDay()+7)%7;
  var day=1+off+(nth-1)*7;
  return new Date(Date.UTC(year,month,day));
}
function usDstStartUtc(year){var mar=_nthWeekday(year,2,0,2);return Date.UTC(year,2,mar.getUTCDate(),7,0,0);} /* 02:00 EST = 07:00 UTC */
function usDstEndUtc(year){var nov=_nthWeekday(year,10,0,1);return Date.UTC(year,10,nov.getUTCDate(),6,0,0);} /* 02:00 EDT = 06:00 UTC */
function isUsDst(ms){var y=new Date(ms).getUTCFullYear();return ms>=usDstStartUtc(y)&&ms<usDstEndUtc(y);}
/* US cash open (09:30 ET) as a UTC instant on the trading day containing ms */
function usOpenUtc(ms){
  var d=new Date(ms);var y=d.getUTCFullYear();
  var dayStart=Date.UTC(y,d.getUTCMonth(),d.getUTCDate());
  return dayStart+(isUsDst(ms)?12.5:13.5)*3600*1000;
}
/* Tokyo cash open (09:00 JST) = 00:00 UTC of the trading day */
function tokyoOpenUtc(ms){var d=new Date(ms);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),0,0,0);}
function _isWeekend(ms){var dow=new Date(ms).getUTCDay();return dow===0||dow===6;}
function sessionOf(ms){
  if(_isWeekend(ms))return 'WEEKEND';
  var d=new Date(ms);var y=d.getUTCFullYear();
  var tokyo=Date.UTC(y,d.getUTCMonth(),d.getUTCDate(),0,0,0);
  var london=tokyo+7*3600*1000;
  var ny=usOpenUtc(ms);
  var dayEnd=tokyo+24*3600*1000;
  if(ms<tokyo)return 'ASIA_OVERNIGHT';
  if(ms>=tokyo&&ms<london)return 'TOKYO';
  if(ms>=london&&ms<ny)return 'LONDON';
  if(ms>=ny&&ms<dayEnd)return 'NEW_YORK';
  return 'ASIA_OVERNIGHT';
}
/* the first COMPLETED candle of the session that contains openUtc */
function firstCompleted(candles,openUtc,now,tfMin){
  candles=candles||[];var step=tfMin*60000;
  for(var i=0;i<candles.length;i++){
    var c=candles[i];var o=Date.parse(c.time);if(!Number.isFinite(o))continue;
    if(o<openUtc)continue;               /* not yet in this session */
    if(o+step>now)continue;              /* not completed yet */
    return {time:c.time,open:c.open,high:c.high,low:c.low,close:c.close,completedAt:o+step};
  }
  return null;
}
/**
 * summary({ candles (closed, time-asc), tf ('M15'), now, session ('TOKYO'|'NEW_YORK') })
 * returns { session, openUtc, firstCandle, high, low, midpoint, range, rangePct,
 *           current, reaction, zone, locked }
 * reaction: current close vs the first completed candle.
 * zone (locked): where price sits relative to the session's opening range.
 */
function summary(inp){
  inp=inp||{};
  var now=inp.now!=null?inp.now:Date.now();
  var tfMin=TF[String(inp.tf||'M15').toUpperCase()]||15;
  var c=inp.candles||[];
  if(!c.length)return {session:'UNKNOWN',openUtc:null,firstCandle:null,high:null,low:null,midpoint:null,range:null,rangePct:null,current:null,reaction:'NO_DATA',zone:'NO_DATA',locked:false};
  var which=inp.session||sessionOf(now);
  if(which==='WEEKEND')return {session:'WEEKEND',openUtc:null,firstCandle:null,high:null,low:null,midpoint:null,range:null,rangePct:null,current:null,reaction:'CLOSED',zone:'NO_DATA',locked:false};
  var openUtc=which==='NEW_YORK'?usOpenUtc(now):tokyoOpenUtc(now);
  var first=firstCompleted(c,openUtc,now,tfMin);
  if(!first)return {session:which,openUtc:openUtc,firstCandle:null,high:null,low:null,midpoint:null,range:null,rangePct:null,current:null,reaction:'NO_FIRST_COMPLETED',zone:'NO_DATA',locked:false};
  var last=c[c.length-1];
  var cur=last.close!=null?last.close:first.close;
  var hi=Math.max(first.high,first.close,first.open);
  var lo=Math.min(first.low,first.close,first.open);
  var mid=(hi+lo)/2;
  var range=hi-lo;
  var rangePct=first.close?range/Math.abs(first.close)*100:null;
  /* reaction of the CURRENT close vs the first completed candle */
  var reaction=cur>first.close?'UP':cur<first.close?'DOWN':'FLAT';
  /* locked zone relative to the session opening range */
  var zone=cur>hi?'ABOVE_OPEN':cur<lo?'BELOW_OPEN':'WITHIN_OPEN';
  return {session:which,openUtc:openUtc,firstCandle:first,high:hi,low:lo,midpoint:mid,range:range,rangePct:rangePct==null?null:+rangePct.toFixed(4),current:cur,reaction:reaction,zone:zone,locked:true,
    distFromHigh:cur!=null?(cur-hi):null,distFromLow:cur!=null?(cur-lo):null};
}
/* explicit DST check used by the test to prove no all-year hardcode */
function dstOffsets(){return {est:13.5,edt:12.5,usOpenUtc:usOpenUtc,usDstStartUtc:usDstStartUtc,usDstEndUtc:usDstEndUtc,isUsDst:isUsDst};}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMASessionEngine=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {summary:summary,sessionOf:sessionOf,usOpenUtc:usOpenUtc,tokyoOpenUtc:tokyoOpenUtc,firstCompleted:firstCompleted,dstOffsets:dstOffsets,TF:TF};});
