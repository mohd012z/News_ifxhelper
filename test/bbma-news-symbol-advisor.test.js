'use strict';
const assert = require('assert');
const A = require('../lib/bbma-news-symbol-advisor.js');

const NOW = Date.parse('2026-11-08T12:00:00Z');
const DAY = 86400000;

// tech state for the 5 dashboard symbols
function tech() {
  return {
    XAU: { name: 'XAU/USD', trend: 'UP', momentum: 'NONE', mhv: 'VALID_MHV', csa: 'CSAK_UP', reentry: 'NONE', extreme: 'NONE', zone: 'UPPER_BAND', lastClose: 4072, sd: { supply: [{ high: 4200, low: 4150 }], demand: [{ high: 4090, low: 4050 }] } },
    BTC: { name: 'BTC/USD', trend: 'UP', momentum: 'MOMENTUM_UP', mhv: 'NONE', csa: 'CSAK_UP', reentry: 'REENTRY_UP_ZONE', extreme: 'EXTREME_HIGH', zone: 'UPPER_BAND', lastClose: 75800, sd: { supply: [], demand: [] } },
    EURUSD: { name: 'EUR/USD', trend: 'DOWN', momentum: 'NONE', mhv: 'NONE', csa: 'NONE', reentry: 'NONE', extreme: 'NONE', zone: 'LOWER_BAND', lastClose: 1.145, sd: { supply: [{ high: 1.152, low: 1.148 }], demand: [] } },
    USDJPY: { name: 'USD/JPY', trend: 'UP', momentum: 'NONE', mhv: 'VALID_MHV', csa: 'NONE', reentry: 'NONE', extreme: 'NONE', zone: 'UPPER_BAND', lastClose: 158.4, sd: { supply: [], demand: [{ high: 159.5, low: 158.5 }] } },
    GBPUSD: { name: 'GBP/USD', trend: 'UP', momentum: 'MOMENTUM_UP', mhv: 'NONE', csa: 'CSAK_UP', reentry: 'NONE', extreme: 'EXTREME_HIGH', zone: 'UPPER_BAND', lastClose: 1.336, sd: { supply: [{ high: 1.342, low: 1.335 }], demand: [] } }
  };
}

// 1) deterministic: same inputs -> same output
const evts = [
  { _ts: NOW + 1 * DAY, currency: 'USD', country: 'UNITED STATES', event: '[USD] FOMC Statement', importance: 'high', release: { state: 'RELEASE_PENDING', surprisePct: null } },
  { _ts: NOW + 2 * DAY, currency: 'USD', country: 'UNITED STATES', event: '[USD] CPI y/y', importance: 'high', release: { state: 'RELEASE_PENDING', surprisePct: null } },
  { _ts: NOW - 1 * DAY, currency: 'JPY', country: 'Japan', event: '[JPY] BoJ Rate', importance: 'high', release: { state: 'RELEASED', surprisePct: 0.5 } },
  { _ts: NOW + 3 * DAY, currency: 'GBP', country: 'United Kingdom', event: '[GBP] BoE Rate', importance: 'high', release: { state: 'RELEASE_PENDING', surprisePct: null } }
];
const r1 = A.recommend(evts, tech(), { now: NOW });
const r2 = A.recommend(evts, tech(), { now: NOW });
assert.deepStrictEqual(r1.recommendations, r2.recommendations, 'must be deterministic');
console.log('1 deterministic OK');

// 2) FOMC (USD high) must surface XAU as a recommendation
const hasXau = r1.recommendations.find(r => r.symbol === 'XAU');
assert(hasXau, 'FOMC should drive an XAU recommendation');
assert(hasXau.events.length >= 1, 'XAU rec must cite the FOMC event');
assert(/FOMC/.test(hasXau.reasons.join(' ')) || hasXau.events.some(e => /FOMC/.test(e.event)), 'XAU rec must mention FOMC');
console.log('2 FOMC->XAU OK  dir=' + hasXau.direction + ' score=' + hasXau.score + ' conf=' + hasXau.confidence);

// 3) BoJ released event must surface USDJPY
const hasUsdjpy = r1.recommendations.find(r => r.symbol === 'USDJPY');
assert(hasUsdjpy, 'BoJ should drive a USDJPY recommendation');
assert(hasUsdjpy.events.some(e => /BoJ/.test(e.event)), 'USDJPY rec must cite BoJ');
console.log('3 BoJ->USDJPY OK  dir=' + hasUsdjpy.direction + ' score=' + hasUsdjpy.score);

// 4) actionable (non-neutral) recs rank above neutral
const first = r1.recommendations[0];
const hasNeutral = r1.recommendations.find(r => r.direction === 'neutral');
if (hasNeutral) {
  const firstIdx = r1.recommendations.indexOf(first);
  const neutralIdx = r1.recommendations.indexOf(hasNeutral);
  assert(firstIdx < neutralIdx || first.direction !== 'neutral', 'neutral should not outrank actionable');
}
console.log('4 ranking OK  top=' + first.symbol + '/' + first.direction);

// 5) techBias direction sanity
assert(A.techBias(tech().XAU) > 0, 'XAU (UP + CSA up + MHV) must be net long');
assert(A.techBias(tech().EURUSD) < 0, 'EURUSD (DOWN) must be net short');
console.log('5 techBias OK  XAU=' + A.techBias(tech().XAU) + ' EURUSD=' + A.techBias(tech().EURUSD));

// 6) S&D proximity shifts bias: price at an unmitigated supply should lean short
const atSupply = { trend: 'MIXED', momentum: 'NONE', mhv: 'NONE', csa: 'NONE', reentry: 'NONE', extreme: 'NONE', lastClose: 4175, sd: { supply: [{ high: 4200, low: 4150 }], demand: [] } };
const cleanMix = { trend: 'MIXED', momentum: 'NONE', mhv: 'NONE', csa: 'NONE', reentry: 'NONE', extreme: 'NONE', lastClose: 4000, sd: { supply: [{ high: 4200, low: 4150 }], demand: [] } };
assert(A.techBias(atSupply) < A.techBias(cleanMix), 'near supply should be more bearish than far from it');
console.log('6 S&D proximity OK  atSupply=' + A.techBias(atSupply) + ' cleanMix=' + A.techBias(cleanMix));

// 7) no events -> no recommendations (fail-closed, no fabricated signal)
const empty = A.recommend([], tech(), { now: NOW });
assert(empty.recommendations.length === 0, 'no events should produce no recommendations');
console.log('7 no-events fail-closed OK');

// 8) extreme-high long carry a risk note
const recExtreme = A.recommend(
  [{ _ts: NOW + DAY, currency: 'USD', country: 'United States', event: '[USD] CPI y/y', importance: 'high', release: { state: 'RELEASE_PENDING' } }],
  tech(), { now: NOW });
const btcRec = recExtreme.recommendations.find(r => r.symbol === 'BTC');
if (btcRec && btcRec.direction === 'long') {
  assert(/extreme|pullback|reduced/i.test(btcRec.risk), 'extreme-high long must carry a risk note');
}
console.log('8 extreme risk note OK');

// 9) surpriseDir: hawkish (positive CPI surprise) -> XAU bearish (-1)
assert(A.surpriseDir({ release: { surprisePct: 0.8 } }) === -1, 'positive (hawkish) surprise -> gold down');
assert(A.surpriseDir({ release: { surprisePct: -0.8 } }) === 1, 'negative (dovish) surprise -> gold up');
assert(A.surpriseDir({ release: {} }) === 0, 'no surprise -> neutral');
console.log('9 surpriseDir OK');

// 10) rec carries lastPrice from lastClose (so the card shows a real price)
const r10 = A.recommend(
  [{ _ts: NOW + DAY, currency: 'USD', country: 'United States', event: '[USD] FOMC Statement', importance: 'high', release: { state: 'RELEASE_PENDING' } }],
  tech(), { now: NOW });
const xau10 = r10.recommendations.find(r => r.symbol === 'XAU');
assert(xau10 && xau10.lastPrice === 4072, 'XAU rec must expose lastPrice = lastClose (4072)');
console.log('10 lastPrice OK  XAU=' + xau10.lastPrice);

// 11) MTF analysis: HTF down + LTF up = counter-trend; aligned when both agree
{
  const mtf = A.mtfAnalysis;
  const counter = mtf({ MN1: { trend: 'DOWN' }, W1: { trend: 'DOWN' }, D1: { trend: 'DOWN' }, H4: { trend: 'UP' }, H1: { trend: 'UP' }, M30: { trend: 'UP' }, M15: { trend: 'UP' }, M5: { trend: 'UP' } });
  assert(counter.structure === 'counter-trend', 'HTF down + LTF up must be counter-trend, got ' + counter.structure);
  assert(counter.hi === 'down' && counter.lo === 'up', 'counter: hi=down lo=up');
  const aligned = mtf({ MN1: { trend: 'UP' }, W1: { trend: 'UP' }, D1: { trend: 'UP' }, H4: { trend: 'UP' }, H1: { trend: 'UP' }, M30: { trend: 'UP' }, M15: { trend: 'UP' }, M5: { trend: 'UP' } });
  assert(aligned.structure === 'aligned up' && aligned.bias > 0.9, 'all-up must be aligned up, bias>0.9');
  const empty = mtf({});
  assert(empty === null, 'no frames -> null (fail-closed)');
  console.log('11 MTF OK  counter.bias=' + counter.bias.toFixed(2) + ' aligned.bias=' + aligned.bias.toFixed(2));
}

// 12) tone hint: hawkish/dovish/mixed + dirRule carried through
{
  const th = A.toneHint;
  const hawk = th('XAU', { bias: 'hawkish', tone: 'BEARISH', score: -0.62, dirRule: 'hawkish = SELL gold, dovish = BUY gold' });
  assert(hawk.bias === 'hawkish' && hawk.label === 'HAWKISH', 'hawkish tone');
  assert(/SELL gold/.test(hawk.rule) && /macro hawkish/.test(hawk.hint), 'dirRule + hint present');
  const dov = th('XAU', { bias: 'dovish', tone: 'BULLISH', score: 0.4 });
  assert(dov.bias === 'dovish' && dov.label === 'DOVISH', 'dovish tone');
  assert(th('XAU', null) === null, 'no tone -> null (fail-closed)');
  console.log('12 tone OK  hawk=' + hawk.label + ' dov=' + dov.label);
}

// 13) recommend(): counter-trend (HTF down) downgrades a weak long to neutral + risk note
{
  const frames = { MN1: { trend: 'DOWN' }, W1: { trend: 'DOWN' }, D1: { trend: 'DOWN' }, H4: { trend: 'UP' }, H1: { trend: 'UP' }, M30: { trend: 'UP' }, M15: { trend: 'UP' }, M5: { trend: 'UP' } };
  const xUp = Object.assign({}, tech().XAU, { trend: 'UP' }); // intraday up, but HTF down
  const t2 = Object.assign({}, tech(), { XAU: xUp });
  const out = A.recommend(
    [{ _ts: NOW + DAY, currency: 'USD', country: 'United States', event: '[USD] FOMC Statement', importance: 'high', release: { state: 'RELEASE_PENDING' } }],
    t2, { now: NOW, frames: frames, mtfSymbol: 'XAU' });
  const x = out.recommendations.find(r => r.symbol === 'XAU');
  assert(x && x.mtf && x.mtf.structure === 'counter-trend', 'XAU rec must carry counter-trend MTF read');
  assert(/Counter-trend/i.test(x.risk), 'counter-trend must carry a chop-risk note: ' + x.risk);
  // a long fighting a down HTF with a modest edge must not stay "high" confidence
  if (x.direction === 'long') assert(x.confidence !== 'high', 'counter-trend long cannot be high confidence');
  console.log('13 MTF-in-rec OK  XAU dir=' + x.direction + ' mtf=' + x.mtf.structure + ' conf=' + x.confidence);
}

// 14) recommend(): tone hint surfaces on the rec (hawkish gold)
{
  const out = A.recommend(
    [{ _ts: NOW + DAY, currency: 'USD', country: 'United States', event: '[USD] FOMC Statement', importance: 'high', release: { state: 'RELEASE_PENDING' } }],
    tech(), { now: NOW, tones: { XAU: { bias: 'hawkish', tone: 'BEARISH', score: -0.62, dirRule: 'hawkish = SELL gold' } } });
  const x = out.recommendations.find(r => r.symbol === 'XAU');
  assert(x && x.tone && x.tone.label === 'HAWKISH' && /SELL gold/.test(x.tone.rule), 'XAU rec must carry the hawkish tone hint');
  console.log('14 tone-in-rec OK  XAU tone=' + x.tone.label);
}

console.log('\nAll news-symbol-advisor tests passed');
