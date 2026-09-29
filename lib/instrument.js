'use strict';
/* Instrument provenance (spec /realtime): GC=F futures and spot XAU/USD are NOT
 * the same instrument. A dashboard must NEVER collapse one into the other
 * without provenance. This is the single canonical definition of that envelope,
 * shared by the CI builder (GC=F), the live runtime (spot XAU/USD), and the
 * Telegram publisher so all three surface the SAME fields.
 *
 *   instrument:
 *     display         'XAU/USD'          (what a human reads)
 *     analysisSymbol  'XAUUSD'           (canonical analysis key)
 *     providerSymbol  'GC=F' | 'XAU/USD' (the actual feed symbol)
 *     asset           'GOLD'
 *     marketType      'FUTURES' | 'SPOT'
 *     proxyFor        'XAUUSD' | null    (null when providerSymbol IS the analysis symbol)
 *     source          'yahoo' | 'twelvedata' | ...
 *     note            human disclosure
 *
 * isProxy() is true when the analysis is done on a DIFFERENT instrument than the
 * display label implies (providerSymbol != analysisSymbol) — that is exactly the
 * GC=F→XAU/USD collapse the spec forbids silently.
 */
function norm(s){return String(s||'').replace(/[\/\.\s]/g,'').toUpperCase();}
function instrument(o){
  o=o||{};
  var display=o.display||'XAU/USD';
  var analysisSymbol=o.analysisSymbol||'XAUUSD';
  var providerSymbol=o.providerSymbol||analysisSymbol;
  var marketType=(o.marketType|| (providerSymbol.indexOf('=')>=0?'FUTURES':'SPOT')).toUpperCase();
  /* A proxy is a GENUINELY DIFFERENT instrument (GC=F futures vs XAUUSD spot).
     'XAU/USD' vs 'XAUUSD' are the SAME instrument written two ways — not a
     proxy (normalise before comparing, else spot feeds false-flag). */
  var isProxy=norm(providerSymbol)!==norm(analysisSymbol);
  return {
    display:display,
    analysisSymbol:analysisSymbol,
    providerSymbol:providerSymbol,
    asset:o.asset||'GOLD',
    marketType:marketType,
    proxyFor:isProxy?analysisSymbol:null,
    isProxy:isProxy,
    source:o.source||'UNKNOWN',
    note:o.note|| (isProxy?
      ('Analysis run on '+providerSymbol+' ('+marketType.toLowerCase()+') as a proxy for '+analysisSymbol+' — not direct spot.')
      : ('Direct '+analysisSymbol+' '+marketType.toLowerCase()+' feed.'))
  };
}
/* GC=F futures proxy (CI builder path) */
function gcF(o){ return instrument(Object.assign({providerSymbol:'GC=F',analysisSymbol:'XAUUSD',marketType:'FUTURES',asset:'GOLD',source:(o&&o.source)||'yahoo'},(o||{}))); }
/* Spot XAU/USD (live runtime / Twelve Data path) */
function spotXau(o){ return instrument(Object.assign({providerSymbol:'XAU/USD',analysisSymbol:'XAUUSD',marketType:'SPOT',asset:'GOLD',source:(o&&o.source)||'twelvedata'},(o||{}))); }

/* UMD */
(function(root,mod){
  if(typeof module!=='undefined'&&module.exports){module.exports=mod();}
  else{root.BBMAInstrument=mod();}
})(typeof self!=='undefined'?self:this,function(){
  return {instrument:instrument,gcF:gcF,spotXau:spotXau};
});
