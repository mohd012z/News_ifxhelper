'use strict';
/* InstrumentRegistry (P0 — "one canonical instrument registry").
 *
 * GC=F futures, XAUUSD spot and broker XAU symbols are NOT the same series.
 * The registry gives each a canonical id + full metadata (provider,
 * marketType, base/quote, venue, contract) so historical learning records
 * EXACTLY which market produced each piece of evidence.
 *
 * It composes lib/instrument.js (the provenance authority — isProxy,
 * proxyFor) rather than re-deriving identity.
 */
var I=(typeof require!=='undefined')?require('./instrument.js'):null;
/* canonical registry (extend as new instruments appear) */
var REGISTRY={
  XAUUSD_SPOT:{canonicalId:'XAUUSD_SPOT',asset:'GOLD',base:'XAU',quote:'USD',marketType:'SPOT',venue:'SPOT',providerSymbol:'XAU/USD',analysisSymbol:'XAUUSD',note:'direct XAU/USD spot'},
  GC_FUTURES:{canonicalId:'GC_FUTURES',asset:'GOLD',base:'XAU',quote:'USD',marketType:'FUTURES',venue:'COMEX',providerSymbol:'GC=F',analysisSymbol:'XAUUSD',contract:'100 troy oz',note:'COMEX gold futures (proxy for XAUUSD context)'},
  XAUSDT_PROXY:{canonicalId:'XAUSDT_PROXY',asset:'GOLD',base:'XAU',quote:'USD',marketType:'TOKENIZED',venue:'CRYPTO',providerSymbol:'XAUt',analysisSymbol:'XAUUSD',note:'tokenized gold proxy'},
  XAGUSD_SPOT:{canonicalId:'XAGUSD_SPOT',asset:'SILVER',base:'XAG',quote:'USD',marketType:'SPOT',venue:'SPOT',providerSymbol:'XAG/USD',analysisSymbol:'XAGUSD',note:'direct silver spot'},
  SI_FUTURES:{canonicalId:'SI_FUTURES',asset:'SILVER',base:'XAG',quote:'USD',marketType:'FUTURES',venue:'COMEX',providerSymbol:'SI=F',analysisSymbol:'XAGUSD',note:'COMEX silver futures'}
};
function norm(s){return String(s||'').replace(/[\/\s=]/g,'').toUpperCase();}
/**
 * resolve({ providerSymbol, analysisSymbol, marketType, provider })
 * returns the canonical entry (+ provenance from instrument.js) or UNKNOWN
 */
function resolve(inp){
  inp=inp||{};
  var ps=norm(inp.providerSymbol);
  var base={canonicalId:'UNKNOWN',asset:'UNKNOWN',base:null,quote:null,marketType:inp.marketType||'UNKNOWN',venue:null,providerSymbol:inp.providerSymbol||'UNKNOWN',analysisSymbol:inp.analysisSymbol||'UNKNOWN',note:'no canonical match — treat as a distinct series, do not merge'};
  var key=null;
  var mt=(inp.marketType||'').toUpperCase();
  if(ps==='GCF')key='GC_FUTURES';
  else if(ps==='SIF')key='SI_FUTURES';
  else if(ps==='XAUT')key='XAUSDT_PROXY';
  else if(ps.indexOf('XAU')===0&&mt!=='FUTURES'&&mt!=='TOKENIZED')key='XAUUSD_SPOT';
  else if(ps.indexOf('XAG')===0&&mt!=='FUTURES'&&mt!=='TOKENIZED')key='XAGUSD_SPOT';
  var entry=REGISTRY[key]||base;
  var prov=(I&&I.instrument(inp))||{};
  return Object.assign({},entry,{provider:inp.provider||prov.source||'UNKNOWN',isProxy:!!prov.isProxy,proxyFor:prov.proxyFor||null,provenance:prov});
}
/* two instruments are only "the same series" if their canonical id matches */
function sameSeries(a,b){return resolve(a).canonicalId===resolve(b).canonicalId&&resolve(a).canonicalId!=='UNKNOWN';}
function list(){return Object.keys(REGISTRY);}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAInstrumentRegistry=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {resolve:resolve,sameSeries:sameSeries,list:list,REGISTRY:REGISTRY};});
