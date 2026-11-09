'use strict';
/* bbma-oma-signals.test.js — deterministic Oma-ally-style scanner. */
const assert = require('assert');
const Oma = require('../lib/bbma-oma-signals');
const { resampleFromM5, scanSymbol, renderCard, _tags } = Oma;

/* Synthetic m5 series: build a downtrend then a bounce into the lower band so H1 re-entry
 * (down trend, low wick into MA5/10 low, close back above mid) + M15 lower-band rejection
 * can both be satisfied. 5 days of m5 = 1440 bars, plenty for all three TFs. */
function mkM5() {
  const bars = [];
  const start = Date.now() - 5 * 86400000;
  // Align to 5-min boundary.
  let t = Math.floor(start / 300000) * 300000;
  let px = 100;
  const n = 1440;
  for (let i = 0; i < n; i++) {
    // Gentle downtrend over 4 days, then 1-day recovery bounce.
    const phase = i < n - 288 ? 1 : 2;
    const drift = phase === 1 ? -0.02 : 0.05;
    const wave = Math.sin(i / 30) * 0.15;
    const open = px;
    px = Math.max(10, px + drift + wave * 0.3);
    const close = px;
    const high = Math.max(open, close) + 0.1 + Math.abs(Math.sin(i / 7)) * 0.2;
    const low = Math.min(open, close) - 0.1 - Math.abs(Math.cos(i / 9)) * 0.2;
    bars.push({ time: new Date(t).toISOString(), open, high, low, close });
    t += 300000;
  }
  return bars;
}

/* resampleFromM5: drops the forming bucket, aggregates correctly. */
const m5 = mkM5();
const m15 = resampleFromM5(m5, 15);
assert.ok(m15.length >= 300, 'm15 length ' + m15.length);
for (let i = 1; i < m15.length; i++) assert.ok(Date.parse(m15[i].time) > Date.parse(m15[i - 1].time));
const last = m15[m15.length - 1];
assert.ok(Date.parse(last.time) + 15 * 60000 <= Date.now(), 'last m15 must be closed');

/* scanSymbol: whatever it returns, it must be a known state and never throw. */
const r = scanSymbol('TEST', m5);
assert.ok(['SIGNAL', 'NO_SIGNAL', 'INSUFFICIENT_DATA', 'CONFLICT', 'NO_ATR'].includes(r.state), 'state=' + r.state);

/* Insufficient data fail-closed. */
const r2 = scanSymbol('TEST', m5.slice(0, 100));
assert.strictEqual(r2.state, 'INSUFFICIENT_DATA');

/* renderCard: only for signals — construct one deterministically. */
const sig = { symbol: 'TEST/USD', state: 'SIGNAL', action: 'Buy Now!', dir: 'BUY', lines: ['TF1 Reentry H1', 'TF2 Reject EMA50 at Lower BB M15', 'TF3 NONE M5'], entry: 1.10000, sl: 1.09800, tp1: 1.10200, tp2: 1.10400, atr14: 0.002, decimals: 5, m15Time: new Date(Date.now() - 600000).toISOString() };
const card = renderCard(sig);
assert.ok(card.includes('Buy Now!'));
assert.ok(card.includes('Stop Loss: <b>1.09800</b>'));
assert.ok(card.includes('Take Profit: <b>1.10200 / 1.10400</b>'));
assert.ok(card.includes('Trailing: close on M5 MA5/MA10 break or BB touch'));
assert.ok(card.includes('deterministic MTF scan'));

/* tags are pure and direction-consistent. */
const t1 = _tags.reentryTag({ state: 'READY', reentry: 'REENTRY_UP_ZONE' });
assert.strictEqual(t1.dir, 'BUY');
const t2 = _tags.rejectTag({ state: 'READY', zone: 'BELOW_LOW_BB', trend: 'DOWN', values: { ema50: 100, bb: { mid: 100.5 } } });
assert.strictEqual(t2.dir, 'BUY');
assert.strictEqual(_tags.m5Tag({ state: 'READY', extreme: 'EXTREME_HIGH' }).dir, 'SELL');

/* CSM: CSAK + momentum aligned (V4.70 rule). CSAK alone (opposite momentum) = CSAK label, not CSM. */
assert.strictEqual(Oma.csmOf({ state: 'READY', csak: 'CSAK_UP', momentum: 'MOMENTUM_UP' }), 'CSM BUY');
assert.strictEqual(Oma.csmOf({ state: 'READY', csak: 'CSAK_DOWN', momentum: 'MOMENTUM_DOWN' }), 'CSM SELL');
assert.strictEqual(Oma.csmOf({ state: 'READY', csak: 'CSAK_UP', momentum: 'MOMENTUM_DOWN' }), 'CSAK BUY');
assert.strictEqual(Oma.csmOf({ state: 'READY', csak: 'NONE', momentum: 'MOMENTUM_UP' }), null);

/* resampleFrom (generic fromMinutes) + resampleUp: forming bar dropped, aggregates sane. */
const m15syn = m5.filter((b, i) => i % 3 === 0).map((b, i) => ({ time: new Date(Date.parse(b.time) - 0).toISOString(), open: b.open, high: b.high, low: b.low, close: b.close }));
const h4s = Oma.resampleUp(m15syn, 240);
for (const b of h4s) assert.ok(Date.parse(b.time) + 240 * 60000 <= Date.now(), 'h4 bar must be closed');
assert.ok(h4s.length >= 10, 'h4s ' + h4s.length);

/* W1 conflict downgrades to WATCH: synthetic W1 series trending UP vs a BUY signal. */
(function w1Conflict() {
  const mkM5Buy = () => {
    // Uptrend with re-entry pullback so TF1 = BUY (see mkM5 phases, mirror the trend).
    const bars = [];
    let t = Math.floor((Date.now() - 5 * 86400000) / 300000) * 300000;
    let px = 100;
    for (let i = 0; i < 1440; i++) {
      const phase = i < 1152 ? 1 : 2; // 4d up, then 1d pullback (re-entry zone)
      const drift = phase === 1 ? 0.02 : -0.03;
      const wave = Math.sin(i / 30) * 0.15;
      const open = px; px = Math.max(10, px + drift + wave * 0.3); const close = px;
      bars.push({ time: new Date(t).toISOString(), open, high: Math.max(open, close) + 0.15, low: Math.min(open, close) - 0.15, close });
      t += 300000;
    }
    return bars;
  };
  // W1 strongly UP (weekly agreement for a BUY -> NOT a conflict, should stay 'Now!' if signal fires;
  // and W1 strongly DOWN -> conflict -> 'WATCH'). Both must be deterministic, so assert the
  // conflict FLAG behavior directly through the scan result when a signal exists.
  const up = [];
  let wt = Date.UTC(2024, 0, 1);
  for (let i = 0; i < 120; i++) { up.push({ time: new Date(wt).toISOString(), open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i }); wt += 7 * 86400000; }
  const down = up.map((b, i) => ({ time: b.time, open: 220 - i, high: 222 - i, low: 219 - i, close: 219 - i }));
  const m5b = mkM5Buy();
  const m15ctx = m5b.filter((b, i) => i % 3 === 0);
  const rUp = scanSymbol('TEST', m5b, m15ctx, { W1: up.slice(-100) });
  const rDn = scanSymbol('TEST', m5b, m15ctx, { W1: down.slice(-100) });
  const sigs = [rUp, rDn].filter(x => x.state === 'SIGNAL');
  for (const s of sigs) {
    if (s.w1Conflicts) assert.ok(s.action.includes('WATCH'), 'conflict must downgrade: ' + s.action);
    else assert.ok(!s.action.includes('WATCH'));
  }
  // renderCard surfaces the weekly warning.
  const warn = { symbol: 'TEST', dir: 'BUY', action: 'Buy (WATCH)', w1Conflicts: true, lines: ['a', 'b', 'c'], context: ['W1 DOWN (CONFLICTS — watch only)'], entry: 1.1, sl: 1.098, tp1: 1.102, tp2: 1.104, decimals: 5, m15Time: new Date(Date.now() - 600000).toISOString() };
  assert.ok(renderCard(warn).includes('Weekly trend conflicts'));
})();

console.log('bbma-oma-signals tests passed');
