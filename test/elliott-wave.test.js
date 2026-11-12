/* elliott-wave.test.js — Elliott Wave engine (lib/elliott-wave.js).
 * Node: node test/elliott-wave.test.js
 */
'use strict';
const E = require('../lib/elliott-wave');

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('ok - ' + msg);
  else { failures++; console.log('FAIL - ' + msg); }
}
function near(name, got, want, tol) {
  assert(got != null && Math.abs(got - want) < (tol || 0.05), name + ' (got ' + got + ', want ' + want + ')');
}

// 1) R1/R2/R3 rule gates — the worked example from the quantitative spec (bullish 4000→4500).
{
  const c = { type: 'impulse', dir: 1, pivots: [
    { price: 4000, t: 0 }, { price: 4500, t: 1 }, { price: 4191, t: 2 },
    { price: 5009, t: 3 }, { price: 4700, t: 4 }, { price: 5209, t: 5 }] };
  const v = E.validate(c);
  assert(v.rules[0].pass === true, 'R1 passes on valid impulse');
  assert(v.rules[1].pass === true, 'R2 passes (W3 longest)');
  assert(v.rules[2].pass === true, 'R3 passes (W4 no overlap)');
  const bad = { ...c, pivots: c.pivots.map(p => ({ ...p })) };
  bad.pivots[2].price = 3990; // W2 breaks W1 origin
  assert(E.validate(bad).rules[0].pass === false, 'R1 fails when W2 breaks origin');
}

// 2) Full fib matrix incl. the E1 terminal extensions (EWSTRAT low map).
{
  const c = { type: 'impulse', dir: 1, pivots: [
    { price: 4000, t: 0 }, { price: 4500, t: 1 }, { price: 4200, t: 2 },
    { price: 5200, t: 3 }, { price: 4900, t: 4 }, { price: 5500, t: 5 }] };
  const ts = E.targets(c);
  const f = l => (ts.find(t => t.label === l) || {}).price;
  near('W2 61.8%', f('W2 61.8%'), 4500 - 0.618 * 500);
  near('W3 x1.618', f('W3 ×1.618'), 4200 + 1.618 * 500);
  near('W5 = W1', f('W5 = W1'), 5400);
  near('W5 = 1.618×W4', f('W5 = 1.618×W4'), 4900 + 1.618 * 300);
  near('W5 = 1.0×W4 (terminal)', f('W5 = 1.0×W4'), 5200);
  near('W5 = 1.272×W4 (terminal)', f('W5 = 1.272×W4'), 4900 + 1.272 * 300);
}

// 3) degree labels: MotiveWave degree colors + EWSTRAT phase colors.
{
  const imp = E.degreeLabels({ type: 'impulse', pivots: [] });
  assert(imp.length === 6, 'impulse has 6 labels');
  assert(imp.every(x => x.phase === E.PHASE_COLORS.impulse), 'impulse labels = impulse phase color');
  assert(imp.every(x => x.degree === 'motive'), 'impulse = motive degree');
  const cor = E.degreeLabels({ type: 'wxy', pivots: [] });
  assert(cor.every(x => x.phase === E.PHASE_COLORS.correction), 'corrective labels = correction phase color');
  assert(new Set(E.DEGREE_COLORS).size === E.DEGREE_COLORS.length, 'degree colors are distinct');
}

// 4) compete(): "Red or Blue?" — split level + winner discipline.
{
  const up = { type: 'impulse', dir: 1,
    pivots: [{ price: 4000, t: 0 }, { price: 4200, t: 1 }, { price: 4080, t: 2 },
             { price: 4400, t: 3 }, { price: 4300, t: 4 }],
    validation: { violations: 0 }, forecast: { scenarios: [{ side: 'long', stop: 4000 }] } };
  const down = { type: 'zigzag', dir: -1,
    pivots: [{ price: 4200, t: 1 }, { price: 4080, t: 2 }, { price: 4180, t: 3 },
             { price: 3950, t: 4 }],
    validation: { violations: 0 }, forecast: { scenarios: [{ side: 'short', stop: 4200 }] } };
  const open = E.compete(up, down);
  assert(open.splitLevel != null, 'opposing counts produce a split level');
  assert(open.winner === 'open', 'no price → winner open');
  assert(/split at/.test(open.note), 'note explains the split');
  const at = E.compete(up, down, 4150);
  assert(at.winner === 'A' || at.winner === 'B', 'price → a side wins');
  // same-direction compete is structurally sound
  const same = E.compete(up, up, 4350);
  assert(typeof same.splitLevel === 'number', 'same-dir compete has numeric split');
}

// 5) revisionDiff: first/unchanged/revised + dated note + Trader's Question.
{
  const cur = { count: { type: 'impulse', dir: 1, pivots: [{ price: 4000, t: 0 }, { price: 4200, t: 1 }] },
                validation: { violations: 0 },
                forecast: { scenarios: [{ side: 'long', stop: 4000 }] } };
  const first = E.revisionDiff(null, cur);
  assert(first.first === true, 'first publish flagged');
  const same = E.revisionDiff(cur, cur);
  assert(same.changed === false, 'identical count = no revision');
  const flipped = { count: { type: 'zigzag', dir: -1, pivots: [{ price: 4200, t: 5 }, { price: 4080, t: 6 }] },
                    validation: { violations: 0 },
                    forecast: { scenarios: [{ side: 'short', stop: 4200 }] } };
  const rev = E.revisionDiff(cur, flipped, '2026-11-12');
  assert(rev.changed === true, 'direction flip = revision');
  assert(/REVISION 2026-11-12/.test(rev.note), 'revision note is dated');
  assert(typeof rev.question === 'string' && rev.question.endsWith('?'), 'revision carries a Trader\u2019s Question');
}

// 6) autoCount + scanTfs on a synthetic impulse (deterministic bars).
{
  // Bullish impulse, COMPLETED (engine semantics: a 6-point count ends at the W5 top).
  // Raw pivots (findPivots w=2, strict): L98.4 H110.6 L97.4 H134.6 L114.6 H117.4 L...H122.6
  // W1 13.2 · W2 75% · W3 37.2 (longest) · W4 28% of W3 (114.6 > 110.6 ✓ R3) · W5 12.8.
  // autoCount → impulse (3 up-legs, middle longest), dir -1 (last leg = W5 top→low).
  const bars = [];
  let t = 1000000;
  const bar = (h, l) => { bars.push({ t, o: (h + l) / 2, h, l, c: (h + l) / 2 }); t += 3600; };
  const spike = ext => bar(ext + 0.6, ext - 0.6); // wick-only extreme bar
  for (let i = 0; i < 5; i++) bar(100 + i * 0.4, 98 + i * 0.4);        // rise toward origin (lows end 101.2)
  spike(99);                                                            // origin low
  for (let i = 1; i <= 4; i++) bar(101.6 + i * 2.2, 99.6 + i * 2.2);   // W1 leg toward 110.4
  spike(110);                                                           // W1 high
  for (let i = 1; i <= 4; i++) bar(110 - i * 2.4, 108 - i * 2.4);      // W2 leg toward 98
  spike(98);                                                            // W2 low (75% of W1)
  for (let i = 1; i <= 11; i++) bar(98.6 + i * 3.25, 96.6 + i * 3.25); // W3 leg toward 134.35
  spike(134);                                                           // W3 high (37.2, longest)
  for (let i = 1; i <= 3; i++) bar(134 - i * 4.6, 132 - i * 4.6);      // W4 leg toward 118.2
  spike(115.2);                                                         // W4 terminus (> W1 high 110.6 ✓ R3)
  bar(115.8, 114.8); bar(116.6, 115.6);                                 // W5 up-leg
  spike(117.4);                                                         // (W5 in-flight high, not a count point)
  bar(117.2, 116.0);                                                    // step-down
  bar(121.0, 120.0); bar(122.0, 121.0);                                // W5 final leg up
  spike(122.6);                                                         // W5 terminus (strict top)
  bar(121.0, 120.0); bar(119.4, 118.4);                                 // confirm down
  const a = E.autoCount(bars, 2);
  assert(a != null, 'autoCount finds a count on synthetic impulse');
  assert(a && a.type === 'impulse', 'autoCount classifies it as an impulse (got ' + (a && a.type) + ')');
  assert(a && a.dir === 1, 'impulse direction is bullish (last leg up)');
  // engine semantics: impulse = last 5 terminus points [W1top, W2low, W3top, W4low, W5top]
  assert(a && a.count && a.count.pivots.length === 5, 'count carries 5 terminus pivots');
  assert(a && a.validation && a.validation.rules.some(r => r.id === 'R1' && r.pass === true), 'R1 passes');
  assert(a && a.validation && a.validation.rules.some(r => r.id === 'R3' && r.pass === true), 'R3 passes (W4 above W1 high)');
  assert(a && a.validation && a.validation.rules.some(r => r.id === 'R2' && r.pass === null), 'R2 is in-progress (W5 terminus not counted)');
  const scan = E.scanTfs({ H1: bars, M5: bars.slice(-40) });
  assert(scan.rows.length === 2, 'scanTfs returns one row per TF');
  const row = scan.rows.find(r => r.tf === 'H1');
  assert(row && row.state === 'in-progress', 'scanTfs H1 row reflects the in-progress count (got ' + (row && row.state) + ')');
  assert(row && row.pivots && row.pivots.length === 5, 'scanTfs H1 row carries the 5 count pivots');
  if (a && a.count) {
    // p=[110.6, 97.4, 134.6, 114.6, 123.2], dir=+1, W1=13.2, W4 length=20
    const t5 = E.targets(a.count);
    const eq = t5.find(x => x.label === 'W5 = W1');
    assert(eq && Math.abs(eq.price - 110.0) < 0.05, 'W5=W1 continuation target = 110.0 (got ' + (eq && eq.price) + ')');
    const t10 = t5.find(x => x.label === 'W5 = 1.0×W4');
    assert(t10 && Math.abs(t10.price - 114.6) < 0.05, '1.0×W4 terminal = W4 terminus 114.6 (got ' + (t10 && t10.price) + ')');
    const t1272 = t5.find(x => x.label === 'W5 = 1.272×W4');
    assert(t1272 && Math.abs(t1272.price - 112.26) < 0.05, '1.272×W4 terminal = 112.26 (got ' + (t1272 && t1272.price) + ')');
  }
}

// 7) E1.2 prediction primitives: structStop / pickTarget / htfBias / tradeable.
{
  const bull = { type: 'impulse', dir: 1, pivots: [
    { price: 4000, t: 0 }, { price: 4500, t: 1 }, { price: 4191, t: 2 },
    { price: 5009, t: 3 }, { price: 4700, t: 4 }, { price: 5209, t: 5 }] };
  const ss = E.structStop(bull, 5209);
  assert(ss.level === 4000, 'structStop long = min(W4 low, W1 origin) = 4000 (got ' + ss.level + ')');
  assert(/wave-4 territory/.test(ss.basis), 'structStop names wave-4-territory basis');
  const ip = E.structStop({ type: 'impulse', dir: 1, pivots: bull.pivots.slice(0, 4) }, 5009);
  assert(ip.level === 4000, 'structStop in-progress = W1 origin (got ' + ip.level + ')');
  const bear = E.structStop({ type: 'impulse', dir: -1, pivots: [
    { price: 5209, t: 0 }, { price: 4700, t: 1 }, { price: 5009, t: 2 },
    { price: 4191, t: 3 }, { price: 4500, t: 4 }] }, 4191);
  assert(bear.level > 4191, 'structStop short sits above entry (got ' + bear.level + ')');

  const inc = { type: 'impulse', dir: 1, pivots: bull.pivots.slice(0, 5) }; // W4 terminus, W5 forming
  const fc = E.forecast(inc);
  const stop = E.structStop(inc, 5009).level;
  const tgt = E.pickTarget(inc, fc, { entry: 5009, stop });
  assert(tgt.price > 5009, 'pickTarget returns a forward level above entry (got ' + tgt.price + ')');
  assert(tgt.rr == null || tgt.rr >= 1.0 || tgt.belowMinRR, 'pickTarget reports R:R (got ' + tgt.rr + ')');

  const cf = E.confluence([
    { price: 100, countId: 'a', label: 'a' }, { price: 100.3, countId: 'b', label: 'b' }, { price: 150, countId: 'c', label: 'c' }], 0.6);
  assert(cf.length === 1 && cf[0].members.length === 2, 'confluence groups the 2 near-100 methods');

  assert(E.htfBias(1, 1).aligned === true, 'htfBias aligned passes');
  assert(E.htfBias(-1, 1).aligned === false, 'htfBias counter downgrades');
  assert(E.htfBias(null, 1).aligned === null, 'htfBias off without HTF count');

  const tr = E.tradeable(inc, fc, { price: 5009, htfDir: 1 });
  assert(typeof tr.ok === 'boolean' && tr.stop && tr.target && tr.bias, 'tradeable returns stop+target+bias verdict');
  const trC = E.tradeable(inc, fc, { price: 5009, htfDir: -1 });
  assert(trC.ok === false, 'tradeable counter-degree is not ok');
}

console.log('\n' + (failures === 0 ? 'All elliott-wave tests passed' : failures + ' FAILURES'));
process.exit(failures ? 1 : 0);