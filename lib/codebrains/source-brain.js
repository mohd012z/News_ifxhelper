'use strict';
/* SourceBrain — "where does this data actually come from?" (CodeBrains P0).
 *
 * Explicit instrument identity so we NEVER treat GC=F futures, XAUUSD spot and
 * XAUt proxy as one series. Wraps lib/instrument.js (the provenance authority)
 * and adds a canonical source id. Rule: if the source is a proxy, any forecast
 * must be labeled as such and the confidence engine carries it as a prohibition.
 */
var I=(typeof require!=='undefined')?require('../instrument.js'):null;
/* canonical source ids (§2) */
var IDS={XAUUSD_SPOT:'XAUUSD_SPOT',GC_FUTURES:'GC_FUTURES',XAUSDT_PROXY:'XAUSDT_PROXY',BTCUSD:'BTCUSD',EURUSD:'EURUSD',UNKNOWN:'UNKNOWN'};
function resolveId(instrument){
  var p=String((instrument&&instrument.providerSymbol)||'');
  if(!p||/[?]/.test(p))return IDS.UNKNOWN; /* unrecognizable symbol -> never merge */
  if(/GC=F/.test(p))return IDS.GC_FUTURES;
  if(/XAUt|PAXG|TETHER/i.test(p))return IDS.XAUSDT_PROXY;
  if(/XAU/i.test(p)&&String(instrument.marketType).toUpperCase()==='SPOT')return IDS.XAUUSD_SPOT;
  return IDS.UNKNOWN;
}
/**
 * identify({ providerSymbol, analysisSymbol, marketType, source })
 * returns { id, instrument, isProxy, proxyFor, mayPredict, note }
 */
function identify(inp){
  inp=inp||{};
  var inst=I?I.instrument(inp):{providerSymbol:inp.providerSymbol||'UNKNOWN',analysisSymbol:inp.analysisSymbol||'UNKNOWN',marketType:inp.marketType||'UNKNOWN',isProxy:false,proxyFor:null,source:inp.source||'UNKNOWN',note:'instrument lib unavailable; conservative identity'};
  var id=resolveId(inst);
  /* proxies may predict but MUST be labeled; an UNKNOWN identity may not. */
  var mayPredict=id!==IDS.UNKNOWN;
  return {id:id,instrument:inst,isProxy:!!inst.isProxy,proxyFor:inst.proxyFor||null,mayPredict:mayPredict,note:inst.isProxy?('proxy: '+id+' for XAUUSD context — never collapse into spot'):('direct '+id)};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMASourceBrain=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {identify:identify,IDS:IDS};});
