'use strict';
/* bbma-telegram-signals.test.js — BBMA timeframe-signal block on Telegram alert cards. */
const assert = require('assert');
const B = require('../lib/bbma-telegram-signals.js');
const N = require('../telegram-notify.js');

/* --- lib: row computation is deterministic + fail-closed --- */
// Synthetic 60-bar frame, steadily rising -> trend UP, momentum can only be computed, never invented
const bars = [];
let px = 100;
for (let i = 0; i < 60; i++) {
  px += 0.5;
  bars.push({ time: new Date(Date.UTC(2026, 10, 1) + i * 3600000).toISOString(), open: px - 0.4, high: px + 0.3, low: px - 0.6, close: px });
}
let r = B.rowFor('H1', bars);
assert.strictEqual(r.state, 'READY');
assert.ok(['UP', 'DOWN', 'MIXED'].includes(r.trend));
assert.ok(typeof r.momentum === 'string' && typeof r.csak === 'string' && typeof r.mhv === 'string');

// <50 bars -> INSUFFICIENT, never a stubbed signal
r = B.rowFor('H1', bars.slice(0, 30));
assert.strictEqual(r.state, 'INSUFFICIENT');
assert.match(r.reason, /<50/);

// renderLines fail-closed shapes
assert.match(B.renderLines(null)[0], /unavailable/);
assert.match(B.renderLines({ ok: false, symbol: 'EUR/USD', reason: 'NO_DATA' })[0], /unavailable \(NO_DATA/);
const good = B.compose('XAU/USD', 'test', { H1: bars });
const gl = B.renderLines(good);
assert.ok(gl[0].includes('BBMA TIMEFRAME SIGNALS — XAU/USD') && gl[0].includes('· test'), 'gl[0] = ' + gl[0]);
assert.match(gl[1], /Alignment: /);
assert.ok(gl.some(l => l.includes('H1:')));

// compose alignment is derived from the engine, not hardcoded
assert.ok(['UP_ALIGNED', 'DOWN_ALIGNED', 'MIXED', 'INSUFFICIENT_DATA'].includes(good.alignment));
assert.ok(good.directional.total >= 0);

/* --- integration: newsCard embeds the block --- */
const MD = {
  tabs: [{ id: 'forex', label: 'Forex', price: { spot: 1.05 } }],
  pairs: [{ pair: 'EUR/USD', spot: 1.05, base: 'EUR', quote: 'USD' }],
  incoming: []
};
const card = N.newsCard(MD, MD.tabs[0], { title: 'Fed holds rates', summary: '', signal: 'SELL', impactPct: -0.26, impact: 'bearish', tf: 'H1', time: '13:19', source: 'Test', url: 'https://example.com' }, null, null, null, null,
  { ok: false, symbol: 'EUR/USD', reason: 'YAHOO_HTTP_429' });
assert.ok(card.caption.includes('BBMA TIMEFRAME SIGNALS'), 'newsCard must carry the BBMA block even when the source is down');
assert.ok(card.caption.includes('YAHOO_HTTP_429'), 'fail-closed reason must be visible');
assert.ok(card.caption.includes('ORDER CALL: SELL'));

// ready signal renders per-TF rows
const readyCard = N.newsCard(MD, MD.tabs[0], { title: 'Fed holds rates', summary: '', signal: 'SELL', impactPct: -0.26, impact: 'bearish', tf: 'H1', time: '13:19', source: 'Test', url: 'https://example.com' }, null, null, null, null,
  B.compose('EUR/USD', 'Yahoo EURUSD=X proxy', { H1: bars }));
assert.ok(readyCard.caption.includes('Yahoo EURUSD=X proxy'));
assert.ok(readyCard.caption.includes('H1:'));

// speakerCard also carries the block
const spk = N.speakerCard(MD, MD.tabs[0], { name: 'Fed Chair', role: 'Fed', quote: 'inflation is high', side: 'hawkish', signal: 'BUY', impactPct: 0.5, date: '13:00', source: 'Test', url: 'https://example.com' },
  { ok: false, symbol: 'EUR/USD', reason: 'SNAPSHOT_DATA_LAG_120m' });
assert.ok(spk.caption.includes('BBMA TIMEFRAME SIGNALS'));

console.log('bbma-telegram-signals tests passed');
