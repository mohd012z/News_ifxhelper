'use strict';
/* ConsensusEngine + VerificationGate (§8/§20/§21).
 *
 * Combines the brains and DECIDES whether a CANDIDATE forecast may become a
 * PENDING shadow observation. The hard gate is deterministic — the in_ai
 * sidecar can only EXPLAIN/CONTRADICT, never promote. This is what keeps the
 * LLM out of the prediction path ("AI is a research/forecast layer, not
 * execution").
 *
 * Verification rules (any failing rule -> status REJECTED, with the driver):
 *   1. dataClass must be OBSERVED | DERIVED_FROM_OBSERVED (P0-C).
 *   2. candleClose must be a CLOSED candle (P0-B).
 *   3. instrument must be explicit (P0-A) — no anonymous series.
 *   4. news must pass (CLEAR/NO_EVENT) for a PUBLISHABLE forecast; otherwise
 *      it may still be SHADOW (research) but flagged, never a live alert.
 *   5. shadowMode: even a fully-verified candidate is marked SHADOW — it is
 *      observed and settled, but is NOT used for alert direction (§21).
 * The in_ai verdict (§20 token) is ATTACHED but not required to publish.
 */
var DC=(typeof require!=='undefined')?require('./data-class.js'):null;
function verify(candidate,snap,opts){
  opts=opts||{};
  var drivers=[];
  if(!candidate||candidate.status==='REJECTED'){drivers.push('candidate rejected by engine');}
  var dc=snap&&snap.dataClass;
  if(DC){var r=DC.isPredictable(dc);if(!r)drivers.push('dataClass not prediction-eligible: '+dc);}
  if(snap&&snap.candleClose==null)drivers.push('no closed anchor candle');
  var inst=snap&&snap.instrumentId;
  if(inst==null||inst==='UNKNOWN')drivers.push('instrument identity missing');
  var newsPass=candidate&&candidate.regime?candidate.regime.newsPass:(snap&&(snap.news&&/^(CLEAR|NO_EVENT|NO_NEWS|NORMAL)$/i.test(snap.news.mode||'')));
  var publishable=drivers.length===0&&newsPass;
  /* shadow is ALWAYS the default at this stage (§21) */
  var shadow=opts.shadow!==false; /* shadow=true unless explicitly disabled */
  var status=drivers.length>0?'REJECTED':(shadow?'PENDING_SHADOW':'PENDING');
  return {
    schema:'VerificationGate/v1',
    status:status,
    publishable:publishable,
    shadow:shadow,
    drivers:drivers,
    newsPass:newsPass,
    aiVerdict:opts.aiVerdict||null, /* in_ai /market-one-step-review verdict, informational */
    aiCanPublish:false /* §20: the agent token is denied evidence.delete / CONFIRMED; deterministic gate decides */
  };
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAConsensus=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {verify:verify};});
