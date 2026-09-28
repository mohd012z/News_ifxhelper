'use strict';
/* EmpiricalMemory — hierarchical analogue matching (P4 / §11).
 *
 * Instead of exact-matching only, walk a ladder of progressively coarser
 * signatures. Use the FINEST level that has enough samples; if even the
 * coarsest is thin, return UNKNOWN (never force a prediction on thin history):
 *
 *   L1  event + tf + bbma + zone + volatility + session
 *   L2  tf + bbma + zone + volatility + session
 *   L3  tf + bbma + zone
 *   L4  tf + trend
 *   < minSamples => UNKNOWN
 *
 * Each returned rate carries n (sample size) so a caller can judge strength.
 * "bbma" is the dominant BBMA pattern token; a comparable historical case is a
 * settled episode whose signature matches at that level.
 */
var FP=(typeof require!=='undefined')?require('../state-fingerprint.js'):null;
function bbmaToken(ep){var b=ep&&ep.state&&ep.state.pattern;return (b&&b!=='NONE')?b:(ep&&ep.pattern); }
function volBand(ep){return (ep&&ep.state&&ep.state.atr)||null;}
function sessionOf(ep){return (ep&&ep.state&&ep.state.session)||(ep&&ep.session)||null;}
function zoneOf(ep){return (ep&&ep.state&&ep.state.bbmaZone)||(ep&&ep.bbmaZone)||null;}
function trendOf(ep){return (ep&&ep.state&&ep.state.htf&&ep.state.htf.H1)||(ep&&ep.state&&ep.state.trend)||null;}
function newsOf(ep){return (ep&&ep.state&&ep.state.newsPhase)||(ep&&ep.newsPhase)||null;}
function rate(rows){var sc=rows.filter(function(r){return r.correct===true;}).length;var den=rows.filter(function(r){return r.correct!=null;}).length;return {n:den,correct:sc,rate:den?+(sc/den*100).toFixed(1):null};}
/**
 * match(query, corpus, opts)
 *  query:  { tf, bbma, zone, volatility, session, news, trend } (from snapshot)
 *  corpus: settled episodes (memory/episodic)
 *  opts:   { minSamples (default 8) }
 * returns { level, rate:{n,correct,rate}, basis, samples }  (rate null if UNKNOWN)
 */
function match(query,corpus,opts){
  query=query||{};corpus=corpus||[];opts=opts||{};
  var min=opts.minSamples!=null?opts.minSamples:8;
  var settled=corpus.filter(function(e){return e&&e.settled&&e.correct!=null;});
  var levels=[
    {name:'L1',keys:['news','tf','bbma','zone','volatility','session']},
    {name:'L2',keys:['tf','bbma','zone','volatility','session']},
    {name:'L3',keys:['tf','bbma','zone']},
    {name:'L4',keys:['tf','trend']}
  ];
  function valFor(key,ep,q){
    if(key==='tf')return (ep.tf||'')==='.'?null:q.tf; /* tf equality */
    if(key==='news')return newsOf(ep);
    if(key==='bbma')return bbmaToken(ep);
    if(key==='zone')return zoneOf(ep);
    if(key==='volatility')return volBand(ep);
    if(key==='session')return sessionOf(ep);
    if(key==='trend')return trendOf(ep);
    return null;
  }
  function qValFor(key){
    if(key==='tf')return query.tf;
    if(key==='news')return query.news;
    if(key==='bbma')return query.bbma;
    if(key==='zone')return query.zone;
    if(key==='volatility')return query.volatility;
    if(key==='session')return query.session;
    if(key==='trend')return query.trend;
    return null;
  }
  for(var i=0;i<levels.length;i++){
    var lv=levels[i];
    var basis=lv.keys.join('+');
    /* a query key that is null/undefined is "unknown" -> can't be a hard
       constraint at this level (fall through to the coarser level). */
    var usable=lv.keys.every(function(k){var v=qValFor(k);return v!=null&&v!=='';});
    if(!usable)continue;
    var rows=settled.filter(function(ep){
      return lv.keys.every(function(k){
        var qv=qValFor(k);if(qv==null)return true;
        var ev=(k==='tf')?ep.tf:valFor(k,ep);
        return String(ev)===String(qv);
      });
    });
    var r=rate(rows);
    if(r.n>=min)return {level:lv.name,rate:r,basis:basis,samples:r.n,ok:true};
    /* remember the coarsest-thus-far result for the "insufficient" trail */
    levels[i]._last=r;
  }
  /* nothing reached minSamples -> UNKNOWN (do not force a claim) */
  var last=levels[levels.length-1]._last||null;
  return {level:'NONE',rate:last&&last.n>0?last:null,basis:'insufficient samples',samples:last?last.n:0,ok:false,note:'No empirical claim (thinnest level had '+(last?last.n:0)+' samples < '+min+')'};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAEmpiricalMemory=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {match:match,rate:rate};});
