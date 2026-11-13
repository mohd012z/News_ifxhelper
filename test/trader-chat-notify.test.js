'use strict';
/* trader-chat-notify.js card contract: the Trader-Desk research card is a CROSS-CHECK, not a
 * replay of the channel's keyword card. Pins: (1) CONFIRMED/CONTRADICTED verdicts are derived
 * from live BBMA alignment, (2) mixed/unavailable chart -> silent (fail-closed, no noise),
 * (3) levels/macro/catalyst/commentary lines render from the pre-resolved inputs, (4) the
 * forced-test path says FORCED, never CONFIRMED. No network in this suite. */
const assert = require('node:assert/strict');
const { traderResearchCard, crossCheckVerdict, focusSymbolFor, parseMytToUtc, drivingCurrencyFor } = require('../trader-chat-notify.js');

const signal = (alignment, up, down, total, price) => ({
  ok: true, symbol: 'EUR/USD', source: 'Dukascopy spot (live)', alignment,
  directional: { up, down, total }, price, frames: {}
});
const pivots = { ok: true, id: 'EURUSD', session: '2026-11-12', R1: 1.10998, R2: 1.11043, S1: 1.10907, S2: 1.10861, S3: 1.10816, S4: 1.10679, closePos: 0.83 };
const atrRow = { id: 'EURUSD', atr: 0.007607 };
const macro = { dxy: { value: '103.16', delta: '-0.01%' }, us10y: { value: '5.103%', delta: '+2.10%', note: 'Elevated real yields' } };
const item = { title: 'Euro Falls as US Dollar gains on inflation concerns', source: 'FXStreet - Forex & Markets News', time: 'Fri 13 Nov, 09:11 MYT', url: 'https://www.fxstreet.com/news/x', signal: 'SELL', impact: 'bearish', impactPct: -0.12 };

// 1. News SELL + chart aligned DOWN -> CONFIRMED, with the agreeing-TF count.
const conf = traderResearchCard({ item, sym: 'EUR/USD', signal: signal('DOWN_ALIGNED', 0, 5, 5, 1.1059), pivots, atrRow, macro, catalyst: null, commentary: [{ title: 'A contrarian ECB rate bet targets 2.5% deposit rate', signal: 'NEUTRAL' }] });
assert(!conf.silent, 'confirmed card must not be silent');
assert(conf.verdict === 'CONFIRMED');
for (const want of [
  'TRADER DESK — RESEARCH SIGNAL',
  '✅ CONFIRMED DOWN — news and 5/5 directional timeframes agree',
  '🔴 SELL EUR/USD (keyword bearish, impact -0.12)',
  'aligned ↓',
  '1.10590',
  '76 pips',
  'Pivots (2026-11-12 session): R1 1.10998 · S1 1.10907 · S2 1.10861 · S3 1.10816 · S4 1.10679 · close 83% of range',
  'DXY 103.16 (-0.01%) · US10Y 5.103% (+2.10%) — real-yield pressure',
  'no high-impact events in 48h — size positions accordingly',
  'Related commentary (1)',
  'trend-short below S3 1.10816; a break of S4 1.10679 opens the next leg. Bullish surprise = reclaim R1 1.10998',
  'Educational, not investment advice'
]) assert(conf.caption.includes(want), 'missing: ' + want);
assert(!conf.caption.includes('undefined'), 'no undefined in caption');

// 2. News SELL + chart aligned UP -> CONTRADICTED (the interesting opposite case).
const contra = traderResearchCard({ item, sym: 'EUR/USD', signal: signal('UP_ALIGNED', 5, 0, 5, 1.1091), pivots, atrRow, macro, catalyst: 'FOMC rate decision (Mon 16 Nov, 02:00)', commentary: [] });
assert(contra.verdict === 'CONTRADICTED');
assert(contra.caption.includes('⚠️ CONTRADICTED — news says DOWN, chart is UP (5/0 up/down of 5)'));
assert(contra.caption.includes('Catalyst: FOMC rate decision (Mon 16 Nov, 02:00)'));

// 3. Mixed chart -> silent (fail-closed): the chat never posts an unconfirmed card.
const mixed = traderResearchCard({ item, sym: 'EUR/USD', signal: signal('MIXED', 3, 2, 5, 1.107), pivots, atrRow, macro, catalyst: null, commentary: [] });
assert(mixed.silent === true, 'mixed chart must be silent');
assert(/chart mixed/.test(mixed.reason));

// 4. Chart unavailable -> silent with the reason, still fail-closed.
const dead = traderResearchCard({ item, sym: 'EUR/USD', signal: { ok: false, symbol: 'EUR/USD', reason: 'DUKA_EMPTY / NO_DATA' }, pivots, atrRow, macro, catalyst: null, commentary: [] });
assert(dead.silent === true && /unavailable/.test(dead.reason));

// 5. --force path renders (for a manual test send) and is labeled FORCED, never CONFIRMED.
const forced = traderResearchCard({ item, sym: 'EUR/USD', signal: signal('MIXED', 3, 2, 5, 1.107), pivots, atrRow, macro, catalyst: null, commentary: [], force: true });
assert(!forced.silent && forced.verdict === 'FORCED');
assert(forced.caption.includes('FORCED (test)'));
assert(!forced.caption.includes('CONFIRMED'));

// 6. BUY item mirrors the desk view (long above R1 / surprise = lose S1).
const buy = { ...item, signal: 'BUY', impact: 'bullish', impactPct: 0.12 };
const buyCard = traderResearchCard({ item: buy, sym: 'EUR/USD', signal: signal('UP_ALIGNED', 5, 0, 5, 1.1095), pivots, atrRow, macro, catalyst: null, commentary: [] });
assert(buyCard.caption.includes('✅ CONFIRMED UP — news and 5/5 directional timeframes agree'));
assert(buyCard.caption.includes('trend-long above R1 1.10998; a break of R2 1.11043 opens the next leg. Bearish surprise = lose S1 1.10907'));

// 7. Verdict unit checks (the cross-check core, independent of rendering).
assert(crossCheckVerdict(signal('DOWN_ALIGNED', 0, 4, 4, 1), 'SELL').verdict === 'CONFIRMED');
assert(crossCheckVerdict(signal('UP_ALIGNED', 4, 0, 4, 1), 'SELL').verdict === 'CONTRADICTED');
assert(crossCheckVerdict(signal('MIXED', 2, 2, 4, 1), 'SELL') === null);
assert(crossCheckVerdict({ ok: false, reason: 'x' }, 'BUY') === null);
assert(crossCheckVerdict(signal('DOWN_ALIGNED', 0, 4, 4, 1), 'NEUTRAL') === null);

// 8. focus/parse helpers mirror telegram-notify.js behavior.
assert(focusSymbolFor({ tabs: [] }, { id: 'gold' }, '') === 'XAU/USD');
assert(focusSymbolFor({ tabs: [] }, { id: 'crypto' }, '') === 'BTC/USD');
assert(focusSymbolFor({ fxPairs: [], currencies: [] }, { id: 'forex', price: { spot: 1.1 } }, 'something') === 'EUR/USD');

// 8b. dedupCandidates: one headline filed under gold+forex+crypto -> ONE card, and the
// named-currency forex resolution beats the generic gold tab (the 3x duplicate from the
// first live test run). Forestry fallback (no named currency) does NOT outrank gold.
const { dedupCandidates } = require('../trader-chat-notify.js');
const MDx = { fxPairs: [], currencies: [] };
const dup = dedupCandidates(MDx, [
  { key: 'news:gold copy', item: { title: 'Euro Falls as US Dollar gains', signal: 'SELL' }, tab: { id: 'gold', label: 'Gold' } },
  { key: 'news:forex copy', item: { title: 'Euro Falls as US Dollar gains', signal: 'SELL' }, tab: { id: 'forex', label: 'Forex', price: { spot: 1.1 } } },
  { key: 'news:crypto copy', item: { title: 'Euro Falls as US Dollar gains', signal: 'BUY' }, tab: { id: 'crypto', label: 'Crypto' } }
]);
assert(dup.length === 1, 'three tab copies must collapse to one card');
assert(dup[0].focus.sym === 'EUR/USD', 'named-currency forex resolution wins the focus');
assert(dup[0].allKeys.length === 3, 'all group keys recorded for dedup');
const dup2 = dedupCandidates(MDx, [
  { key: 'news:forex fallback', item: { title: 'Markets mixed ahead of holiday', signal: 'SELL' }, tab: { id: 'forex', label: 'Forex', price: { spot: 1.1 } } },
  { key: 'news:gold real', item: { title: 'Markets mixed ahead of holiday', signal: 'SELL' }, tab: { id: 'gold', label: 'Gold' } }
]);
assert(dup2.length === 1 && dup2[0].focus.sym === 'XAU/USD', 'no-named-currency forex stays fallback; gold wins');
const d = parseMytToUtc('17 Sep 02:00');
assert(d && d.getUTCMonth() === 8 && d.getUTCDate() === 16 && d.getUTCHours() === 18, 'MYT->UTC offset (02:00 MYT Sep 17 = 18:00 UTC Sep 16)');
const d2 = parseMytToUtc('17 Sep 20:00');
assert(d2 && d2.getUTCDate() === 17 && d2.getUTCHours() === 12, '20:00 MYT = 12:00 UTC same day');
assert(parseMytToUtc('2026-11-10 21:30').getUTCHours() === 13);
assert(drivingCurrencyFor('EUR/USD') === 'EUR');
assert(drivingCurrencyFor('XAU/USD') === 'USD');
assert(drivingCurrencyFor('BTC/USD') === null);

console.log('trader-chat-notify: all assertions passed');
