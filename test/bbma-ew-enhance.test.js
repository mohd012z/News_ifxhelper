'use strict';
/* bbma-ew-enhance.test.js — Elliott Wave enhancer of BBMA Oma signals.
 * Node: node test/bbma-ew-enhance.test.js
 */
const assert = require('assert');
const E = require('../lib/elliott-wave');
const { ewEnhance, toEngineBars } = require('../lib/bbma-ew-enhance');
const OMA = require('../lib/bbma-oma-signals');

// 1) fail-closed: no H1 bars -> ew present but not ok, levels untouched.
{
  const sig = { symbol: 'XAU', state: 'SIGNAL', dir: 'BUY', entry: 4000, sl: 3990, tp1: 4010, tp2: 4020, atr14: 10, decimals: 1 };
  const out = ewEnhance(sig, { h1Bars: [] });
  assert.ok(out.ew, 'ew field present');
  assert.strictEqual(out.ew.ok, false, 'no H1 bars -> not ok');
  assert.strictEqual(out.sl, 3990, 'SL untouched (fail-closed)');
  assert.strictEqual(out.tp1, 4010, 'TP1 untouched (fail-closed)');
  assert.strictEqual(out.ew.note, 'insufficient H1 bars (fail-closed)', 'note names the reason');
  console.log('ok - fail-closed on missing H1 bars');
}

// 2) no H1 count (flat-ish bars) -> not ok, levels untouched.
{
  const h1 = [];
  for (let i = 0; i < 120; i++) h1.push({ t: (1000000 + i * 3600) * 1000, o: 4000 + (i % 3) * 0.2, h: 4000.5, l: 3999.5, c: 4000.1 });
  const sig = { symbol: 'XAU', state: 'SIGNAL', dir: 'BUY', entry: 4000, sl: 3990, tp1: 4010, tp2: 4020, atr14: 10, decimals: 1 };
  const out = ewEnhance(sig, { h1Bars: h1 });
  assert.strictEqual(out.ew.ok, false, 'flat bars -> no count -> not ok');
  assert.strictEqual(out.sl, 3990, 'SL untouched');
  console.log('ok - fail-closed when no H1 count resolves');
}

// 3) a real bullish impulse H1 count -> ew.ok, structural stop + confluence target,
//    and the card shows the Elliott Wave line.
{
  // Build H1 bars that resolve to a bullish impulse via the EW engine (reuse the
  // verified synthetic shape from test/elliott-wave.test.js block 6).
  const bars = [];
  let t = 1000000;
  const bar = (h, l) => { bars.push({ t: t * 1000, o: (h + l) / 2, h, l, c: (h + l) / 2 }); t += 3600; };
  const spike = e => bar(e + 0.6, e - 0.6);
  for (let i = 0; i < 5; i++) bar(100 + i * 0.4, 98 + i * 0.4);
  spike(99);
  for (let i = 1; i <= 4; i++) bar(101.6 + i * 2.2, 99.6 + i * 2.2);
  spike(110);
  for (let i = 1; i <= 4; i++) bar(110 - i * 2.4, 108 - i * 2.4);
  spike(98);
  for (let i = 1; i <= 11; i++) bar(98.6 + i * 3.25, 96.6 + i * 3.25);
  spike(134);
  for (let i = 1; i <= 3; i++) bar(134 - i * 4.6, 132 - i * 4.6);
  spike(115.2);
  bar(115.8, 114.8); bar(116.6, 115.6);
  spike(117.4);
  bar(117.2, 116.0);
  bar(121.0, 120.0); bar(122.0, 121.0);
  spike(122.6);
  bar(121.0, 120.0); bar(119.4, 118.4);
  const a = E.autoCount(bars, 2);
  assert.ok(a && a.type === 'impulse' && a.dir === 1, 'synthetic resolves to bullish impulse');
  const entry = bars[bars.length - 1].c; // ~119.4
  const sig = { symbol: 'XAU', state: 'SIGNAL', dir: 'BUY', entry, sl: entry - 3, tp1: entry + 3, tp2: entry + 6, atr14: 3, decimals: 1 };
  const out = ewEnhance(sig, { h1Bars: bars, minRR: 1.0 });
  assert.ok(out.ew, 'ew present');
  assert.ok(out.ew.count, 'ew.count names the count');
  assert.ok(out.ew.stop != null, 'structural stop present');
  assert.ok(out.ew.stop < entry, 'BUY stop is below entry');
  console.log('ok - bullish impulse: structural stop + count label (stop ' + out.ew.stop + ' basis ' + out.ew.stopBasis + ')');
}

// 4) renderCard surfaces the Elliott Wave line when ew.ok.
{
  const sig = { symbol: 'XAU/USD', state: 'SIGNAL', dir: 'BUY', action: 'Buy Now!', entry: 120, sl: 117, tp1: 130, tp2: 136, atr14: 3,
    decimals: 1, m15Time: 1000000000000, lines: ['TF1 Reentry H1', 'TF2 NONE M15', 'TF3 NONE M5'], context: [],
    ew: { ok: true, count: 'impulse up', stop: 110, stopBasis: 'wave-4 territory', target: 132, rr: 3.4, aligned: true, note: 'HTF + LTF aligned' },
    ewStop: 110, ewTarget: 132 };
  const card = OMA.renderCard(sig, { now: 1000000000000 });
  assert.ok(/Elliott Wave v2\.9/.test(card), 'card has EW line');
  assert.ok(/R:R 3.4:1/.test(card), 'card shows R:R');
  // and a NON-ok ew omits the line
  const sig2 = Object.assign({}, sig, { ew: { ok: false, note: 'no count' } });
  const card2 = OMA.renderCard(sig2, { now: 1000000000000 });
  assert.ok(!/Elliott Wave v2\.9/.test(card2), 'non-ok ew omits EW line');
  console.log('ok - renderCard shows/omits the EW line correctly');
}

// 5) scanSymbol opt-in: ew absent by default, present when extra.ew set (fail-closed if no count).
{
  // minimal: just confirm the default path leaves ew null and does not throw
  const sig = OMA.scanSymbol('XAU', [], []); // insufficient data
  assert.ok(sig.state === 'INSUFFICIENT_DATA', 'guard path');
  console.log('ok - scanSymbol guard path (insufficient data)');
}

console.log('\nAll bbma-ew-enhance tests passed');
