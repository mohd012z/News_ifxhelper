'use strict';
/* /identify — canonical setup FINGERPRINT (spec §3).
 *
 * Every observed market state is reduced to a canonical, ORDER-INDEPENDENT
 * descriptor so History-360 can compare setups in O(1) instead of scanning
 * arbitrary JSON. A human-readable fingerprint plus a stable hash:
 *
 *   fingerprint string:  GOLD M15 REENTRY_UP LOW_BB H1_UP H4_RANGE ATR_HIGH NY_OPEN PRE_CPI
 *   stateId:             sha256(canonicalJson)
 *
 * The fingerprint is the join-key across the prediction ledger, the similarity
 * corpus, and counterfactual memory — so a stable, deterministic normalisation
 * is critical (no timestamps, no floating drift, sorted fields, upper-cased).
 *
 * ATR band + session are DERIVED from the real candle array (never assumed),
 * so a fingerprint is reproducible from market data alone.
 */
var crypto=(typeof require!=='undefined')?require('crypto'):null;
/* ATR band: 14-period ATR as a percentile of the last 500 candles. We band it
   to LOW/NORMAL/HIGH/VERY_HIGH so the fingerprint stays coarse + stable (a
   one-tick ATR move must not mint a new stateId). */
var ATR_PERIOD=14,ATR_WINDOW=500;
function atrPctile(candles){
  if(!candles||candles.length<ATR_PERIOD+2)return null;
  function tr(c,p){var h=+c.high,l=+c.low,pc=+p.close;if(!Number.isFinite(h+l+pc))return null;return Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc));}
  var trs=[];
  for(var i=1;i<candles.length;i++){var t=tr(candles[i],candles[i-1]);if(t!=null)trs.push(t);}
  if(trs.length<ATR_PERIOD)return null;
  function atrAt(i){var s=0;for(var k=0;k<ATR_PERIOD;k++)s+=trs[i-k];return s/ATR_PERIOD;}
  var last=atrAt(trs.length-1);
  if(last==null)return null;
  var lo=Math.max(0,Math.min(trs.length-ATR_WINDOW,0)),hi=trs.length;
  var seen=[];for(var j=Math.max(ATR_PERIOD-1,lo);j<hi;j++){var a=atrAt(j);if(a!=null)seen.push(a);}
  if(!seen.length)return null;
  var below=seen.filter(function(x){return x<last;}).length;
  var p=below/seen.length;
  if(p<0.25)return 'LOW';if(p<0.75)return 'NORMAL';if(p<0.95)return 'HIGH';return 'VERY_HIGH';
}
/* Session band from a UTC timestamp (matches the chart-zone vocabulary:
   Tokyo 00:00 UTC, US 13:30 UTC). Returns a coarse label so the fingerprint is
   stable across the whole session, not per-minute. */
function sessionOf(timeIso){
  var d=new Date(timeIso);if(!timeIso||isNaN(d.getTime()))return 'UNKNOWN';
  var h=d.getUTCHours()+d.getUTCMinutes()/60;
  var day=d.getUTCDay();if(day===0||day===6)return 'WEEKEND';
  if(h>=0&&h<7)return 'TOKYO';
  if(h>=7&&h<13.5)return 'LONDON';
  if(h>=13.5&&h<21)return 'NEW_YORK';
  return 'ASIA_OVERNIGHT';
}
function normAsset(sym){var s=String(sym||'').replace(/[^a-z0-9]/gi,'').toUpperCase();return (s==='XAUUSD'||s==='XAU'||s==='GOLD'||s==='GCF')?'GOLD':(s==='XAGUSD'||s==='XAG'||s==='SILVER'||s==='SIF')?'SILVER':(s||'UNKNOWN');}
function htfOf(dashboard,tfs){var out={};(tfs||['H1','H4']).forEach(function(tf){var row=(dashboard&&dashboard.rows||[]).find(function(r){return r.tf===tf;});var t=row?(row.trend||'').toUpperCase():'UNKNOWN';out[tf]=(['UP','DOWN'].indexOf(t)>=0)?t:(t==='MIXED'||t==='RANGE_OR_TRANSITION'?'RANGE':t||'UNKNOWN');});return out;}
function newsPhaseOf(news){var st=(news&&news.state||'NO_EVENT').toUpperCase();var ev=(news&&news.event&&news.event.title||'');var code=/[A-Z]{2,}/.test(ev)?ev.replace(/[^A-Z0-9]/g,'').slice(0,8):'EV';return st==='NO_EVENT'||st==='NORMAL'?'NO_NEWS':(st+'_'+code).slice(0,24);}
function patternOf(analysis){if(!analysis||!analysis.bbma)return 'NONE';var b=analysis.bbma;if(b.momentum&&b.momentum!=='NONE')return b.momentum;if(b.reentry&&b.reentry!=='NONE')return b.reentry;if(b.csak&&b.csak!=='NONE')return b.csak;if(b.extreme&&b.extreme!=='NONE')return b.extreme;return b.trend||'NONE';}
/**
 * normalizeState(raw) -> canonical state.
 * raw: { asset, tf, analysis, dashboard, news, candles }
 * returns a FROZEN, key-sorted, timestamp-free object.
 */
function normalizeState(raw){
  raw=raw||{};
  var last=(raw.candles&&raw.candles.length)?raw.candles[raw.candles.length-1]:null;
  var s={
    asset:normAsset(raw.asset),
    tf:String(raw.tf||'UNKNOWN').toUpperCase(),
    pattern:(raw.pattern||patternOf(raw.analysis)).toUpperCase(),
    bbmaZone:(raw.analysis&&raw.analysis.bbma&&raw.analysis.bbma.zone||raw.zone||'UNKNOWN').toUpperCase(),
    htf:htfOf(raw.dashboard),
    atr:(raw.atr||atrPctile(raw.candles)||'UNKNOWN'),
    session:(raw.session||sessionOf(last?last.time:null)),
    newsPhase:(raw.newsPhase||newsPhaseOf(raw.news))
  };
  /* key-sorted, deterministic (no timestamps, no float drift). */
  var canon={};Object.keys(s).sort().forEach(function(k){canon[k]=s[k];});
  return Object.freeze(canon);
}
function canonicalJson(st){
  return JSON.stringify(Object.keys(st).sort().map(function(k){
    var v=st[k];
    if(v&&typeof v==='object'){
      var inner=Object.keys(v).sort().map(function(k2){return v[k2];}).join(',');
      return k+'={'+inner+'}';
    }
    return k+'='+v;
  }));
}
function stateId(st){if(!crypto)return null;return crypto.createHash('sha256').update(canonicalJson(st)).digest('hex').slice(0,24);}
function fingerprint(st){
  st=st||{};
  return [st.asset,st.tf,st.pattern,st.bbmaZone,
    (st.htf&&st.htf.H1?('H1_'+st.htf.H1):'H1_?'),
    (st.htf&&st.htf.H4?('H4_'+st.htf.H4):'H4_?'),
    'ATR_'+st.atr,st.session,st.newsPhase].join(' ');
}
/** Match level between two canonical states + the reasons (explainable). */
function matchLevel(a,b){
  a=normalizeState(a);b=normalizeState(b);
  var same=[];var diff=[];
  ['tf','pattern','bbmaZone','atr','session','newsPhase'].forEach(function(k){
    (a[k]===b[k]?same:diff).push(k);
  });
  ['H1','H4'].forEach(function(tf){((a.htf&&a.htf[tf])==(b.htf&&b.htf[tf])?same:diff).push('htf.'+tf);});
  var allSame=diff.length===0;
  if(allSame)return {level:'EXACT',stateIdA:stateId(a),stateIdB:stateId(b),same:same,different:[]};
  /* NEAR: only ONE dimension differs. */
  if(diff.length===1)return {level:'NEAR',stateIdA:stateId(a),stateIdB:stateId(b),same:same,different:diff};
  /* PATTERN_FAMILY: same tf + same pattern (the setup), rest may differ. */
  if(a.tf===b.tf&&a.pattern===b.pattern)return {level:'PATTERN_FAMILY',stateIdA:stateId(a),stateIdB:stateId(b),same:same,different:diff};
  /* REGIME: same asset + same session + same news phase (broad market condition). */
  if(a.asset===b.asset&&a.session===b.session&&a.newsPhase===b.newsPhase)return {level:'REGIME',stateIdA:stateId(a),stateIdB:stateId(b),same:same,different:diff};
  return {level:'NONE',stateIdA:stateId(a),stateIdB:stateId(b),same:same,different:diff};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAFingerprint=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {normalizeState:normalizeState,canonicalJson:canonicalJson,stateId:stateId,fingerprint:fingerprint,matchLevel:matchLevel,atrPctile:atrPctile,sessionOf:sessionOf,normAsset:normAsset};});
