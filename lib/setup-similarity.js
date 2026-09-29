'use strict';
/* /similarity — explainable top-k nearest-situation engine (spec §4).
 *
 * Move beyond exact matches. The current state is reduced to a small, HUMAN-
 * AUDITABLE feature vector (continuous + categorical). Similarity to a stored
 * episode is a WEIGHTED per-dimension agreement, and the result carries the
 * SAME / DIFFERENT dimensions explicitly — we NEVER hand IN_AI a mystery
 * vector score alone:
 *
 *   Similarity 91%
 *     same:      ✓ M15 RE-ENTRY ✓ LOW_BB ✓ H1 UP ✓ NY session
 *     different: ⚠ H4 RANGE ⚠ volatility higher
 *
 * Continuous dimensions use a linear falloff (1 - |a-b|/scale); categorical
 * dimensions are exact (1 or 0). Weights sum to 1.
 */
var FP=(typeof require!=='undefined')?require('./state-fingerprint.js'):null;

function nz(x){return Number.isFinite(+x)?+x:null;}
/* --- continuous features, computed from the REAL candle array (provable) --- */
function bodyRatio(c){var r=nz(c.high)-nz(c.low);if(!r||r<=0)return null;var b=Math.abs(nz(c.close)-nz(c.open));return Math.max(0,Math.min(1,b/r));}
function upperWick(c){var r=nz(c.high)-nz(c.low);if(!r||r<=0)return null;var w=nz(c.high)-Math.max(nz(c.open),nz(c.close));return Math.max(0,Math.min(1,w/r));}
function lowerWick(c){var r=nz(c.high)-nz(c.low);if(!r||r<=0)return null;var w=Math.min(nz(c.open),nz(c.close))-nz(c.low);return Math.max(0,Math.min(1,w/r));}
function rangePct(c,windowCloses){var r=nz(c.high)-nz(c.low);var mid=nz(c.close);return (r&&mid)?Math.min(1,r/Math.abs(mid)/10):null;} /* ~0.1% scale */
function trendStrength(candles,n){n=n||6;if(!candles||candles.length<n+1)return null;var a=nz(candles[candles.length-1].close),b=nz(candles[candles.length-1-n].close);if(a==null||b==null||!b)return null;var d=(a-b)/Math.abs(b);return Math.max(-1,Math.min(1,d*100));} /* ~1% scale */
function atrPct01(candles){var band=FP?FP.atrPctile(candles):null;if(!band)return null;return {LOW:0.125,NORMAL:0.5,HIGH:0.85,VERY_HIGH:0.97}[band]||null;}

/**
 * vectorize({candles, analysis, dashboard, news, tf}) ->
 * { numeric:{bodyRatio,upperWick,lowerWick,rangePct,trendStrength,atrPct},
 *   categorical:{tf,zone,pattern,session,newsPhase,htfH1,htfH4} }
 */
function vectorize(raw){
  raw=raw||{};
  var last=(raw.candles&&raw.candles.length)?raw.candles[raw.candles.length-1]:null;
  var closes=raw.candles?raw.candles.map(function(c){return nz(c.close);}):[];
  var canon=(FP&&raw.candles)?FP.normalizeState({asset:raw.asset,tf:raw.tf,analysis:raw.analysis,dashboard:raw.dashboard,news:raw.news,candles:raw.candles}):{};
  return {
    numeric:{
      bodyRatio:last?bodyRatio(last):null,
      upperWick:last?upperWick(last):null,
      lowerWick:last?lowerWick(last):null,
      rangePct:last?rangePct(last,closes):null,
      trendStrength:trendStrength(raw.candles),
      atrPct:atrPct01(raw.candles)
    },
    categorical:{
      tf:String(raw.tf||canon.tf||'UNKNOWN').toUpperCase(),
      zone:(canon.bbmaZone||'UNKNOWN'),
      pattern:(canon.pattern||'NONE'),
      session:(canon.session||'UNKNOWN'),
      newsPhase:(canon.newsPhase||'NO_NEWS'),
      htfH1:(canon.htf&&canon.htf.H1)||'UNKNOWN',
      htfH4:(canon.htf&&canon.htf.H4)||'UNKNOWN'
    }
  };
}
var DEFAULT_WEIGHTS={bodyRatio:0.10,upperWick:0.08,lowerWick:0.08,rangePct:0.10,trendStrength:0.14,atrPct:0.12,
  tf:0.08,zone:0.08,pattern:0.10,session:0.04,newsPhase:0.06,htfH1:0.06,htfH4:0.06};
function linear(a,b,scale){if(a==null||b==null)return null;return Math.max(0,1-Math.abs(a-b)/scale);}
function exact(a,b){if(a==null||b==null)return null;return a===b?1:0;}
/** Per-dimension similarity + explainable same/different. */
function similarity(vA,vB,weights){
  weights=weights||DEFAULT_WEIGHTS;
  var cont=[['bodyRatio',0.5],['upperWick',0.6],['lowerWick',0.6],['rangePct',0.5],['trendStrength',1.0],['atrPct',0.5]];
  var cat=[['tf'],['zone'],['pattern'],['session'],['newsPhase'],['htfH1'],['htfH4']];
  var perDim={};var num=0,den=0;var same=[],diff=[];
  cont.forEach(function(spec){
    var k=spec[0],sc=spec[1];
    var s=linear(vA.numeric&&vA.numeric[k],vB.numeric&&vB.numeric[k],sc);
    if(s==null)return;
    perDim[k]={sim:+s.toFixed(3),a:vA.numeric&&vA.numeric[k],b:vB.numeric&&vB.numeric[k]};
    var w=weights[k]||0;num+=s*w;den+=w;
    if(s>=0.7)same.push(k);else diff.push(k);
  });
  cat.forEach(function(spec){
    var k=spec[0];
    var s=exact(vA.categorical&&vA.categorical[k],vB.categorical&&vB.categorical[k]);
    if(s==null)return;
    perDim[k]={sim:s,a:vA.categorical&&vA.categorical[k],b:vB.categorical&&vB.categorical[k]};
    var w=weights[k]||0;num+=s*w;den+=w;
    if(s>=1)same.push(k);else diff.push(k);
  });
  var pct=den?Math.round(100*num/den):0;
  return {pct:pct,same:same,different:diff,perDim:perDim};
}
/** Top-k nearest episodes. Each corpus item: { id, vec, settled, continuation?, ... }. */
function nearest(corpus,vec,weights,k){
  k=k||10;
  return (corpus||[])
    .map(function(rec){
      var s=similarity(rec.vec,vec,weights);
      return {id:rec.id,pct:s.pct,same:s.same,different:s.different,settled:!!rec.settled,continuation:rec.continuation,prediction:rec.prediction,createdAt:rec.createdAt};
    })
    .sort(function(a,b){return b.pct-a.pct;})
    .slice(0,k);
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMASimilarity=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {vectorize:vectorize,similarity:similarity,nearest:nearest,DEFAULT_WEIGHTS:DEFAULT_WEIGHTS,cont:{},bodyRatio:bodyRatio,upperWick:upperWick,lowerWick:lowerWick,trendStrength:trendStrength};});
