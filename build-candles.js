/* build-candles.js - real OHLC history for the BBMA chart, from Dukascopy (spot).
 *
 * Why: the BBMA chart previously showed a synthetic sine baseline re-anchored to
 * the live price, so candle SHAPES never matched TradingView. Dukascopy is the
 * same free spot feed TradingView-style platforms use (XAU/USD listed since
 * 2003, ~24k ticks/hour), and dukascopy-node downloads it without any API key.
 *
 * This script builds candles-auto.json (committed + pushed every 30 min by the
 * local poller, GH cron as backup). The CF worker serves it at /api/candles?tf=…
 * (single source of truth, CDN-hosted, no rate limit), so the dashboard charts
 * real bars on every TF.
 *
 * Output shape (worker contract):
 *   { generatedAt, source, instrument, bars: { M5: [{t,o,h,l,c}…], … } }
 *   t = UTC epoch ms, o/h/l/c = bid-based prices (Dukascopy default 'bid').
 *
 * Run: node build-candles.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { getHistoricalRates } = require('dukascopy-node');

const OUT = path.join(__dirname, 'candles-auto.json');
const INSTRUMENT = 'xauusd';

// Per-TF windows sized for 240 bars + headroom (gold trades ~23h/day, so
// calendar days > needed bars; 2y W1 ≈ 105 bars ≈ a decade of MN1 needs its own).
const RANGES = {
  M5: { tf: 'm5', fromDays: 3, limit: 240 },
  M15: { tf: 'm15', fromDays: 8, limit: 240 },
  M30: { tf: 'm30', fromDays: 14, limit: 240 },
  H1: { tf: 'h1', fromDays: 13, limit: 240 },
  H4: { tf: 'h4', fromDays: 45, limit: 240 },
  D1: { tf: 'd1', fromDays: 270, limit: 240 },
  // dukascopy-node v1.51 has no 'w1' timeframe -> resample from d1 (ISO weeks).
  W1: { tf: 'd1', fromDays: 365 * 5, limit: 240, resample: 'w1' },
  MN1: { tf: 'mn1', fromDays: 4380, limit: 240 }
};

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
function isoToday() {
  return new Date(Date.now() + 3600000).toISOString().slice(0, 10); // +1h: `to` is exclusive
}

// ISO-8601 week bucketing (weeks start Monday 00:00 UTC) — same boundaries
// TradingView uses for its W1 chart.
function isoWeekStartMs(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - day);
  return d.getTime();
}
function resampleWeekly(bars) {
  const out = [];
  for (const b of bars) {
    const wk = isoWeekStartMs(b.t);
    const last = out[out.length - 1];
    if (last && last.t === wk) {
      if (b.h > last.h) last.h = b.h;
      if (b.l < last.l) last.l = b.l;
      last.c = b.c;
    } else {
      out.push({ t: wk, o: b.o, h: b.h, l: b.l, c: b.c });
    }
  }
  return out;
}

async function fetchTf(tf, fromDays, limit, resample) {
  const rows = await getHistoricalRates({
    instrument: INSTRUMENT,
    dates: { from: isoDaysAgo(fromDays), to: isoToday() },
    timeframe: tf,
    priceType: 'bid',
    format: 'array',
    batchSize: 10,
    pauseBetweenBatchesMs: 500,
    retryCount: 4,
    pauseBetweenRetriesMs: 1000,
    failAfterRetryCount: false
  });
  // dukascopy-node candles: [timeMs, open, high, low, close, volume]
  const bars = rows
    .filter((r) => Array.isArray(r) && r.length >= 5 &&
      Number.isFinite(r[0]) && Number.isFinite(r[1]) &&
      Number.isFinite(r[2]) && Number.isFinite(r[3]) && Number.isFinite(r[4]))
    .map((r) => ({ t: r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
  // Strictly-ascending dedupe (Yahoo-style guards apply to the client too).
  const out = [];
  for (const b of bars) {
    const last = out[out.length - 1];
    if (last && b.t <= last.t) continue;
    out.push(b);
  }
  const res = resample ? resampleWeekly(out) : out;
  return res.slice(-limit);
}

(async () => {
  const started = Date.now();
  const bars = {};
  let failures = 0;
  for (const [key, cfg] of Object.entries(RANGES)) {
    try {
      const got = await fetchTf(cfg.tf, cfg.fromDays, cfg.limit, cfg.resample);
      if (!got.length) throw new Error('empty response');
      bars[key] = got;
      console.log(`${key}: ${got.length} bars (last close ${got[got.length - 1].c})`);
    } catch (e) {
      failures++;
      console.error(`${key}: FAILED — ${e.message}`);
    }
  }
  if (Object.keys(bars).length === 0) {
    console.error('all TFs failed; keeping the previous snapshot');
    process.exit(1);
  }
  // Keep the previous snapshot's bars for any TF that failed this run (the
  // route must never return a half-empty object on a partial outage).
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* first run */ }
  if (prev && prev.bars) {
    for (const k of Object.keys(prev.bars)) {
      if (!bars[k] && Array.isArray(prev.bars[k]) && prev.bars[k].length) bars[k] = prev.bars[k];
    }
  }
  const doc = {
    generatedAt: new Date().toISOString(),
    source: 'dukascopy xauusd (bid, spot)',
    instrument: INSTRUMENT,
    note: 'Real OHLC for the BBMA chart. Futures/spot basis: this is SPOT (matches TradingView XAUUSD).',
    bars
  };
  fs.writeFileSync(OUT, JSON.stringify(doc));
  console.log(`candles-auto.json written: ${Object.keys(bars).length} TFs, ${fs.statSync(OUT).size} bytes, ${((Date.now() - started) / 1000).toFixed(1)}s, ${failures} failures`);
})().catch((e) => { console.error('build-candles fatal:', e); process.exit(1); });
