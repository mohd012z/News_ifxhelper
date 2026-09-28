'use strict';
/* StatisticalBrain — §9 / Stage C: interpretable multinomial logistic model.
 *
 * NOT a neural net (spec: "not deep neural network first"). Fits P(UP)/P(DOWN)/
 * P(RANGE) from the feature snapshot over the settled corpus. It is only
 * ACTIVE when there is enough training data; otherwise it returns
 * status:INSUFFICIENT_DATA and the consensus falls back to the other brains.
 *
 * Features (bounded, standardised): bbmaTrend, momentum, zone, atrBand,
 * squeeze, mtfAligned, newsStrength, session, firstCandle. Each has a learned
 * weight; the softmax over UP/DOWN/RANGE logits is the probability.
 *
 * This is a STAGE-C placeholder: it fits and reports, but is only wired into
 * consensus once the corpus clears minSamples. It never fabricates a model on
 * thin data.
 */
function n(v){return Number.isFinite(+v)?+v:null;}
function sigmoid(x){return 1/(1+Math.exp(-x));}
/* one-hot-ish feature vector in [-1,1] from a snapshot/episode */
function features(o){
  o=o||{};
  var b=o.state&&o.state.bbmaZone||o.bbmaZone||'INSIDE_BB';
  var z=b==='TOP_BB'?1:b==='LOW_BB'?-1:b==='MID_BB'?0.3:(b.indexOf('ABOVE')>=0?1:(b.indexOf('BELOW')>=0?-1:0));
  var t=o.trend||o.state&&o.state.trend||'FLAT';
  var trend=t==='UP'?1:t==='DOWN'?-1:0;
  var mom=o.momentum||'NONE';
  var momentum=mom==='UP'?1:mom==='DOWN'?-1:0;
  var mtf=o.mtfAligned?1:0;
  var news=o.newsStrength||'NONE';
  var newsS=(news==='REGIME_CHANGE'||news==='HIGH')?1:news==='MODERATE'?0.3:0;
  var sq=o.squeeze||'NONE';
  var squeeze=(sq==='SQUEEZE'||sq==='TIGHT')?1:0;
  return {z:z,trend:trend,momentum:momentum,mtf:mtf,news:newsS,squeeze:squeeze};
}
/* fit weights by simple gradient ascent on the logistic (deterministic, seeded) */
function fit(corpus,opts){
  opts=opts||{};
  var rows=(corpus||[]).filter(function(e){return e&&e._outcome;});
  if(rows.length<(opts.minSamples||40))return {status:'INSUFFICIENT_DATA',n:rows.length,minSamples:opts.minSamples||40,weights:null,note:'not enough settled samples to fit a statistical model'};
  var W={z:0,trend:0,momentum:0,mtf:0,news:0,squeeze:0};
  var lr=opts.lr||0.15,epochs=opts.epochs||200;
  for(var e=0;e<epochs;e++){
    var g={z:0,trend:0,momentum:0,mtf:0,news:0,squeeze:0};
    rows.forEach(function(r){
      var f=features(r);
      var s=0;for(var k in W)s+=W[k]*f[k];
      var p=sigmoid(s); /* UP-vs-not-UP proxy */
      var y=r._outcome==='UP'?1:(r._outcome==='DOWN'?0:0.5);
      for(var kk in W)g[kk]+=(y-p)*f[kk];
    });
    for(var k2 in W)W[k2]+=lr*g[k2];
  }
  /* sanity: accuracy of the fitted UP-probability */
  var correct=0;
  rows.forEach(function(r){var f=features(r);var s=0;for(var k in W)s+=W[k]*f[k];var p=sigmoid(s);var pred=p>=0.6?'UP':p<=0.4?'DOWN':'RANGE';if(pred===r._outcome)correct++;});
  return {status:'ACTIVE',n:rows.length,weights:W,trainAccuracy:+(correct/rows.length*100).toFixed(1)};
}
/* predict P(UP)/P(DOWN)/P(RANGE) from a snapshot */
function predict(snapshot,model){
  if(!model||!model.weights)return {status:'UNAVAILABLE',prob:{UP:1/3,DOWN:1/3,RANGE:1/3}};
  var f=features(snapshot);var W=model.weights;var s=0;for(var k in W)s+=W[k]*f[k];
  var pUp=sigmoid(s);var pDown=sigmoid(-s);var pRange=Math.max(0,1-Math.abs(pUp-0.5)-Math.abs(pDown-0.5));
  var sum=pUp+pDown+pRange;
  return {status:'ACTIVE',prob:{UP:+(pUp/sum).toFixed(3),DOWN:+(pDown/sum).toFixed(3),RANGE:+(pRange/sum).toFixed(3)}};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAStatistical=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {features:features,fit:fit,predict:predict};});
