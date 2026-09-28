'use strict';
/* Metrics (§22) — accuracy alone is not enough. Computed from SETTLED
 * observations only (prediction vs exact next closed candle).
 *
 * Returns directional/balanced accuracy, confusion matrix, per-class
 * precision, Brier score, calibration error, mean/median next-return,
 * ATR-normalized movement, max adverse movement, sample count, and a
 * breakdown by tf/session/regime/news/BB location/MTF alignment.
 *
 * Every metric reports n so a caller never treats a thin sample as a signal.
 */
function _ret(obs){return n(obs.actualReturnPct);}
function _sign(d){return d>0?'UP':(d<0?'DOWN':'FLAT');}
function summarize(obsList){
  var rows=obsList||[];
  var settled=rows.filter(function(o){return o&&o.settled;});
  var n=settled.length;
  var out={schema:'Metrics/v1',n:n,settled:n,total:rows.length};
  if(n===0){Object.assign(out,{note:'no settled observations yet (shadow accumulating)',directionalAccuracy:null,brier:null});return out;}
  var correct=0;var confusion={UP:{UP:0,DOWN:0,FLAT:0},DOWN:{UP:0,DOWN:0,FLAT:0},RANGE:{UP:0,DOWN:0,FLAT:0},FLAT:{UP:0,DOWN:0,FLAT:0}};
  var brierSum=0,retArr=[],atrNorm=[],adverse=[];
  var perClass={UP:{tp:0,fp:0},DOWN:{tp:0,fp:0},RANGE:{tp:0,fp:0}};
  settled.forEach(function(o){
    var pred=normDir(o.direction);var act=normDir(o.actualDirection);
    var predBin=o.movementClass==='RANGE'?pred:(pred==='UP'?'UP':pred==='DOWN'?'DOWN':'FLAT');
    var actBin=act==='UP'?'UP':act==='DOWN'?'DOWN':'FLAT';
    if(confusion[predBin]&&confusion[predBin][actBin]!=null)confusion[predBin][actBin]++;
    if(predBin===actBin)correct++;
    /* brier over UP/DOWN/FLAT using the forecast prob (heuristicScore scaled) */
    var p=clamp01(o.forecastProb!=null?o.forecastProb:(o.heuristicScore!=null?o.heuristicScore/100:0.5));
    brierSum+=_brier(p,actBin);
    var r=_ret(o);if(r!=null){retArr.push(r);adverse.push(r);}
    if(o.atrNormalizedMove!=null)atrNorm.push(o.atrNormalizedMove);
    Object.keys(perClass).forEach(function(c){
      if(predBin===c){if(actBin===c)perClass[c].tp++;else perClass[c].fp++;}
    });
  });
  out.directionalAccuracy=+(correct/n*100).toFixed(1);
  out.confusion=confusion;
  out.precision={UP:pct(perClass.UP.tp,perClass.UP.tp+perClass.UP.fp),DOWN:pct(perClass.DOWN.tp,perClass.DOWN.tp+perClass.DOWN.fp),RANGE:pct(perClass.RANGE.tp,perClass.RANGE.tp+perClass.RANGE.fp)};
  out.brier=+(brierSum/n).toFixed(3);
  out.calibrationError=_calErr(settled);
  out.meanNextReturn=_avg(retArr);
  out.medianNextReturn=_median(retArr);
  out.atrNormalizedMoveMean=_avg(atrNorm);
  out.maxAdverseMovement=_min(adverse);
  out.breakdown=_breakdown(settled);
  return out;
}
function _brier(p,act){var e=0,d=0,f=0;e=act==='UP'?1:0;d=act==='DOWN'?1:0;f=act==='FLAT'?1:0;var pu=p,pd=p*(0.5),pf=(1-p);return Math.pow(pu-e,2)+Math.pow(pd-d,2)+Math.pow(pf-f,2)/3;}
function _calErr(rows){var n=rows.length;if(!n)return null;var sum=0;rows.forEach(function(o){var p=clamp01(o.forecastProb!=null?o.forecastProb:(o.heuristicScore!=null?o.heuristicScore/100:0.5));var e=(normDir(o.actualDirection)===normDir(o.direction))?(o.direction!=='RANGE'?1:0.5):0;sum+=Math.abs(p-e);});return +(sum/n).toFixed(3);}
function _breakdown(rows){function acc(key){var g={};rows.forEach(function(o){var k=String(o[key]!=null?o[key]:'NA');(g[k]=g[k]||{n:0,correct:0}).n++;if(o.correct===true)g[k].correct++;});var o={};Object.keys(g).forEach(function(k){o[k]={n:g[k].n,accuracy:+(g[k].correct/g[k].n*100).toFixed(1)};});return o;}return {tf:acc('tf'),session:acc('session'),regime:acc('regime'),news:acc('newsMode'),bbLocation:acc('bbZone'),mtf:acc('mtfAligned')};}
function normDir(d){d=String(d||'').toUpperCase();if(d.indexOf('UP')>=0)return 'UP';if(d.indexOf('DOWN')>=0)return 'DOWN';if(d.indexOf('RANGE')>=0||d==='FLAT')return 'FLAT';return 'FLAT';}
function clamp01(x){return Math.max(0,Math.min(1,x));}
function pct(a,b){return b?+(a/b*100).toFixed(1):null;}
function _avg(a){if(!a.length)return null;return +((a.reduce(function(x,y){return x+y;},0)/a.length)).toFixed(3);}
function _min(a){return a.length?+Math.min.apply(null,a).toFixed(3):null;}
function _median(a){if(!a.length)return null;var s=a.slice().sort(function(x,y){return x-y;});var m=Math.floor(s.length/2);return s.length%2?s[m]:+((s[m-1]+s[m])/2).toFixed(3);}
function n(v){return Number.isFinite(+v)?+v:null;}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAOneStepMetrics=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {summarize:summarize};});
