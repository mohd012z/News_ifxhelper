'use strict';
/* F1–F4 — BBMA CANDLE-FORMATION MEMORY (formation-memory deep-dive).
 *
 * Upgrade from STATE memory ("M15 = DOWN + CSAK_DOWN") to FORMATION memory
 * ("HOW every timeframe REACHED its current state"):
 *
 *   F1  canonicalCandle   — one immutable CandleMemory object
 *                           (candleId, closed, ohlc, body, bbma, session,
 *                           provenance{provider,sourceSymbol,revision}).
 *                           Chart / engine / memory / evidence / replay all
 *                           read the SAME object — no second candle calc.
 *   F2  transitionsFor    — per-TF state machine over closed candles:
 *                           from→to tokens, barsElapsed, candleIds, events.
 *   F3  formationTree     — 3-layer MTF capture (STRUCTURE / SETUP /
 *                           TRIGGER) + cross-TF relationships
 *                           (parent/child, alignment, sequenceAge).
 *   F4  formationFingerprint — compact canonical string + sha256 id:
 *                           GC_FUTURES_PROXY H4_EXT_S|H1_MHV_S|M30_CSAK_S|
 *                           M15_MOM_S|M5_RE_S + session/news/ATR descriptor.
 *
 * Memory is partitioned by INSTRUMENT (F0, lib/instrument-memory.js): a
 * GC=F proxy formation NEVER joins the XAUUSD spot recall set.
 *
 * Event tokens follow the canonical sequence EXT → MHV → CSA → MOM → RE.
 * The current engine raises at most ONE event per candle (extreme, momentum,
 * csak, reentry — mutually exclusive in classify()); the token mapping is
 * deterministic and documented here. MHV (moving-high/low value) is a
 * structural read, not a live engine event: when no discrete event fired,
 * the trend state token is used (M15 DOWN, M30 UP, …).
 */
var CAP=(typeof require!=='undefined')?require('./snapshot-capture.js'):null;
var FP=(typeof require!=='undefined')?require('./state-fingerprint.js'):null;
var IM=(typeof require!=='undefined')?require('./instrument-memory.js'):null;
var SE=(typeof require!=='undefined')?require('./session-engine.js'):null;
var crypto=(typeof require!=='undefined')?require('crypto'):null;

/* canonical candle hierarchy + 3 layers (deep-dive §2) */
var HIERARCHY=['MN1','W1','D1','H4','H1','M30','M15','M5','M1'];
var LAYERS={
  STRUCTURE:{tfs:['MN1','W1','D1','H4'],desc:'macro context — where the market is'},
  SETUP:{tfs:['H1','M30','M15'],desc:'structure forming — the hypothesis layer'},
  TRIGGER:{tfs:['M5','M1'],desc:'execution — entry timing only'}
};
/* event-token map (deterministic). Engine fields are mutually exclusive. */
function eventToken(b){
  b=b||{};
  if(b.extreme&&b.extreme!=='NONE')return b.extreme==='EXTREME_HIGH'?'EXT':'EXT';
  if(b.momentum&&b.momentum!=='NONE')return 'MOM';
  if(b.csak&&b.csak!=='NONE')return 'CSAK';
  if(b.reentry&&b.reentry!=='NONE')return 'RE';
  if(b.csa&&b.csa!=='NONE')return 'CSA';
  return null;
}
function trendToken(b){var t=b&&b.trend;return (t==='UP'||t==='DOWN')?t:null;}
function stateToken(b){
  /* token = the strongest signal this candle, in the canonical order. */
  return eventToken(b)||trendToken(b)||'RANGE';
}
/* direction of a state token: EXT inherits extreme side via caller; keep S/U/· */
function tokenDir(tok,b){
  if(!tok)return '·';
  if(tok==='UP')return 'U';
  if(tok==='DOWN')return 'S';
  if(tok==='EXT'){return (b&&b.extreme==='EXTREME_LOW')?'S':'U';}
  if(tok==='MOM'){return (b&&b.momentum==='MOMENTUM_DOWN')?'S':'U';}
  if(tok==='CSAK'){return (b&&b.csak==='CSAK_DOWN')?'S':'U';}
  if(tok==='RE'){return (b&&b.reentry==='REENTRY_DOWN_ZONE')?'S':'U';}
  if(tok==='CSA'){return (b&&b.csa==='CSA_DOWN')?'S':'U';}
  return '·';
}
function tokenCode(tok,b){return tok+(tok==='RANGE'?'':'_'+tokenDir(tok,b));}

/* ---------- F1: canonical candle ---------- */
/* candle: raw {time,open,high,low,close,volume?}; analysis: engine classify()
   row for this candle's TF; ctx: {symbol, tf, provider, sourceSymbol, session} */
function canonicalCandle(candle,analysis,ctx){
  ctx=ctx||{};
  /* analysis may be the flat engine classify() result OR the watch
     analysis row ({bbma:{…}}) — accept both (same single authority). */
  var bb=(analysis&&(analysis.bbma||analysis))||{};
  var o=+candle.open,h=+candle.high,l=+candle.low,c=+candle.close;
  var range=Math.max(1e-12,h-l),body=Math.abs(c-o);
  var x={
    candleId:ctx.symbol+':'+ctx.tf+':'+candle.time,
    symbol:ctx.symbol||'UNKNOWN',
    timeframe:ctx.tf||'UNKNOWN',
    openTime:candle.time,
    closeTime:analysis.lastTime||candle.time,
    closed:!!(analysis.state==='READY'),
    ohlc:{open:o,high:h,low:l,close:c},
    body:{direction:c>o?'BULL':c<o?'BEAR':'DOJI',size:+(body).toFixed(4),range:+range.toFixed(4),bodyRatio:+(body/range).toFixed(4)},
    bbma:{
      zone:bb.zone||'UNKNOWN',
      event:eventToken(bb)||null,
      direction:trendToken(bb)||'MIXED',
      momentum:!!(bb.momentum&&bb.momentum!=='NONE'),
      extreme:!!(bb.extreme&&bb.extreme!=='NONE'),
      csa:!!(bb.csa&&bb.csa!=='NONE'),
      csak:!!(bb.csak&&bb.csak!=='NONE'),
      reentry:!!(bb.reentry&&bb.reentry!=='NONE'),
      state:stateToken(bb),
      ema50Relation:bb.emaGap||null
    },
    session:{name:(SE&&candle.time)?SE.sessionOf(Date.parse(candle.time)):'UNKNOWN',firstSessionCandle:false},
    provenance:{provider:ctx.provider||'UNKNOWN',sourceSymbol:ctx.sourceSymbol||ctx.symbol||'UNKNOWN',revision:1}
  };
  return CAP?CAP.deepFreeze?CAP.deepFreeze(x):x:deepFreezeLocal(x);
}
function deepFreezeLocal(o){Object.keys(o).forEach(function(k){if(o[k]&&typeof o[k]==='object')deepFreezeLocal(o[k]);});return Object.freeze(o);}

/* ---------- F2: transition state machine ---------- */
/* rows: {time, analysis} for closed candles, TIME-ASC. Produces transition
   records + the formation sequence (C-8 … C-1 tokens). */
function transitionsFor(rows,tf,ctx){
  ctx=ctx||{};
  var states=[],events=[];
  (rows||[]).forEach(function(r){
    /* rows may be {time, analysis:{bbma}} OR {time, bbma} (builder perTf) */
    var b=r&&r.analysis?(r.analysis.bbma||r.analysis):(r&&r.bbma||{});
    var t=stateToken(b);
    states.push({time:r.time,tf:tf||ctx.tf,state:t,code:tokenCode(t,b),event:eventToken(b)||null});
    var ev=eventToken(b);
    if(ev)events.push({time:r.time,event:ev,dir:tokenDir(ev,b)});
  });
  var transitions=[];
  var segStart=0; /* index of the candle where the current (from) segment began */
  for(var i=1;i<states.length;i++){
    if(states[i].state!==states[i-1].state){
      transitions.push({
        from:states[i-1].state,to:states[i].state,
        timeframe:states[i].tf,
        startCandleId:(ctx.symbol||'')+':'+states[i-1].tf+':'+states[i-1].time,
        confirmedCandleId:(ctx.symbol||'')+':'+states[i].tf+':'+states[i].time,
        barsElapsed:i-segStart, /* candles the `from` state held before this transition */
        evidence:[states[i-1].time,states[i].time]
      });
      segStart=i;
    }
  }
  return {states:states,transitions:transitions,events:events,last:states.length?states[states.length-1]:null};
}

/* ---------- F3: MTF formation tree + cross-TF graph ----------
 * analysis: the BUILDER'S per-TF canonical engine read —
 *   { M15:{bbma:{trend,momentum,extreme,csak,reentry,zone,lastTime,state}}, … }
 *   (from bbma-candle-watch.location() = bbma-engine.classify()). This lib
 *   CONSUMES engine output; it never recomputes BBMA (single authority). */
function formationTree(analysis,anchor,ctx){
  ctx=ctx||{};
  var tfData={},layers={},relationships=[];
  HIERARCHY.forEach(function(tf){
    var a=analysis&&analysis[tf];
    var b=a&&a.bbma;
    if(!b||b.state!=='READY'||!b.lastTime)return;
    var tok=stateToken(b);
    tfData[tf]={
      candleId:ctx.symbol+':'+tf+':'+b.lastTime,
      time:b.lastTime,
      state:tok,code:tokenCode(tok,b),event:eventToken(b)||null,
      direction:trendToken(b)||'MIXED',zone:b.zone||'UNKNOWN'
    };
  });
  Object.keys(LAYERS).forEach(function(L){
    var present=LAYERS[L].tfs.filter(function(tf){return tfData[tf];});
    layers[L]={desc:LAYERS[L].desc,present:present,tokens:present.map(function(tf){return tf+':'+tokenCode(tfData[tf].code);})};
  });
  /* cross-TF relationships between ADJACENT present TFs (H4→H1→M30→M15→M5) */
  var chain=HIERARCHY.filter(function(tf){return tfData[tf];});
  for(var i=0;i<chain.length-1;i++){
    var pt=tfData[chain[i]],ct=tfData[chain[i+1]];
    var alignment=(pt.direction==='UP'&&ct.direction==='UP')||(pt.direction==='DOWN'&&ct.direction==='DOWN')?'CONFIRM':(pt.direction==='MIXED'||ct.direction==='MIXED')?'NEUTRAL':'DIVERGE';
    relationships.push({parentTF:chain[i],parentState:pt.code,childTF:chain[i+1],childState:ct.code,alignment:alignment,sequenceAge:null});
  }
  var anchorTok=tfData[anchor&&anchor.tf]||null;
  var node={
    snapshotId:CAP&&CAP.idFor?CAP.idFor('FORMATION',{symbol:ctx.symbol||'',timeframe:anchor?anchor.tf:'',candleTime:anchorTok?anchorTok.time:''},'v1'):null,
    anchor:{timeframe:anchor?anchor.tf:null,candleId:anchorTok?anchorTok.candleId:null,time:anchor?anchor.time:null},
    instrument:ctx.symbol||'UNKNOWN',
    memoryRoot:IM?IM.memoryRoot(ctx.instrument||{canonicalId:ctx.symbol}):null,
    tf:tfData,layers:layers,relationships:relationships
  };
  return CAP?CAP.deepFreeze?CAP.deepFreeze(node):node:deepFreezeLocal(node);
}

/* ---------- F4: formation fingerprint ---------- */
/* frames/anchor/ctx as formationTree + descriptor {session, newsPhase, atrBand} */
function formationFingerprint(node,descriptor){
  /* M1 is NOISE for the fingerprint (1-min state flips constantly and would
     churn the formation id); the tree KEEPS it in tf/layers for display. */
  var fpPart=HIERARCHY.filter(function(tf){return tf!=='M1'&&node.tf[tf];})
    .map(function(tf){return tf+'_'+node.tf[tf].code;}).join('|');
  var d=descriptor||{};
  var tail=[d.session,d.newsPhase,d.atrBand].filter(Boolean).join('_')||'·';
  var str=(node.memoryRoot||'UNKNOWN')+' '+fpPart+' '+tail;
  return {fingerprint:str,stateId:crypto?crypto.createHash('sha256').update(str).digest('hex').slice(0,24):null};
}

/* ---------- F3b: formation history (last N tokens per TF) ---------- */
function formationHistory(rows,tf,n){
  var t=transitionsFor(rows,tf);
  var last=(n||20);
  return t.states.slice(-last);
}

/* ---------- F5: multi-horizon settlement (deep-dive §8) ----------
 * The exact-next-candle settle stays the primary verdict; this ADDS the
 * formation-relevant horizons so "one UP candle before a strong drop"
 * teaches a DIFFERENT lesson than "completely invalid":
 *   plus1/plus2/plus3/plus5 (direction + return vs anchor close)
 *   mfePct/maePct — direction-aware over the covered horizons
 *   nextState/barsToNextState — first BBMA state transition after the anchor
 *   plus1Against — first candle went against the call
 * frames: {TF:[{time,open,high,low,close}…]} (raw closed candles, asc).
 * tokensByTime: {candleTime: stateToken} for candles after the anchor
 *   (precomputed by the caller via the canonical engine — this lib stays
 *   free of a second BBMA calculation).
 */
var HORIZONS={plus1:1,plus2:2,plus3:3,plus5:5};
function multiHorizon(obs,frames,tokensByTime){
  tokensByTime=tokensByTime||{};
  if(!obs||!frames)return null;
  var tf=obs.tf,arr=(frames[tf]||[]).slice();
  arr.sort(function(a,b){return Date.parse(a.time)-Date.parse(b.time);});
  var idx=-1;
  for(var i=0;i<arr.length;i++){if(arr[i].time===obs.candleTime){idx=i;break;}}
  if(idx<0)return null;
  var base=arr[idx];
  var pred=(obs.state||'').indexOf('UP')===0?'UP':(obs.state||'').indexOf('DOWN')===0?'DOWN':'UNKNOWN';
  var ownTok=obs.bbma?stateToken(obs.bbma):null;
  var out={tf:tf,anchorCandleTime:obs.candleTime,predictedDirection:pred,plus:{},mfePct:null,maePct:null,nextState:null,barsToNextState:null,plus1Against:null,complete:false};
  var hi=-Infinity,lo=Infinity,covered=0;
  Object.keys(HORIZONS).forEach(function(k){
    var j=idx+HORIZONS[k];
    if(j>=arr.length)return;
    var c=arr[j];
    var dir=c.close>c.open?'UP':c.close<c.open?'DOWN':'FLAT';
    out.plus[k]={time:c.time,direction:dir,returnPct:+((c.close-base.close)/base.close*100).toFixed(4)};
    hi=Math.max(hi,+c.high);lo=Math.min(lo,+c.low);covered++;
  });
  if(covered){
    if(pred==='DOWN'){out.mfePct=+((lo-base.close)/base.close*100).toFixed(4);out.maePct=+((hi-base.close)/base.close*100).toFixed(4);}
    else if(pred==='UP'){out.mfePct=+((hi-base.close)/base.close*100).toFixed(4);out.maePct=+((lo-base.close)/base.close*100).toFixed(4);}
  }
  if(out.plus.plus1)out.plus1Against=pred!=='UNKNOWN'&&out.plus.plus1.direction!==pred;
  Object.keys(out.plus).sort().forEach(function(k){
    var tk=tokensByTime[out.plus[k].time];
    if(tk&&ownTok&&tk!==ownTok&&!out.nextState){out.nextState=tk;out.barsToNextState=HORIZONS[k];}
  });
  out.complete=(covered===Object.keys(HORIZONS).length);
  return out;
}

function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAFormationMemory=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {HIERARCHY:HIERARCHY,LAYERS:LAYERS,eventToken:eventToken,stateToken:stateToken,tokenCode:tokenCode,canonicalCandle:canonicalCandle,transitionsFor:transitionsFor,formationTree:formationTree,formationFingerprint:formationFingerprint,formationHistory:formationHistory,multiHorizon:multiHorizon};});
