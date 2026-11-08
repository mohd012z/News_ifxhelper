/* bbma-smc.test.js — Smart Money Concepts engine (lib/bbma-smc.js).
 * Node: node test/bbma-smc.test.js
 */
'use strict';
const S = require('../lib/bbma-smc');

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('ok - ' + msg);
  else { failures++; console.log('FAIL - ' + msg); }
}

// Synthetic candle helper: mk(time, open, high, low, close, volume)
function mk(t, o, h, l, c, v) { return { time: t, open: o, high: h, low: l, close: c, volume: v || 10 }; }

// 1) ATR sanity: a constant-range candle stream has ATR == that range.
{
  const c = [];
  for (let i = 0; i < 40; i++) c.push(mk(i * 3600e3, 100, 102, 99, 100)); // range ~3
  const a = S.atr(c, 14);
  assert(a != null && Math.abs(a - 3) < 0.01, 'ATR of constant-range stream ≈ 3 (got ' + (a && a.toFixed(3)) + ')');
  assert(S.atr(c.slice(0, 10), 14) === null, 'ATR fail-closed when not enough bars');
}

// 2) Swings: a clean tie-free zig-zag produces H/L pivots, printed len bars late.
{
  const c = [];
  let prev = 100;
  for (let i = 0; i < 40; i++) {
    const cycle = Math.floor(i / 10), phase = i % 10;
    const target = phase < 5 ? 100 + phase * 2 + cycle : 110 - (phase - 5) * 2 + cycle;
    c.push(mk(i, prev, target + 0.9, target - 0.9, target));
    prev = target;
  }
  const sw = S.swings(c, 3);
  assert(sw.length > 3, 'zig-zag yields multiple pivots (got ' + sw.length + ')');
  assert(sw.some(s => s.kind === 'H') && sw.some(s => s.kind === 'L'), 'both H and L pivots found');
  assert(sw.every(s => s.bar >= 3 && s.bar <= c.length - 4), 'pivots respect the len-bar confirmation window');
}

// 3) Structure + breaks: uptrend HH + bullish BOS, then a bearish CHoCH (close-based).
{
  // swings(len=2): L@3=97, H@4=110, L@7=101, H@8=116(HH). BOS@9 (close 108>110? no) —
  // actually bar9 close 108 < 110; the up-break is bar... let's use the verified data:
  const c = [
    mk(0, 100, 104, 98, 103), mk(1, 103, 103, 99, 102), mk(2, 102, 102, 98, 101),
    mk(3, 101, 101, 97, 100),   // L@3 = 97
    mk(4, 100, 110, 100, 109),  // H@4 = 110
    mk(5, 109, 109, 101, 108), mk(6, 108, 108, 102, 103), mk(7, 103, 107, 101, 106),
    mk(8, 106, 116, 105, 115),  // H@8 = 116 (HH)
    mk(9, 115, 114, 106, 108),  // close 108 > 110? no
    mk(10, 108, 106, 100, 101), // L@? ; close 101 < 101? 
    mk(11, 101, 100, 95, 96)    // close 96 < L@7 101 -> bearish CHoCH
  ];
  const st = S.structure(c, 2, false);
  assert(st.labels.some(l => l.tag === 'HH'), 'HH label recorded (got ' + st.labels.map(l => l.tag).join(',') + ')');
  assert(st.breaks.some(b => b.dir === 'bear'), 'a bearish break is recorded');
  assert(st.breaks.some(b => b.tag === 'CHoCH'), 'the drop is a CHoCH against the up-trend');
  assert(st.trend === -1, 'trend flips bearish after the CHoCH (trend=' + st.trend + ')');
}

// 3b) bullish BOS on a clean up-break.
{
  const c = [
    mk(0, 100, 104, 98, 103), mk(1, 103, 103, 99, 102), mk(2, 102, 102, 98, 101),
    mk(3, 101, 101, 97, 100),   // L@3 = 97
    mk(4, 100, 110, 100, 109),  // H@4 = 110
    mk(5, 109, 109, 101, 108), mk(6, 108, 108, 102, 103),
    mk(7, 103, 118, 102, 117)   // close 117 > 110 -> bullish BOS
  ];
  const st = S.structure(c, 2, false);
  assert(st.breaks.some(b => b.dir === 'bull' && b.tag === 'BOS'), 'up-break through the swing high is a bullish BOS (got ' + st.breaks.map(b => b.tag + '/' + b.dir).join(',') + ')');
  assert(st.trend === 1, 'trend is bullish after the BOS (trend=' + st.trend + ')');
}

// 4) Order Blocks: a bullish break marks the pre-break lowest bar as a demand OB;
// a later close through it mitigates it.
{
  // swings(len=2): L@3=97, H@4=110, L@7=101, H@8=116. Bullish break bar10 (close 117>116).
  const base = [
    mk(0, 100, 104, 98, 103), mk(1, 103, 103, 99, 102), mk(2, 102, 102, 98, 101),
    mk(3, 101, 101, 97, 100),   // L@3 = 97 (the pre-break lowest-low bar = demand OB)
    mk(4, 100, 110, 100, 109),  // H@4 = 110
    mk(5, 109, 109, 101, 108), mk(6, 108, 108, 102, 103), mk(7, 103, 107, 101, 106),
    mk(8, 106, 116, 105, 115),  // H@8 = 116
    mk(9, 115, 114, 106, 108),
    mk(10, 108, 118, 100, 117)  // close 117 > 116 -> bullish break at bar 10
  ];
  const st = S.structure(base, 2, false);
  const ob = S.orderBlocks(base, st, 3, false);
  assert(ob.demand.length >= 1, 'bullish break creates a demand OB (got ' + ob.demand.length + ')');
  assert(ob.demand[0] && ob.demand[0].low === 97 && ob.demand[0].high === 101, 'demand OB = the pre-break lowest-low bar [97,101] (got ' + JSON.stringify(ob.demand[0]) + ')');
  // a later close back below the OB mitigates it
  const c2 = base.concat([mk(11, 117, 118, 95, 95.8)]);
  const ob2 = S.orderBlocks(c2, S.structure(c2, 2, false), 3, false);
  assert(!ob2.demand.some(z => z.low === 97), 'demand OB mitigated once a later close trades through it');
}

// 5) FVG: a 3-candle gap forms, partial fill shrinks it, full fill removes it.
{
  const c = [
    mk(0, 100, 101, 99, 100),
    mk(1, 101, 106, 101, 105),
    mk(2, 106, 112, 105, 111)  // low(105) > high[0](101) -> bull FVG [101,105]
  ];
  let fv = S.fvg(c, 4);
  assert(fv.bull.length === 1 && fv.bull[0].top === 105 && fv.bull[0].bottom === 101, 'bull FVG [101,105] detected');
  c.push(mk(3, 111, 111.5, 102, 103)); // low 102 partially fills -> top shrinks to 102
  fv = S.fvg(c, 4);
  assert(fv.bull.length === 1 && Math.abs(fv.bull[0].top - 102) < 1e-9, 'partial fill shrinks FVG top to 102 (got ' + (fv.bull[0] && fv.bull[0].top) + ')');
  c.push(mk(4, 103, 104, 99, 100)); // low 99 <= bottom 101 -> gap fill, removed
  fv = S.fvg(c, 4);
  assert(!fv.bull.some(z => Math.abs(z.bottom - 101) < 1e-9), 'full fill removes the FVG');
}

// 6) Trading range + premium/discount geometry (tie-free zig-zag so pivots exist).
{
  const c = [];
  let prev = 100;
  for (let i = 0; i < 40; i++) {
    const cycle = Math.floor(i / 10), phase = i % 10;
    const target = phase < 5 ? 100 + phase * 2 + cycle : 110 - (phase - 5) * 2 + cycle;
    c.push(mk(i, prev, target + 0.9, target - 0.9, target));
    prev = target;
  }
  const st = S.structure(c, 3, false);
  const tr = S.tradingRange(c, st, 20, 5, 5);
  assert(tr != null, 'trading range computed');
  if (tr) {
    const span = tr.top - tr.bottom;
    assert(tr.mid > tr.bottom && tr.mid < tr.top, 'mid inside range');
    assert(tr.premTop > tr.premBottom && tr.premBottom > tr.mid, 'premium zone above mid');
    assert(tr.discTop > tr.discBottom && tr.discTop < tr.mid, 'discount zone below mid (top < mid)');
    assert(Math.abs(tr.premBottom - (tr.top - span * 0.25)) < 1e-9 && Math.abs(tr.discTop - (tr.bottom + span * 0.25)) < 1e-9, 'zone bounds follow offset+depth math');
  }
}

// 7) Sweep [pandich]: stop-run of the prior-N low, bullish close back inside far half -> long plan.
{
  const flat = [];
  for (let i = 0; i < 22; i++) flat.push(mk(i, 100, 101.5, 98.5, 100)); // flat 22-bar range, ATR ~3
  const sig = mk(22, 100, 101.5, 97, 101.2); // wick 97 (< 98.5), close 101.2 back inside + far (upper) half
  const c = flat.concat([sig]);
  const sw = S.sweep(c, { lookback: 20 });
  assert(sw != null && sw.dir === 'long', 'sweep long detected (got ' + (sw && sw.dir) + ')');
  if (sw) {
    assert(sw.entry === 101.2 && sw.extreme === 98.5, 'entry = signal close, extreme = prior low');
    assert(sw.stop < sw.entry && sw.tp1 > sw.entry && sw.tp2 > sw.tp1 && sw.tp3 > sw.tp2, 'stop below entry; TP1<TP2<TP3');
    assert(Math.abs((sw.tp1 - sw.entry) - sw.risk) < 1e-9 && Math.abs((sw.tp3 - sw.entry) - 3 * sw.risk) < 1e-9, 'targets are 1R/2R/3R of the risk');
  }
  const c2 = flat.concat([mk(22, 100, 103, 99, 100.5)]); // wick 103 (> 101.5), close 100.5 back inside, bar's far (lower) half
  const sw2 = S.sweep(c2, { lookback: 20 });
  assert(sw2 != null && sw2.dir === 'short', 'sweep short detected (got ' + (sw2 && sw2.dir) + ')');
  const c3 = flat.concat([mk(22, 100, 101.5, 97, 97)]); // sweeps the low but closes below it -> breakout, not a sweep
  const sw3 = S.sweep(c3, { lookback: 20 });
  assert(sw3 === null, 'close outside the prior range is not a sweep');
}

// 8) compute() aggregate + no-lookahead shape.
{
  const c = [];
  let prev = 100;
  for (let i = 0; i < 40; i++) {
    const cycle = Math.floor(i / 10), phase = i % 10;
    const target = phase < 5 ? 100 + phase * 2 + cycle : 110 - (phase - 5) * 2 + cycle;
    c.push(mk(i, prev, target + 0.9, target - 0.9, target));
    prev = target;
  }
  const all = S.compute(c, { swingLen: 3 });
  assert(all.struct && Array.isArray(all.zones) && all.ob && all.fvg && all.eq, 'compute() returns struct/zones/ob/fvg/eq');
  assert(Array.isArray(all.struct.breaks), 'structure breaks array present');
  assert(Array.isArray(all.eq.eqh) && Array.isArray(all.eq.eql), 'equal high/low arrays present');
}

console.log('\n' + (failures === 0 ? 'All bbma-smc tests passed' : failures + ' FAILURES'));
process.exit(failures ? 1 : 0);
