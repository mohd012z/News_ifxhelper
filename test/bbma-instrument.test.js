'use strict';
/* EXECUTED proof of instrument provenance (spec /realtime):
 *   - GC=F => FUTURES proxy for XAUUSD (isProxy true, proxyFor set)
 *   - XAU/USD spot => NOT a proxy (normalised XAU/USD == XAUUSD)
 *   - no silent collapse: display stays XAU/USD while providerSymbol is GC=F
 */
const assert=require('assert');
const I=require('../lib/instrument.js');

/* GC=F futures (the CI builder path) */
const gc=I.gcF({source:'yahoo'});
assert.strictEqual(gc.display,'XAU/USD','display stays XAU/USD (human label)');
assert.strictEqual(gc.analysisSymbol,'XAUUSD');
assert.strictEqual(gc.providerSymbol,'GC=F','provider symbol is the ACTUAL feed');
assert.strictEqual(gc.asset,'GOLD');
assert.strictEqual(gc.marketType,'FUTURES');
assert.strictEqual(gc.proxyFor,'XAUUSD','explicitly labeled as a proxy');
assert.strictEqual(gc.isProxy,true);
assert.ok(/proxy/i.test(gc.note),'note discloses the proxy');

/* Spot XAU/USD (the live runtime path) — must NOT be flagged as a proxy */
const spot=I.spotXau({source:'twelvedata'});
assert.strictEqual(spot.providerSymbol,'XAU/USD');
assert.strictEqual(spot.marketType,'SPOT');
assert.strictEqual(spot.proxyFor,null,'spot is not a proxy');
assert.strictEqual(spot.isProxy,false,'XAU/USD vs XAUUSD are the SAME instrument (normalised)');
assert.ok(/direct/i.test(spot.note));

/* XAUUSD written directly */
const direct=I.instrument({display:'XAU/USD',analysisSymbol:'XAUUSD',providerSymbol:'XAUUSD',marketType:'SPOT',source:'twelvedata'});
assert.strictEqual(direct.isProxy,false);
assert.strictEqual(direct.proxyFor,null);

/* A genuinely different instrument stays a proxy */
const other=I.instrument({display:'GOLD',analysisSymbol:'XAUUSD',providerSymbol:'MGC=F',marketType:'FUTURES',source:'yahoo'});
assert.strictEqual(other.isProxy,true);
assert.strictEqual(other.proxyFor,'XAUUSD');

/* The collapse that the spec forbids: provider GC=F must carry proxyFor, so a
   renderer that shows only `display` without `providerSymbol/isProxy` cannot
   claim direct spot. */
assert.notStrictEqual(gc.providerSymbol,gc.analysisSymbol,'GC=F != XAUUSD — the instruments differ');

console.log('instrument provenance proof: GC=F FUTURES proxy (isProxy=true, proxyFor=XAUUSD); XAU/USD spot NOT a proxy (normalised); display never silently collapsed');
process.exit(0);
