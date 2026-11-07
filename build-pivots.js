#!/usr/bin/env node
/* build-pivots.js — Camarilla daily pivot levels for the IFX desk.
 *
 * Method (Camarilla): levels radiate from the PREVIOUS session CLOSE,
 * step = Range × 1.1:
 *   R1 = C + step/12   S1 = C − step/12
 *   R2 = C + step/6    S2 = C − step/6
 *   R3 = C + step/4    S3 = C − step/4
 *   R4 = C + step/2    S4 = C − step/2
 * Reading: R3/S3 = mean-reversion targets, R4/S4 = trend-day breakout.
 *
 * Data: Yahoo Finance v8 chart API, daily bars (no key). The "previous
 * session" is the LAST CLOSED daily bar (date strictly before today UTC) —
 * the in-progress bar is excluded, so levels are stable all day.
 *
 * Output: pivots.js (window.PIVOTS_AUTO) — one entry per symbol, independent
 * fail-closed (a symbol failure is ok:false + reason, never a fabricated
 * level). Consumed by:
 *   - the helix IFX Telegram menu (📐 Camarilla Pivots section)
 *   - report.html (Pivots tab)
 *   - the ifxhelper_Trader channel menu (tap -> in-place recheck)
 *
 * Called by ifx-poller.js in the 30-min slow cycle, then committed+pushed
 * like the other artifacts (freshens GitHub Pages + raw main).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) ifxhelper-pivots/1.0';
// Symbol universe for the Telegram surface. Core 8 get the full R4..S4 ladder
// in the DM menu; the crosses/EM extras render as a compact C/R3/S3 block.
const SYMBOLS = [
  { id: 'XAUUSD', label: 'XAU/USD', ticker: 'GC=F',     decimals: 2 },
  { id: 'EURUSD', label: 'EUR/USD', ticker: 'EURUSD=X', decimals: 4 },
  { id: 'GBPUSD', label: 'GBP/USD', ticker: 'GBPUSD=X', decimals: 4 },
  { id: 'USDJPY', label: 'USD/JPY', ticker: 'JPY=X',    decimals: 2 },
  { id: 'AUDUSD', label: 'AUD/USD', ticker: 'AUDUSD=X', decimals: 4 },
  { id: 'BTCUSD', label: 'BTC/USD', ticker: 'BTC-USD',  decimals: 0 },
  { id: 'ETHUSD', label: 'ETH/USD', ticker: 'ETH-USD',  decimals: 0 },
  { id: 'DXY',    label: 'DXY',     ticker: 'DX-Y.NYB', decimals: 2 },
  // Crosses
  { id: 'USDMYR', label: 'USD/MYR', ticker: 'USDMYR=X', decimals: 4 },
  { id: 'NZDUSD', label: 'NZD/USD', ticker: 'NZDUSD=X', decimals: 4 },
  { id: 'USDCAD', label: 'USD/CAD', ticker: 'USDCAD=X', decimals: 4 },
  { id: 'USDCHF', label: 'USD/CHF', ticker: 'USDCHF=X', decimals: 4 },
  { id: 'EURJPY', label: 'EUR/JPY', ticker: 'EURJPY=X', decimals: 2 },
  { id: 'GBPJPY', label: 'GBP/JPY', ticker: 'GBPJPY=X', decimals: 2 },
  { id: 'EURGBP', label: 'EUR/GBP', ticker: 'EURGBP=X', decimals: 4 },
  { id: 'AUDJPY', label: 'AUD/JPY', ticker: 'AUDJPY=X', decimals: 2 },
  // Emerging markets (MYR is the desk home market; IDR ticks in ~1000s)
  { id: 'USDIDR', label: 'USD/IDR', ticker: 'USDIDR=X', decimals: 0 },
  { id: 'USDTHB', label: 'USD/THB', ticker: 'USDTHB=X', decimals: 2 },
];

async function fetchDaily(ticker, timeoutMs = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10d&interval=1d`,
      { headers: { 'User-Agent': UA }, signal: ac.signal }
    );
    if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) throw new Error('no chart result');
    const ts = res.timestamp || [];
    const q = (res.indicators?.quote || [])[0] || {};
    const rows = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.high[i] == null || q.low[i] == null || q.close[i] == null) continue;
      rows.push({ day: new Date(ts[i] * 1000).toISOString().slice(0, 10), h: q.high[i], l: q.low[i], c: q.close[i] });
    }
    return rows;
  } finally { clearTimeout(t); }
}

function prevSession(rows) {
  const today = new Date().toISOString().slice(0, 10);
  // last CLOSED bar: date strictly before today (UTC).
  const closed = rows.filter((r) => r.day < today);
  return closed.length ? closed[closed.length - 1] : null;
}

/* Pure: previous-session HLC -> Camarilla levels. Exported for tests. */
function camarilla({ h, l, c }) {
  const range = h - l;
  const step = range * 1.1;
  return {
    range,
    R1: c + step / 12, R2: c + step / 6, R3: c + step / 4, R4: c + step / 2,
    S1: c - step / 12, S2: c - step / 6, S3: c - step / 4, S4: c - step / 2,
  };
}

/* How much of the previous session's range the close sits in (0 = closed at
 * the low, 1 = closed at the high). Honest session-character read (bullish
 * close vs bearish close) — deterministic, no live price involved. */
function closePosition(lvIn) {
  const { h, l, c } = lvIn;
  if (h <= l) return 0.5;
  return Math.round(Math.max(0, Math.min(1, (c - l) / (h - l))) * 100) / 100;
}

async function main() {
  const out = { method: 'camarilla', generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + 'Z', session: null, symbols: {} };
  for (const s of SYMBOLS) {
    try {
      const rows = await fetchDaily(s.ticker);
      const prev = prevSession(rows);
      if (!prev) throw new Error('no closed daily bar');
      const lv = camarilla(prev);
      out.session = out.session || prev.day;
      out.symbols[s.id] = {
        ok: true, label: s.label, ticker: s.ticker, decimals: s.decimals,
        session: prev.day, h: prev.h, l: prev.l, c: prev.c,
        ...lv, closePos: closePosition(prev),
      };
      console.log(`${s.label} ok session=${prev.day} C=${prev.c} R3=${lv.R3.toFixed(s.decimals)} S3=${lv.S3.toFixed(s.decimals)}`);
    } catch (e) {
      out.symbols[s.id] = { ok: false, label: s.label, ticker: s.ticker, decimals: s.decimals, reason: String(e?.message || e) };
      console.log(`${s.label} FAIL ${e.message}`);
    }
  }
  const okCount = Object.values(out.symbols).filter((x) => x.ok).length;
  const body = `/* Auto-generated by build-pivots.js — Camarilla daily pivots (previous session ${out.session ?? 'n/a'}, ${okCount}/${SYMBOLS.length} symbols ok).\n * Levels radiate from the previous close: step=Range*1.1; R/S = C ± step/{12,6,4,2}.\n * R3/S3 = mean-reversion targets · R4/S4 = trend-day breakout. Research context only. */\nwindow.PIVOTS_AUTO = ${JSON.stringify(out, null, 2)};\n`;
  fs.writeFileSync(path.join(__dirname, 'pivots.js'), body);
  console.log(`wrote pivots.js (${okCount}/${SYMBOLS.length} ok, session ${out.session ?? 'n/a'})`);
  if (okCount === 0) { console.error('all symbols failed — keeping file (all ok:false)'); process.exitCode = 1; }
}

if (require.main === module) {
  main().catch((e) => { console.error('build-pivots fatal:', e); process.exit(1); });
}
module.exports = { camarilla, prevSession, closePosition };
