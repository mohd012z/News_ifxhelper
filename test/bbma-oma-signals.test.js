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

console.log('bbma-oma-signals tests passed');
