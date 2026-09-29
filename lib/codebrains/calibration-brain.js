'use strict';
/* CalibrationBrain — §19: "are our confidence estimates truthful?"
 *
 * Converts "the model says 80%" into the question: when the model said ~80%,
 * how often was it ACTUALLY right? Buckets observations by heuristicScore and
 * compares predicted vs realized. If the 80% bucket realizes ~54%, the model is
 * OVERCONFIDENT and a correction (down-weight) is produced. It only RECOMMENDS
 * a calibration adjustment — it never auto-rewrites the model (Kernel decides).
 */
function n(v){return Number.isFinite(+v)?+v:null;}
function buckets(obs,opts){
  opts=opts||{};
  var width=opts.width||20;
  var settled=(obs||[]).filter(function(o){return o&&o.result&&(o.correct!==null&&o.correct!==undefined)&&(o._predictedScore!=null);});
  var map={};
  settled.forEach(function(o){
    var s=Math.min(100,Math.max(0,Math.round(o._predictedScore)));
    var b=Math.floor(s/width)*width;
    (map[b]=map[b]||{low:b,high:b+width-1,n:0,correct:0,predictedSum:0});
    map[b].n++;map[b].correct+=(o.correct===true?1:0);map[b].predictedSum+=o._predictedScore;
  });
  var out=[];
  Object.keys(map).sort(function(a,b){return a-b;}).forEach(function(k){
    var x=map[k];
    var avgPred=x.predictedSum/x.n;
    var realized=+(x.correct/x.n*100).toFixed(1);
    var gap=+(realized-avgPred).toFixed(1); /* negative = overconfident */
    var bias=gap<-8?'OVERCONFIDENT':gap>8?'UNDERCONFIDENT':'CALIBRATED';
    out.push({low:k,high:x.high,n:x.n,avgPredicted:+avgPred.toFixed(1),realized:realized,gap:gap,bias:bias});
  });
  return out;
}
/** overall calibration error (mean |predicted - realized| across buckets) */
function summary(obs,opts){
  var b=buckets(obs,opts);
  if(!b.length)return {ok:false,note:'not enough settled observations with predicted scores',buckets:b,calibrationError:null};
  var sum=0;
  b.forEach(function(x){sum+=Math.abs(x.gap);});
  var ce=+(sum/b.length).toFixed(1);
  return {ok:true,buckets:b,calibrationError:ce,overconfident:b.some(function(x){return x.bias==='OVERCONFIDENT';}),recommendation:ce>15?'reduce heuristic weights (systematic overconfidence)':'no adjustment needed'};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMACalibration=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {buckets:buckets,summary:summary};});
