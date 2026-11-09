'use strict';
/* bbma-telegram-signals.js
 * Server-side BBMA matrix for Telegram alerts — the same per-timeframe signals the web
 * dashboard shows (TREND / MOMENTUM / RE-ENTRY / CSA / MHV / EXTREME / BB ZONE), computed
 * with lib/bbma-engine.js (pure, deterministic).
 *
 * Data sources (fail-closed, never a fabricated signal):
 *  - XAU/USD: the repo's Dukascopy snapshot candles-auto.json (30-min poller, spot, no network).
 *    Skipped when the snapshot is stale (>3h) so alerts never quote a frozen market.
 *  - FX / crypto: Yahoo chart API (same proven provider used by build-bbma-watch / ATR path),
 *    three small requests per symbol with an in-process 10-min cache; on any failure a short
 *    "unavailable" line is rendered instead of guessing.
 *
 * W1/MN1 use the previous COMPLETED week/month (calendar resample, requireComplete) — the
 * same "previous closed candle" rule the pivot calculator uses.
 */
const fs = require('fs');
const path = require('path');
const Engine = require('./bbma-engine');
const Resampler = require('./ohlc-resampler');

const TF_ORDER = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1'];
const CACHE_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_MAX_AGE_MS = 90 * 60 * 1000; // snapshot refreshes every 30 min; >90m means the poller is stuck
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const sleep = ms => new Promise(res => setTimeout(res, ms));

/* Dukascopy display symbols -> instruments (lowercase, no slash). Keyless + no rate limit,
 * so it is the PRIMARY live source for gold + FX (same feed the 30-min poller uses). */
const DUKA_MAP = {
  'XAU/USD': 'xauusd', 'EUR/USD': 'eurusd', 'GBP/USD': 'gbpusd', 'USD/JPY': 'usdjpy',
  'AUD/USD': 'audusd', 'USD/CAD': 'usdcad', 'USD/CHF': 'usdchf', 'NZD/USD': 'nzdusd',
  'BTC/USD': 'btcusd', 'ETH/USD': 'ethusd'
};
function dukaInstrumentFor(sym) { return Object.prototype.hasOwnProperty.call(DUKA_MAP, sym) ? DUKA_MAP[sym] : null; }
async function dukascopyChart(instrument, timeframe, fromDays) {
  const { getHistoricalRates } = require('dukascopy-node');
  const from = new Date(Date.now() - fromDays * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // `to` is exclusive
  const rows = await getHistoricalRates({
    instrument, dates: { from, to }, timeframe, priceType: 'bid', format: 'array',
    batchSize: 10, pauseBetweenBatchesMs: 400, timeoutMs: 20000,
    retryCount: 2, pauseBetweenRetriesMs: 800, failAfterRetryCount: false
  });
  // dukascopy-node rows are arrays: [timeMs, open, high, low, close, volume]
  const bars = (rows || [])
    .filter(r => Array.isArray(r) && r.length >= 5 && [r[0], r[1], r[2], r[3], r[4]].every(Number.isFinite))
    .map(r => ({ time: new Date(r[0]).toISOString(), open: +r[1], high: +r[2], low: +r[3], close: +r[4] }));
  const out = [];
  for (const b of bars) { const last = out[out.length - 1]; if (last && Date.parse(b.time) <= Date.parse(last.time)) continue; out.push(b); }
  return out;
}

/* Dashboard display symbols -> Yahoo chart symbols (the only two families the alert card
 * can focus on: gold, FX majors, BTC/ETH). Unknown symbol -> null (block is omitted). */
const YAHOO_MAP = {
  'XAU/USD': 'GC=F', 'BTC/USD': 'BTC-USD', 'ETH/USD': 'ETH-USD',
  'EUR/USD': 'EURUSD=X', 'GBP/USD': 'GBPUSD=X', 'USD/JPY': 'USDJPY=X',
  'AUD/USD': 'AUDUSD=X', 'USD/CAD': 'USDCAD=X', 'USD/CHF': 'USDCHF=X', 'NZD/USD': 'NZDUSD=X'
};
function yahooSymbolFor(sym) { return Object.prototype.hasOwnProperty.call(YAHOO_MAP, sym) ? YAHOO_MAP[sym] : null; }

function normalizeCandles(result) {
  const q = (result && result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const ts = result.timestamp || [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open && q.open[i] == null) continue;
    if (q.high && q.high[i] == null) continue;
    if (q.low && q.low[i] == null) continue;
    if (q.close && q.close[i] == null) continue;
    out.push({ time: new Date(ts[i] * 1000).toISOString(), open: +q.open[i], high: +q.high[i], low: +q.low[i], close: +q.close[i] });
  }
  return out;
}
async function yahooChart(symbol, interval, range) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) +
    '?interval=' + encodeURIComponent(interval) + '&range=' + encodeURIComponent(range);
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (r.ok) return normalizeCandles(((await r.json()).chart && r.chart.result && r.chart.result[0]) || null);
    if (r.status !== 429 || attempt === 1) throw new Error('YAHOO_HTTP_' + r.status);
    await new Promise(res => setTimeout(res, 4000));
  }
  return [];
}

/* Build the 8 dashboard frames. m15 = 15-min bars (60d), m5 = 5-min bars (5d), daily = 1-day bars (1y). */
/* W1/MN1 from daily bars, bucketed by UTC week/month. Unlike resampleCalendar this KEEPS the
 * in-progress period (a partial week still trades) — the engine's <50-bars guard discards any
 * frame too short to be meaningful, so no extra completion rule is needed. */
function weeklyFromDaily(daily) {
  const buckets = new Map();
  for (const r of daily || []) {
    const d = new Date(r.time);
    const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const start = ms - (((d.getUTCDay() + 6) % 7) * 86400000); // Monday 00:00Z
    if (!buckets.has(start)) buckets.set(start, []);
    buckets.get(start).push(r);
  }
  return aggregateBuckets(buckets);
}
function monthlyFromDaily(daily) {
  const buckets = new Map();
  for (const r of daily || []) {
    const d = new Date(r.time);
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    if (!buckets.has(start)) buckets.set(start, []);
    buckets.get(start).push(r);
  }
  return aggregateBuckets(buckets);
}
function aggregateBuckets(buckets) {
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([key, b]) => {
    b.sort((x, y) => new Date(x.time) - new Date(y.time));
    return {
      time: new Date(key).toISOString(),
      open: +b[0].open, high: Math.max(...b.map(x => +x.high)),
      low: Math.min(...b.map(x => +x.low)), close: +b[b.length - 1].close,
      sourceCount: b.length
    };
  });
}
function framesFromFetches(m15, m5, daily) {
  const frames = {};
  if (Array.isArray(m5) && m5.length >= 50) frames.M5 = m5;
  if (Array.isArray(m15)) {
    frames.M15 = m15;
    frames.M30 = Resampler.resample(m15, 30, { sourceMinutes: 15 });
    frames.H1 = Resampler.resample(m15, 60, { sourceMinutes: 15 });
    frames.H4 = Resampler.resample(m15, 240, { sourceMinutes: 15 });
  }
  if (Array.isArray(daily) && daily.length) {
    frames.D1 = daily;
    frames.W1 = weeklyFromDaily(daily);
    frames.MN1 = monthlyFromDaily(daily);
  }
  return frames;
}
function framesFromSnapshot(doc) {
  const bars = (doc && doc.bars) || {};
  const map = b => ({ time: new Date(b.t).toISOString(), open: +b.o, high: +b.h, low: +b.l, close: +b.c });
  const frames = {};
  for (const tf of TF_ORDER) if (Array.isArray(bars[tf]) && bars[tf].length) frames[tf] = bars[tf].map(map);
  return frames;
}

/* Per-TF row. classify() needs 50+ bars; fewer -> the row is reported insufficient (never
 * computed on a stub). MHV mirrors the runtime: momentum holding a valid extreme inside the
 * band against the trend (upside in the web runtime; both sides here, still descriptive). */
function rowFor(tf, frame) {
  const c = frame || [];
  if (c.length < 50) return { tf, state: 'INSUFFICIENT', reason: c.length + ' bars (<50)' };
  const x = Engine.classify(c);
  if (!x || x.state !== 'READY') return { tf, state: 'INSUFFICIENT', reason: (x && x.state) || 'unready' };
  const v = x.values;
  const mhv = (x.trend === 'UP' && x.momentum === 'MOMENTUM_UP' && v.close > v.bb.mid) ||
    (x.trend === 'DOWN' && x.momentum === 'MOMENTUM_DOWN' && v.close < v.bb.mid) ? 'VALID_MHV' : 'NONE';
  return { tf, state: 'READY', trend: x.trend, momentum: x.momentum, reentry: x.reentry, csak: x.csak, mhv, extreme: x.extreme, zone: x.zone, emaGap: x.emaGap, lastTime: x.lastTime };
}

const SHORT = { UP: '↑', DOWN: '↓', MIXED: '·', FLAT: '·', MOMENTUM_UP: 'MOM↑', MOMENTUM_DOWN: 'MOM↓', NONE: '—', CSAK_UP: 'CSA↑', CSAK_DOWN: 'CSA↓', EXTREME_HIGH: 'EXT HIGH', EXTREME_LOW: 'EXT LOW', VALID_MHV: 'MHV VALID', ABOVE_TOP_BB: 'ABOVE_TOP', BELOW_LOW_BB: 'BELOW_LOW', ABOVE_TOP: 'top', BELOW_LOW: 'low', MID_TO_TOP: 'mid-top', LOW_TO_MID: 'low-mid', REENTRY_UP_ZONE: 'RE↑', REENTRY_DOWN_ZONE: 'RE↓', EMA50_ABOVE_BB: 'EMA50↑', EMA50_BELOW_BB: 'EMA50↓', EMA50_INSIDE_BB: 'EMA50·' };
function short(v) { return SHORT[v] || (v && v !== 'NONE' && v !== 'FLAT' ? String(v) : '—'); }

/* Compact one-line-per-TF block matching the dashboard matrix vocabulary (M5..MN1 order top-down
 * in the card = same as the dashboard's reversed table read). */
function renderLines(signal) {
  if (!signal) return ['📊 BBMA TIMEFRAME SIGNALS: unavailable (no source) — see dashboard.'];
  if (!signal.ok) return ['📊 BBMA TIMEFRAME SIGNALS: unavailable (' + escSignal(signal.reason) + ') — see dashboard.'];
  const lines = [
    '📊 BBMA TIMEFRAME SIGNALS — ' + signal.symbol + ' · ' + escSignal(signal.source) + ' · live close ' + (signal.price != null ? Number(signal.price).toFixed(2) : '—'),
    '🧭 Alignment: ' + signal.alignment + (signal.directional ? ' (' + signal.directional.up + ' up / ' + signal.directional.down + ' down of ' + signal.directional.total + ' directional)' : '') + ' · technical context only, not an order call'
  ];
  for (const tf of TF_ORDER) {
    const r = signal.frames[tf];
    if (!r || r.state !== 'READY') { lines.push('  ' + tf + ': — ' + (r ? short(r.reason) : 'NO_DATA')); continue; }
    lines.push('  ' + tf + ': ' + short(r.trend) + ' · ' + short(r.momentum) + ' · ' + short(r.csak) + ' · ' + short(r.mhv) + ' · ' + short(r.extreme) + ' · ' + short(r.reentry) + ' · ' + short(r.zone));
  }
  return lines;
}
function escSignal(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* Compact ONE-LINE render (Anam: full block was "too much"): symbol · arrows per TF · alignment
 * · active tags only (CSA/MHV/EXT/RE-ENTRY). Full block stays available via renderLines(). */
function renderCompact(signal) {
  const arrow = t => t === 'UP' ? '↑' : t === 'DOWN' ? '↓' : '·';
  if (!signal || !signal.ok) return '📊 BBMA ' + (signal ? escSignal(signal.symbol) : '') + ' — n/a (' + (signal ? escSignal(signal.reason) : 'no source') + ')';
  const tfArr = TF_ORDER.slice().reverse().map(tf => { const r = signal.frames && signal.frames[tf]; return (r && r.state === 'READY') ? tf + ' ' + arrow(r.trend) : tf + ' ·'; }).join(' ');
  const tags = [];
  const tagDir = (label, v) => {
    const s = String(v);
    if (label === 'EXT') return s.includes('HIGH') ? '↓' : s.includes('LOW') ? '↑' : '·';
    if (label === 'MHV') return '·'; // validation tag, no direction
    if (label === 'RE') return s.includes('UP') ? '↑' : s.includes('DOWN') ? '↓' : '·';
    return s.includes('UP') ? '↑' : s.includes('DOWN') ? '↓' : '·'; // CSA / MOM
  };
  for (const tf of TF_ORDER) {
    const r = signal.frames && signal.frames[tf];
    if (!r || r.state !== 'READY') continue;
    for (const [label, key] of [['CSA', 'csak'], ['MHV', 'mhv'], ['EXT', 'extreme'], ['RE', 'reentry']]) {
      const v = r[key];
      if (v && v !== 'NONE') tags.push(tf + ' ' + label + tagDir(label, v));
    }
  }
  const align = signal.alignment === 'UP_ALIGNED' ? 'aligned ↑' : signal.alignment === 'DOWN_ALIGNED' ? 'aligned ↓' : 'mixed';
  return '📊 BBMA ' + signal.symbol + ' · ' + tfArr + ' · ' + align + (tags.length ? ' · ' + tags.slice(0, 4).join(', ') + (tags.length > 4 ? '…' : '') : '');
}

const cache = new Map(); // symbol -> { at, signal }
function cached(symbol) {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.signal;
  return null;
}
function remember(symbol, signal) { cache.set(symbol, { at: Date.now(), signal }); }

/* Main entry: resolve the focus symbol to a signal set. Gold prefers the Dukascopy snapshot
 * (no network); when its newest bar is lagging (Dukascopy gaps), it falls back to Yahoo GC=F
 * like the FX path. Never throws — returns a fail-closed descriptor for renderLines(). */
async function buildSignalFor(sym, { snapshotPath } = {}) {
  const key = String(sym || '').toUpperCase();
  const fresh = cached(key);
  if (fresh) return fresh;
  let signal;
  if (key === 'XAU/USD') {
    const p = snapshotPath || path.join(__dirname, '..', 'candles-auto.json');
    try {
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      const age = Date.now() - Date.parse(doc.generatedAt || 0);
      const bars = (doc && doc.bars) || {};
      const h1 = Array.isArray(bars.H1) ? bars.H1 : [];
      const newestBarAge = h1.length ? Date.now() - (h1.at(-1).t || 0) : Infinity;
      // Freshness = both the build stamp AND the newest bar. Dukascopy can lag hours (weekends,
      // gaps): in that case the snapshot is "fresh" but the data is stale -> Yahoo fallback.
      if (!Number.isFinite(age) || age > SNAPSHOT_MAX_AGE_MS) throw new Error('SNAPSHOT_STALE_' + Math.round(age / 60000) + 'm');
      if (!Number.isFinite(newestBarAge) || newestBarAge > 4 * 60 * 60 * 1000) throw new Error('SNAPSHOT_DATA_LAG_' + Math.round(newestBarAge / 60000) + 'm');
      const frames = framesFromSnapshot(doc);
      if (!frames.H1) throw new Error('SNAPSHOT_EMPTY');
      signal = compose(key, 'Dukascopy spot (30-min)', frames);
    } catch (e) {
      signal = await liveSignals(key);
      if (!signal.ok) signal = { ok: false, symbol: key, reason: 'GOLD_UNAVAILABLE (' + e.message + ')' };
    }
  } else {
    signal = await liveSignals(key);
  }
  remember(key, signal);
  return signal;
}
async function liveSignals(key) {
  const di = dukaInstrumentFor(key);
  if (di) {
    try {
      // Sequential: Dukascopy batches are polite but 3 in parallel can throttle too.
      const m15 = await dukascopyChart(di, 'm15', 90);
      await sleep(400);
      const m5 = await dukascopyChart(di, 'm5', 7);
      await sleep(400);
      const daily = await dukascopyChart(di, 'd1', 1830); // 5y: MN1 needs ~50 monthly bars (4.2y) to clear the 50-bar guard
      const frames = framesFromFetches(m15, m5, daily);
      if (frames.H1 && frames.H1.length >= 2) {
        const signal = compose(key, 'Dukascopy spot (live)', frames);
        const src = frames.M5 || frames.M15 || frames.H1;
        signal.price = src && src.at(-1) ? src.at(-1).close : null;
        return signal;
      }
      throw new Error('DUKA_EMPTY');
    } catch (e) {
      const y = yahooSymbolFor(key);
      if (y) {
        const fb = await yahooSignals(key, y);
        if (fb.ok) return fb;
        return { ok: false, symbol: key, reason: e.message + ' / ' + fb.reason };
      }
      return { ok: false, symbol: key, reason: e.message };
    }
  }
  const y = yahooSymbolFor(key);
  if (!y) return { ok: false, symbol: key, reason: 'UNSUPPORTED_SYMBOL' };
  return yahooSignals(key, y);
}
async function yahooSignals(key, y) {
  try {
    // Sequential (not Promise.all): the free Yahoo chart tier is ~8 req/min/IP, so 3
    // back-to-back requests on one burst are far less likely to 429 than 3 in parallel.
    const m15 = await yahooChart(y, '15m', '3mo');
    await sleep(1200);
    const m5 = await yahooChart(y, '5m', '5d');
    await sleep(1200);
    const daily = await yahooChart(y, '1d', '1y');
    const frames = framesFromFetches(m15, m5, daily);
    if (!frames.H1) throw new Error('NO_DATA (Yahoo 429/empty)');
    const signal = compose(key, 'Yahoo ' + y + ' proxy', frames);
    const src = frames.M5 || frames.M15 || frames.H1;
    signal.price = src && src.at(-1) ? src.at(-1).close : null;
    return signal;
  } catch (e) { return { ok: false, symbol: key, reason: e.message }; }
}
function compose(symbol, source, frames) {
  const out = {};
  const mtfIn = {};
  for (const tf of TF_ORDER) if (frames[tf] && frames[tf].length) mtfIn[tf] = frames[tf];
  const mtf = Engine.mtf(mtfIn);
  for (const tf of TF_ORDER) out[tf] = rowFor(tf, frames[tf]);
  const dirs = Object.values(mtf.frames).filter(x => x.state === 'READY' && (x.trend === 'UP' || x.trend === 'DOWN'));
  return {
    ok: true, symbol, source, alignment: mtf.alignment,
    directional: { up: dirs.filter(x => x.trend === 'UP').length, down: dirs.filter(x => x.trend === 'DOWN').length, total: dirs.length },
    frames: out, price: null, generatedAt: new Date().toISOString()
  };
}

module.exports = { yahooSymbolFor, dukaInstrumentFor, framesFromFetches, rowFor, renderLines, renderCompact, buildSignalFor, compose, TF_ORDER, _cache: cache };
