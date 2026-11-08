/* bbma-supply-demand.test.js — S/D zone detection parity fixtures (no lookahead). */
'use strict';
const assert = require('assert');
const { detect, unmitigated, activeBands } = require('../lib/bbma-supply-demand.js');

// helper: candle with a given time (ms) and OHLC
const C = (ms, o, h, l, c) => ({ time: ms, open: o, high: h, low: l, close: c });
let t = 1700000000000;
const T = () => (t += 3600000);

// 1) flat base + strong bullish impulse closing above base high -> DEMAND
{
  const base = [C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100)]; // bodies 0
  const impulse = C(T(), 100, 105, 99.5, 104); // body 4 > 0, close 104 > base high 101
  const zones = detect(base.concat(impulse), { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 });
  assert.equal(zones.length, 1, 'one demand zone expected');
  assert.equal(zones[0].kind, 'DEMAND');
  assert.equal(zones[0].low, 99);
  assert.equal(zones[0].high, 101);
  assert.equal(zones[0].confirmedAtMs, impulse.time);
  console.log('  1 demand detect OK');
}

// 2) bearish impulse closing below base low -> SUPPLY
{
  const base = [C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100)];
  const impulse = C(T(), 100, 100.5, 95, 96); // body 4, close 96 < base low 99
  const zones = detect(base.concat(impulse), { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 });
  assert.equal(zones.length, 1);
  assert.equal(zones[0].kind, 'SUPPLY');
  assert.equal(zones[0].low, 99);
  assert.equal(zones[0].high, 101);
  console.log('  2 supply detect OK');
}

// 3) weak impulse (body <= threshold) -> NO zone
{
  const base = [C(T(), 100, 102, 98, 101), C(T(), 100, 102, 98, 101), C(T(), 100, 102, 98, 101)]; // mean body 1
  const impulse = C(T(), 100, 101.5, 99, 100.5); // body 0.5 <= 1*1.5
  const zones = detect(base.concat(impulse), { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 });
  assert.equal(zones.length, 0, 'weak impulse must not form a zone');
  console.log('  3 weak impulse OK');
}

// 4) impulse closes inside the base range -> NO zone (must break out)
{
  const base = [C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100)];
  const impulse = C(T(), 100, 100.8, 99.2, 100.6); // closes inside [99,101]
  const zones = detect(base.concat(impulse), { baseBars: 3, impulseMultiplier: 0.1, minImpulseBody: 0 });
  assert.equal(zones.length, 0, 'inside-range close is not a breakout');
  console.log('  4 inside-range OK');
}

// 5) minImpulseBody floor
{
  const base = [C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100)];
  const impulse = C(T(), 100, 105, 99, 104); // body 4
  const zones = detect(base.concat(impulse), { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 5 });
  assert.equal(zones.length, 0, 'body below minImpulseBody floor');
  const zones2 = detect(base.concat(impulse), { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 3 });
  assert.equal(zones2.length, 1, 'body above the floor passes');
  console.log('  5 min body floor OK');
}

// 6) mitigation: a later candle overlaps the zone -> not unmitigated
{
  const base = [C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100)];
  const impulse = C(T(), 100, 105, 99.5, 104); // demand 99..101
  const later = [C(T(), 104, 106, 100, 105.5), C(T(), 105, 110, 104, 109)]; // 105.5/109 high >= 101 & low <= 101? 100<=101 yes
  const zones = detect(base.concat(impulse, later), { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 });
  // the zone at impulse index is mitigated by `later`
  const live = unmitigated(zones, base.concat(impulse, later));
  const zoneIdx = zones.findIndex(z => z.confirmedAtMs === impulse.time);
  assert.ok(zoneIdx >= 0);
  assert.ok(!live.some(z => z.confirmedAtMs === impulse.time), 'overlapping later candle mitigates the zone');
  console.log('  6 mitigation OK');
}

// 7) no lookahead: zones only form from base+impulse at the impulse index
{
  const base = [C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100)];
  const impulse = C(T(), 100, 105, 99.5, 104);
  const future = C(T(), 104, 112, 103, 111); // a big later bar must not create a zone at the impulse index
  const zones = detect(base.concat(impulse, future), { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 });
  const atImpulse = zones.filter(z => z.impulseIndex === 3);
  assert.equal(atImpulse.length, 1, 'exactly one zone attributed to the impulse bar');
  assert.equal(atImpulse[0].confirmedAtMs, impulse.time);
  console.log('  7 no lookahead OK');
}

// 8) activeBands convenience (formTime..toTime)
{
  const base = [C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 100)];
  const impulse = C(T(), 100, 105, 99.5, 104);
  const calm = C(T(), 104, 104.5, 100.5, 104); // low 100.5 <= zone high 101 -> MITIGATES the demand zone
  const bands = activeBands(base.concat(impulse, calm), { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 });
  assert.equal(bands.length, 0, 'a later candle dipping into the zone mitigates it');

  // and a candle that stays ABOVE the zone keeps it active:
  const calm2 = C(T(), 104, 104.5, 102.5, 104); // low 102.5 > zone high 101 -> no overlap
  const bands2 = activeBands(base.concat(impulse, calm2), { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 });
  assert.equal(bands2.length, 1);
  assert.equal(bands2[0].kind, 'DEMAND');
  assert.equal(bands2[0].formTime, base[0].time);
  assert.equal(bands2[0].toTime, calm2.time, 'band extends to the latest bar');
  console.log('  8 activeBands OK');
}

// 9) insufficient candles -> []
{
  const z = detect([C(T(), 100, 101, 99, 100), C(T(), 100, 101, 99, 101)], { baseBars: 3 });
  assert.equal(z.length, 0);
  console.log('  9 insufficient OK');
}

// 10) ISO-string times are accepted (the runtime frames use ISO)
{
  const iso = (ms) => new Date(ms).toISOString();
  const mk = (ms, o, h, l, c) => ({ time: iso(ms), open: o, high: h, low: l, close: c });
  const base = [mk(1, 100, 101, 99, 100), mk(2, 100, 101, 99, 100), mk(3, 100, 101, 99, 100)];
  const impulse = mk(4, 100, 105, 99.5, 104);
  const zones = detect(base.concat(impulse), { baseBars: 3, impulseMultiplier: 1.5, minImpulseBody: 0 });
  assert.equal(zones.length, 1);
  assert.equal(zones[0].confirmedAtMs, 4);
  console.log('  10 ISO times OK');
}

console.log('Supply/Demand detection tests passed');
