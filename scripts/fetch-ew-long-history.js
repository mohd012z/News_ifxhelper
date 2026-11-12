/* fetch-long-duk.js — pull a LONGER Dukascopy XAU/USD history (repo's own primary
 * feed, no rate limit) sized for a meaningful EW backtest sample.
 * Output: data/ew-long-history.json (gitignored)  { M5, M15, H1, H4, D1: {bars, meta} }
 * bars: {t(ms), o,h,l,c} UTC-aligned — same contract as candles-auto.json.
 */
'use strict';
const fs = require('fs');
const { getHistoricalRates } = require('dukascopy-node');

const OUT = process.env.OUT || require('path').join(__dirname, '..', 'data', 'ew-long-history.json');
const INSTRUMENT = 'xauusd';

function isoDaysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
function isoToday() { return new Date(Date.now() + 3600000).toISOString().slice(0, 10); }
function baseMs(tf) { return { m5: 300000, m15: 900000, m30: 1800000, h1: 3600000, h4: 14400000, d1: 86400000 }[tf]; }
function aggregateBars(bars, bm) {
  const out = [];
  for (const b of bars) {
    const bucket = Math.floor(b.t / bm) * bm;
    const last = out[out.length - 1];
    if (last && last.t === bucket) { if (b.h > last.h) last.h = b.h; if (b.l < last.l) last.l = b.l; last.c = b.c; }
    else out.push({ t: bucket, o: b.o, h: b.h, l: b.l, c: b.c });
  }
  return out;
}
async function fetchTf(label, tf, fromDays) {
  const rows = await getHistoricalRates({
    instrument: INSTRUMENT,
    dates: { from: isoDaysAgo(fromDays), to: isoToday() },
    timeframe: tf,
    priceType: 'bid',
    format: 'array',
    batchSize: 10,
    pauseBetweenBatchesMs: 400,
    retryCount: 4,
    pauseBetweenRetriesMs: 1200,
    failAfterRetryCount: false
  });
  const bars = (rows || [])
    .filter(r => Array.isArray(r) && r.length >= 5 && Number.isFinite(r[0]) && Number.isFinite(r[1]) &&
      Number.isFinite(r[2]) && Number.isFinite(r[3]) && Number.isFinite(r[4]))
    .map(r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4] }));
  const agg = aggregateBars(bars, baseMs(tf));
  // dedupe by t, ascending
  const seen = new Set(), out = [];
  for (const b of agg) { if (seen.has(b.t)) continue; seen.add(b.t); out.push(b); }
  out.sort((a, b) => a.t - b.t);
  return { bars: out, meta: { ok: true, symbol: 'XAU/USD', source: 'dukascopy xauusd (bid)', generatedAt: new Date().toISOString(), label, bars: out.length } };
}
const plan = [
  ['M5', 'm5', 21],     // 3 wks of M5
  ['M15', 'm15', 60],   // 2 mo of M15
  ['H1', 'h1', 180],    // 6 mo of H1
  ['H4', 'h4', 365],    // 1 y of H4
  ['D1', 'd1', 1095],   // 3 y of D1
];
(async () => {
  const out = {};
  for (const [label, tf, days] of plan) {
    try {
      const r = await fetchTf(label, tf, days);
      out[label] = r;
      console.log(label, tf, days + 'd ->', r.bars.length, 'bars', new Date(r.bars[0].t).toISOString().slice(0, 10), '->', new Date(r.bars[r.bars.length - 1].t).toISOString().slice(0, 10));
    } catch (e) {
      console.log(label, 'ERR', String(e).slice(0, 100));
    }
    await new Promise(res => setTimeout(res, 800));
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('wrote', OUT);
})();
