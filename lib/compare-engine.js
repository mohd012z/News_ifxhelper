'use strict';
/* /compare engine (spec §7). Every new forecast is automatically compared
 * against a battery of historical bases — a set of continuation rates with
 * labels, far more intellectually useful than a single confidence=73:
 *
 *   CURRENT M15 REENTRY_UP
 *     Recent 20      55%
 *     Recent 100     64%
 *     Long-term      69%
 *     Exact matches  71%
 *     Near matches   66%
 *     Current regime 57%
 *     Opposite       24%
 *     ⚠ recent deterioration
 *
 * Continuation = a settled episode whose predicted direction == actual
 * direction (the setup "worked"). Each base is a filtered slice of the settled
 * corpus. Every rate carries its sample size + a significance flag so a 3/5
 * "exact match" is never presented as solid as a 70/100 one.
 */
var FP=(typeof require!=='undefined')?require('./state-fingerprint.js'):null;
function contRate(rows){
  var sc=rows.filter(function(r){return r.correct===true;}).length;
  var den=rows.filter(function(r){return r.correct!=null;}).length;
  return {n:den,correct:sc,rate:den?+(sc/den*100).toFixed(1):null,significant:den>=10};
}
function isSettled(e){return e&&e.settled&&e.correct!=null;}
function sameSetup(e,q,opts){opts=opts||{};
  if(opts.tf!=null&&e.tf!==opts.tf)return false;
  if(opts.pattern!=null&&e.pattern!==opts.pattern)return false;
  return true;}
/**
 * compare({ query:{tf,pattern,session,newsPhase,stateId,fingerprint}, corpus })
 *  corpus: array of settled episodes (memory/episodic).
 * returns { rows:[{label,rate,n,significant,note}], flag:'deteriorating'|'improving'|null, summary }
 */
function compare(q,corpus,opts){
  q=q||{};corpus=corpus||[];opts=opts||{};
  var MIN=opts.minSamples!=null?opts.minSamples:10;
  var settled=corpus.filter(isSettled);
  /* "recent" is by recordedAt (the corpus is appended over time). */
  settled=settled.slice().sort(function(a,b){return Date.parse(a.recordedAt||0)-Date.parse(b.recordedAt||0);});
  var recent20=settled.slice(-20),recent100=settled.slice(-100);
  var exact=settled.filter(function(e){return q.stateId?e.stateId===q.stateId:(q.pattern&&e.pattern===q.pattern);});
  var near=[],opposite=[];
  settled.forEach(function(e){
    if(q.stateId&&FP&&e.state){var m=FP.matchLevel(q._canon||q,e.state);if(m.level==='NEAR'||m.level==='PATTERN_FAMILY')near.push(e);}
    if(q.pattern&&e.pattern===q.pattern&&e.correct===false)opposite.push(e); /* same setup, failed = the "opposite outcome" evidence */
  });
  var regime=settled.filter(function(e){return (q.session==null||e.session===q.session)&&(q.newsPhase==null||e.newsPhase===q.newsPhase);});
  var rows=[
    {label:'Recent 20',s:contRate(recent20.filter(function(e){return sameSetup(e,q);}))},
    {label:'Recent 100',s:contRate(recent100.filter(function(e){return sameSetup(e,q);}))},
    {label:'Long-term',s:contRate(settled.filter(function(e){return sameSetup(e,q)}))},
    {label:'Exact matches',s:contRate(exact)},
    {label:'Near matches',s:contRate(near)},
    {label:'Current regime',s:contRate(regime)}
  ];
  var out=rows.map(function(r){return {label:r.label,rate:r.s.rate,n:r.s.n,significant:r.s.significant,note:r.s.n<MIN?(r.s.n===0?'no samples':'small sample ('+r.s.n+')'):''};});
  /* deterioration: a recent base is materially below the long-term base. */
  var lt=null,r20=null;out.forEach(function(r){if(r.label==='Long-term')lt=r;if(r.label==='Recent 20')r20=r;});
  var flag=null;
  if(lt&&r20&&lt.rate!=null&&r20.rate!=null&&lt.n>=MIN&&r20.n>=5){
    if(lt.rate-r20.rate>=15)flag='recent deterioration';
    else if(r20.rate-lt.rate>=15)flag='recent improvement';
  }
  /* one-line, human-auditable summary (never a single averaged number). */
  var summary=out.filter(function(r){return r.rate!=null;}).map(function(r){return r.label+' '+r.rate+'%';}).join(' · ')+(flag?(' ⚠ '+flag):'');
  return {rows:out,flag:flag,summary:summary,oppositeOutcomes:contRate(opposite),settledSamples:settled.length};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMACompare=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {compare:compare,contRate:contRate};});
