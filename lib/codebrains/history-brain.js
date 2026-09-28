'use strict';
/* HistoryBrain — "what happened in similar cases?" (P2).
 *
 * Composes the EXISTING engines (no duplicate):
 *   1. news-level-reaction-history.js  — reaction stats over exact signature
 *   2. ../ai/empirical-memory.js       — hierarchical L1..L4 analogue matching
 *
 * Returns up/down/flat rates for the requested horizon with n, and falls back
 * from exact -> hierarchical. If even the coarsest level is thin:
 *   status: INSUFFICIENT_HISTORY  (never forces a claim).
 */
var H=(typeof require!=='undefined')?require('../news-level-reaction-history.js'):null;
var EM=(typeof require!=='undefined')?require('../ai/empirical-memory.js'):null;
function _rate(obj){if(!obj)return null;return {n:obj.n,upRate:obj.upRate,downRate:obj.downRate,flatRate:obj.flatRate,avgPct:obj.avgPct};}
/**
 * match({ horizon (default 'M15'), current (news-level signature fields),
 *         query (empirical query), corpus (settled episodes), minSamples })
 * current: { category, importance, surprise, zone, behavior, mtf, atrPct, bbWidthPct }
 * returns { status, source, horizon, stats, level, n }
 */
function match(inp){
  inp=inp||{};
  var horizon=inp.horizon||'M15';
  var min=inp.minSamples!=null?inp.minSamples:8;
  /* path 1: reaction-history exact signature (news-driven setups) */
  if(H&&inp.records&&inp.records.length&&inp.current){
    var rows=H.comparable(inp.records,Object.assign({},inp.current,{quality:'EXACT'}));
    var st=H.stats(rows);
    var x=st&&st.horizons?st.horizons[horizon]:null;
    if(x&&x.n>=min)return {status:'OK',source:'reaction-history',horizon:horizon,stats:_rate(x),n:x.n,level:'EXACT'};
  }
  /* path 2: hierarchical analogue over settled episodes */
  if(EM&&inp.corpus&&inp.corpus.length&&inp.query){
    var m=EM.match(inp.query,inp.corpus,{minSamples:min});
    if(m.ok)return {status:'OK',source:'hierarchical-empirical',horizon:'M15',stats:{n:m.rate.n,upRate:m.rate.rate,downRate:+(100-m.rate.rate).toFixed(1),flatRate:0},n:m.rate.n,level:m.level,basis:m.basis};
    return {status:'INSUFFICIENT_HISTORY',source:'hierarchical-empirical',horizon:horizon,stats:m.rate?_rate(m.rate):null,n:m.samples,level:m.level,note:m.note};
  }
  return {status:'INSUFFICIENT_HISTORY',source:'none',horizon:horizon,stats:null,n:0,level:'NONE',note:'no reaction-history records and no settled episode corpus'};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAHistoryBrain=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {match:match};});
