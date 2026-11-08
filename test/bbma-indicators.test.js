'use strict';
const assert = require('assert');
const I = require('../lib/bbma-indicators.js');

// 1) RSI bounds + extremes
{
  const n = 60;
  const up = new Array(n); for (let i = 0; i < n; i++) up[i] = 100 + i; // monotone up
  const rUp = I.rsi(up, 14);
  assert(rUp[n - 1] > 99.5, 'monotone-up RSI should be ~100, got ' + rUp[n - 1]);
  const dn = new Array(n); for (let i = 0; i < n; i++) dn[i] = 200 - i; // monotone down
  const rDn = I.rsi(dn, 14);
  assert(rDn[n - 1] < 0.5, 'monotone-down RSI should be ~0, got ' + rDn[n - 1]);
  // warm-up nulls
  assert(rUp[13] == null && rUp[14] != null, 'RSI warm-up must be exactly 14 for period 14');
  // bounded
  for (let i = 14; i < n; i++) assert(rUp[i] >= 0 && rUp[i] <= 100, 'RSI in [0,100]');
}
console.log('1 RSI OK');

// 2) MACD hand-check on a tiny constant-then-ramp series
{
  const c = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
             11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
  const m = I.macd(c, 12, 26, 9);
  // MACD line must equal emaF - emaS
  function ema(arr, p) { const k = 2 / (p + 1); let e = arr[0]; const out = [e]; for (let i = 1; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); out.push(e); } return out; }
  const ef = ema(c, 12), es = ema(c, 26);
  for (let i = 25; i < c.length; i++) assert(Math.abs(m.line[i] - (ef[i] - es[i])) < 1e-9, 'MACD line = emaF-emaS @' + i);
  // signal is an EMA of the line (seeded at first line value)
  const lineVals = [];
  for (let i = 25; i < c.length; i++) lineVals.push(m.line[i]);
  const ksg = 2 / 10; let sv = lineVals[0];
  for (let i = 0; i < lineVals.length; i++) {
    if (i) sv = lineVals[i] * ksg + sv * (1 - ksg);
    assert(Math.abs(m.signal[i + 25] - sv) < 1e-9, 'MACD signal EMA @' + i);
  }
  // hist = line - signal
  for (let i = 25; i < c.length; i++) assert(Math.abs(m.hist[i] - (m.line[i] - m.signal[i])) < 1e-12, 'hist = line-signal');
  // warm-up: line null before slow-1
  assert(m.line[24] == null && m.line[25] != null, 'MACD warm-up at slow-1');
}
console.log('2 MACD OK');

// 3) VWAP session reset + value
{
  const day1 = Math.floor(100000 / 86400), day2 = day1 + 1;
  const bars = [
    { time: 100000, high: 110, low: 90, close: 100 },   // tp=100, vol=20
    { time: 1003600, high: 120, low: 80, close: 100 },  // tp=100, vol=40
    { time: day2 * 86400 + 100, high: 52, low: 48, close: 50 } // new day: tp=50, vol=4
  ];
  const v = I.vwap(bars);
  assert(Math.abs(v[0] - 100) < 1e-9, 'vwap bar0 = 100, got ' + v[0]);
  assert(Math.abs(v[1] - 100) < 1e-9, 'vwap bar1 = 100, got ' + v[1]);
  assert(Math.abs(v[2] - 50) < 1e-9, 'vwap resets on new day -> 50, got ' + v[2]);
}
console.log('3 VWAP OK');

// 4) sma/ema basics
{
  const arr = [1, 2, 3, 4, 5];
  assert(I.smaAt(arr, 3, 2) === 2, 'sma(3)@2 = 2');
  assert(I.smaAt(arr, 3, 1) == null, 'sma warm-up null');
  const e = I.emaAt(arr, 3, 4);
  const k = 2 / 4; let ev = 1; for (let i = 1; i < 5; i++) ev = arr[i] * k + ev * (1 - k);
  assert(Math.abs(e - ev) < 1e-12, 'ema matches manual recurrence');
}
console.log('4 SMA/EMA OK');

console.log('\nAll bbma-indicators tests passed');
