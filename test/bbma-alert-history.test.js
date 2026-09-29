'use strict';
/* CONTRACT: build-alert-history — turns committed Telegram delivery state into
 * NEWS_AUTO.alertHistory. Honesty rules:
 *  - only keys that were CONFIRMED sent (sentKeys/history/boxHistory) appear;
 *  - structured history entries keep their real delivery timestamp;
 *  - legacy sentKeys WITHOUT a parseable date are 'recorded' (never back-dated);
 *  - a date embedded in a key is used (date-level only, no invented time);
 *  - dedupe by key; cap 300; structured entries win over legacy duplicates. */
const assert = require('assert');
const { buildHistory, typeOf, titleOf, dateFromKey } = require('../build-alert-history');

/* typeOf / titleOf across every real key shape */
assert.strictEqual(typeOf('evt:[USD] CPI|2026-09-14'), 'EVENT');
assert.strictEqual(typeOf('remind:[AUD] Cash Rate|2026-09-29:30'), 'REMINDER');
assert.strictEqual(typeOf('followup:[USD] NFP|2026-09-12'), 'RESULT_CHECK');
assert.strictEqual(typeOf('news:Gold slumps below $4,200'), 'NEWS');
assert.strictEqual(typeOf('spk:Lagarde|2026-09-17'), 'SPEAKER');
assert.strictEqual(typeOf('result:2026-09-01|XAU'), 'PRICE_TRACK');
assert.strictEqual(typeOf('bbma:bbma-abc123|BEARISH_ALIGNMENT'), 'BBMA_BOX');
assert.strictEqual(titleOf('evt:[USD] CPI y/y|2026-09-14'), 'CPI y/y');
assert.strictEqual(titleOf('evt:FOMC rate decision|16 Sep'), 'FOMC rate decision');
assert.strictEqual(titleOf('news:Gold slumps below $4,200 on hawkish Fed'), 'Gold slumps below $4,200 on hawkish Fed');
assert.strictEqual(titleOf('remind:[AUD] Cash Rate|2026-09-29:30'), 'Cash Rate');

/* dateFromKey: only real dates are parsed; nothing invented */
assert.strictEqual(dateFromKey('evt:[CAD] CPI m/m|2026-09-14').slice(0, 10), '2026-09-14');
assert.strictEqual(dateFromKey('evt:FOMC rate decision|16 Sep'), null, 'no year -> no date, never guessed');

/* build: structured history (real ts) + legacy keys + dedupe + cap */
const state = {
  sentKeys: [
    'evt:[USD] CPI m/m|2026-09-14',
    'evt:FOMC rate decision|16 Sep',
    'news:Gold slumps below $4,200 on hawkish Fed outlook',
    'remind:[AUD] Cash Rate|2026-09-29:30'
  ],
  history: [
    { key: 'evt:[USD] CPI m/m|2026-09-14', type: 'EVENT', title: 'CPI m/m', generatedAt: '2026-09-14T00:29:11.000Z' },
    { key: 'bbma:bbma-xyz|BEARISH_ALIGNMENT', type: 'BBMA_BOX', title: 'BEARISH_ALIGNMENT · 0 of 6 UP', generatedAt: '2026-09-28T13:00:00.000Z' }
  ]
};
let h = buildHistory(state);
assert.strictEqual(h.length, 5, '4 legacy + 1 extra structured (bbma box not in sentKeys)');
const box = h.find(x => x.key.startsWith('bbma:'));
assert.ok(box && box.type === 'BBMA_BOX', 'box post appears');
assert.strictEqual(box.timeMYT, '09-28 21:00 MYT', 'box history MYT time = UTC+8 of delivery');
assert.strictEqual(box.legacy, false);
const fomic = h.find(x => x.key === 'evt:FOMC rate decision|16 Sep');
assert.strictEqual(fomic.timeMYT, 'recorded', 'no-date legacy key must be honestly "recorded"');
assert.strictEqual(fomic.legacy, true);
const cpi = h.find(x => x.key === 'evt:[USD] CPI m/m|2026-09-14');
assert.strictEqual(cpi.legacy, false, 'structured entry wins over legacy duplicate');
assert.ok(cpi.at && cpi.at.startsWith('2026-09-14'), 'structured entry keeps its real delivery timestamp');
assert.strictEqual(cpi.title, 'CPI m/m', 'structured title preserved');

/* sorting: real timestamps first (newest), then date-parsed, then unknown */
assert.strictEqual(h[0].key, 'remind:[AUD] Cash Rate|2026-09-29:30', 'newest (date-parsed 09-29) sorts first');
assert(h.findIndex(x => x.key.startsWith('bbma:')) > -1, 'box post present');
assert.strictEqual(h.findIndex(x => x.key.startsWith('bbma:')), 1, 'box (09-28 13:00Z) sorts second');
const unknownIdx = h.findIndex(x => x.legacy && !x.at);
const datedIdx = h.findIndex(x => x.at && x.key.includes('2026-09-14'));
assert(datedIdx < unknownIdx, 'date-parsed legacy sorts before unknown-time legacy');

/* cap: 500 keys -> 300 entries */
const big = { sentKeys: Array.from({ length: 500 }, (_, i) => 'news:headline number ' + i), history: [] };
h = buildHistory(big);
assert.strictEqual(h.length, 300, 'capped at 300');

console.log('bbma alert-history contract passed');
