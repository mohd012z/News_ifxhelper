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

// Yahoo (GC=F) backfill config — same mapping the worker uses for its /api/candles
// fallback, so history stays one instrument (gold).
const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";
const YAHOO_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const TF_YAHOO = {
  M5: { interval: "5m", range: "1mo", baseMs: 300000 },
  M15: { interval: "15m", range: "2mo", baseMs: 900000 },
  M30: { interval: "30m", range: "3mo", baseMs: 1800000 },
  H1: { interval: "60m", range: "1mo", baseMs: 3600000 },
  H4: { interval: "60m", range: "3mo", baseMs: 14400000, aggregate: true },
  D1: { interval: "60m", range: "6mo", baseMs: 86400000, aggregate: true },
  W1: { interval: "60m", range: "2y", baseMs: 604800000, aggregate: true },
  MN1: { interval: "1mo", range: "2y", baseMs: 2592000000 }
};

function aggregateBars(bars, baseMs) {
  const out = [];
  for (const b of bars) {
    const bucket = Math.floor(b.t / baseMs) * baseMs;
    const last = out[out.length - 1];
    if (last && last.t === bucket) {
      if (b.h > last.h) last.h = b.h;
      if (b.l < last.l) last.l = b.l;
      last.c = b.c;
    } else {
      out.push({ t: bucket, o: b.o, h: b.h, l: b.l, c: b.c });
    }
  }
  return out;
}

async function fetchYahooBars(tfKey) {
  const cfg = TF_YAHOO[tfKey];
  if (!cfg) return [];
  // Best-effort: Yahoo free tier is 8 credits/min per IP and can 429 hard. Try
  // both query hosts, short backoff, and FAIL FAST (keep the Dukascopy bars) -
  // a 429 here is not an error, the next 30-min poller cycle has fresh budget.
  const hosts = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"];
  let upstream = null;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const host = hosts[attempt % hosts.length];
      upstream = await fetch(`${host}/v8/finance/chart/GC=F?interval=${cfg.interval}&range=${cfg.range}`, {
        cache: "no-store",
        headers: { "User-Agent": YAHOO_UA, "Accept": "application/json" }
      });
      if (upstream.status === 429) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      break;
    }
  } catch (e) { return []; }
  if (!upstream || !upstream.ok) return [];
  let doc = null;
  try { doc = await upstream.json(); } catch (e) { return []; }
  const res = doc && doc.chart && doc.chart.result && doc.chart.result[0];
  if (!res || !res.timestamp) return [];
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const raw = res.timestamp.map((t, i) => ({
    t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i]
  })).filter((b) => b.o != null && b.h != null && b.l != null && b.c != null);
  // GC=F bars are aligned to COMEX session times, NOT UTC buckets (the worker
  // rebuckets on the client for the same reason). Aggregate to canonical UTC
  // buckets so the result splices into the Dukascopy UTC-aligned series.
  return aggregateBars(raw, cfg.baseMs);
}

/* Dukascopy's feed can lag (observed ~6h: newest H1 bar = previous evening's
 * reopen while gold trades ~70 higher). When that happens the chart shows a
 * time gap and the "previous completed candle" pivot anchors go stale. Backfill
 * the gap with Yahoo GC=F bars (same instrument, futures — consistent with the
 * worker's existing Yahoo fallback): drop the still-forming Yahoo bucket and
 * append only bars STRICTLY NEWER than the Dukascopy last bar. */
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
  const backfills = [];
  for (const [key, cfg] of Object.entries(RANGES)) {
    try {
      const got = await fetchTf(cfg.tf, cfg.fromDays, cfg.limit, cfg.resample);
      if (!got.length) throw new Error('empty response');
      bars[key] = got;
      console.log(`${key}: ${got.length} bars (last close ${got[got.length - 1].c})`);
      // Only backfill intraday TFs (Dukascopy lag matters on M5..H4; D1/W1/MN1
      // are full-period bars where the newest is always the forming one and the
      // pivot logic already skips it).
      if (["M5", "M15", "M30", "H1", "H4"].includes(key)) {
        const lastDuk = got[got.length - 1];
        const cfgY = TF_YAHOO[key];
        const limit = cfg.limit;
        backfills.push((async () => {
          const yb = await fetchYahooBars(key);
          if (!yb.length) return got;
          const now = Date.now();
          const out = got.slice();
          for (const b of yb) {
            if (b.t <= lastDuk.t) continue;       // only fill the gap
            if (b.t + cfgY.baseMs > now) break;   // skip still-forming bucket
            out.push(b);
          }
          const gained = out.length - got.length;
          if (gained > 0) console.log(`${key}: +${gained} Yahoo GC=F bars backfilled the Dukascopy lag (newest ${new Date(out[out.length - 1].t).toISOString()})`);
          return out.slice(-limit);
        })().then((r) => ({ key, bars: r }), () => ({ key, bars: got })));
      }
    } catch (e) {
      failures++;
      console.error(`${key}: FAILED — ${e.message}`);
    }
  }
  await Promise.all(backfills.map(async (p) => {
    const r = await p;
    bars[r.key] = r.bars;
  }));
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
    source: 'dukascopy xauusd (bid, spot) + yahoo GC=F backfill',
    instrument: INSTRUMENT,
    note: 'Real OHLC for the BBMA chart. History = Dukascopy SPOT; the recent Dukascopy lag (when it lags) is backfilled with Yahoo GC=F so the current candle and previous-candle pivots stay current.',
    bars
  };
  fs.writeFileSync(OUT, JSON.stringify(doc));
  console.log(`candles-auto.json written: ${Object.keys(bars).length} TFs, ${fs.statSync(OUT).size} bytes, ${((Date.now() - started) / 1000).toFixed(1)}s, ${failures} failures`);
})().catch((e) => { console.error('build-candles fatal:', e); process.exit(1); });
