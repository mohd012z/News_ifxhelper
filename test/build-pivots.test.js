'use strict';
/* build-pivots.js — prevSession flat-bar handling (Yahoo single-trade bars
 * where H=L=C collapse every Camarilla level to the close). */
const assert = require('assert');
const { camarilla, prevSession, closePosition, isFlatBar } = require('../build-pivots.js');

const TODAY = new Date().toISOString().slice(0, 10);
const d = (n) => { const t = new Date(); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); };

// 1) isFlatBar
assert.ok(isFlatBar({ day: d(1), h: 4.0565, l: 4.0565, c: 4.0565 }), 'H==L is flat');
assert.ok(!isFlatBar({ day: d(2), h: 4.0596, l: 4.0439, c: 4.0446 }), 'H>L is not flat');
assert.ok(isFlatBar(null) === false, 'null bar is not flat (handled elsewhere)');

// 2) prevSession skips a flat most-recent closed bar and uses the newest one
//    with a real range.
const rows = [
  { day: d(2), h: 10.0, l: 9.0, c: 9.5 },
  { day: d(1), h: 4.0565, l: 4.0565, c: 4.0565 }, // flat
  { day: TODAY, h: 5, l: 5, c: 5 }, // in-progress (excluded regardless)
];
const prev = prevSession(rows);
assert.strictEqual(prev.day, d(2), 'should skip the flat bar and use the prior ranged bar');

// 3) all closed bars flat -> fail closed with a flat error (not a silent pick).
const allFlat = [
  { day: d(2), h: 1, l: 1, c: 1 },
  { day: d(1), h: 2, l: 2, c: 2 },
];
let threw = null;
try { prevSession(allFlat); } catch (e) { threw = e; }
assert.ok(threw, 'all-flat window must throw');
assert.ok(threw.flat === true, 'error is flagged flat');
assert.ok(/flat/i.test(threw.message), 'message mentions flat');

// 4) no closed bars at all -> null (existing contract preserved).
assert.strictEqual(prevSession([{ day: TODAY, h: 5, l: 4, c: 4.5 }]), null);

// 5) lookback bound: a ranged bar older than 10 closed bars is NOT used.
// rows are chronological like fetchDaily: index 0 = oldest (d(12)) ..
// index 11 = newest (d(1)). The newest 10 (indices 2..11) are flat; only
// the 2 oldest (indices 0..1) carry a real range. The 10-bar lookback
// (indices 2..11) must miss them -> flat error.
const far = [];
for (let i = 0; i < 12; i++) {
  const base = 10 - i;
  const day = d(12 - i); // i=0 -> d(12) oldest ... i=11 -> d(1) newest
  far.push(i < 2 ? { day, h: base + 1, l: base, c: base + 0.5 } : { day, h: base, l: base, c: base });
}
threw = null;
try { prevSession(far); } catch (e) { threw = e; }
assert.ok(threw && threw.flat, 'ranged bar beyond 10-bar lookback is not silently backdated');
// but with a wider lookback the same rows DO resolve to the newest ranged bar
const wide = prevSession(far, { lookback: 12 });
assert.ok(wide && !isFlatBar(wide), 'wider lookback recovers the ranged bar');

// 6) camarilla on a real bar (USD/MYR 2026-11-06 session) still produces sane
//    distinct levels, and closePosition is honest.
const bar6 = { h: 4.06, l: 4.04, c: 4.053 };
const lv6 = camarilla(bar6);
// (chained a>b>c is left-associative in JS -> boolean comparisons; do it explicitly)
assert.ok(lv6.R4 > lv6.R3 && lv6.R3 > lv6.R2 && lv6.R2 > lv6.R1 && lv6.R1 > bar6.c
  && bar6.c > lv6.S1 && lv6.S1 > lv6.S2 && lv6.S2 > lv6.S3 && lv6.S3 > lv6.S4, 'levels strictly ordered');
assert.ok(lv6.range > 0 && lv6.R1 !== bar6.c, 'non-zero range yields distinct levels');
assert.strictEqual(closePosition(bar6), 0.65, 'close position in range');

console.log('build-pivots flat-bar tests: OK');
