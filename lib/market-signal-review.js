'use strict';

/**
 * Data-integrity adapter for retrospective headline reactions and optional ATR
 * scenarios. Impact scores are heuristic classifications, NOT calibrated price
 * return forecasts. This module never fetches or places orders.
 */
const WINDOW_MINUTES = Object.freeze({
  M1: 1, M5: 5, M15: 15, M30: 30, H1: 60,
  H4: 240, D1: 1440, W1: 10080, MN1: 43200
});

function finite(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function positive(v) {
  const n = finite(v);
  return n !== null && n > 0 ? n : null;
}
function timeMs(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
function pctChange(from, to) {
  return Math.round(((to - from) / from) * 100000) / 1000;
}
function timingTolerance(minutes) {
  if (minutes <= 60) return 5;
  if (minutes <= 240) return 30;
  if (minutes <= 1440) return 90;
  return 360;
}
function describeSource(record) {
  if (record.priceSource) return String(record.priceSource);
  if (record.tabId === 'gold') return 'Yahoo GC=F gold futures proxy (not XAU/USD spot)';
  if (record.tabId === 'forex') return 'Yahoo EURUSD=X';
  if (record.tabId === 'crypto') return 'Coinbase BTC-USD';
  return 'Unspecified source';
}

/** Recompute realized change from recorded prices instead of trusting a stale
 * top-level result schema. Never infer flat or correct/wrong from missing data. */
function normalizePriceTrack(record) {
  const r = record || {};
  const start = positive(r.priceAtDetect);
  const impact = finite(r.impactScore) !== null ? finite(r.impactScore) : finite(r.predictedPct);
  const recorded = (Array.isArray(r.checkpoints) ? r.checkpoints : [])
    .filter(cp => cp && positive(cp.price) !== null && timeMs(cp.capturedAt) !== null)
    .sort((a, b) => (WINDOW_MINUTES[a.key] || 0) - (WINDOW_MINUTES[b.key] || 0));
  let cp = recorded.length ? recorded[recorded.length - 1] : null;
  // Old 45-minute schema: accept it only if the new checkpoint array is absent.
  if (!cp && !Array.isArray(r.checkpoints) && positive(r.priceAtSettle) !== null) {
    cp = { key: 'LEGACY', price: r.priceAtSettle, capturedAt: r.settledAt || r.completedAt || null, dueAt: null };
  }
  const end = cp ? positive(cp.price) : null;
  const capturedAt = cp && timeMs(cp.capturedAt) !== null ? new Date(timeMs(cp.capturedAt)).toISOString() : null;
  const dueAt = cp && timeMs(cp.dueAt) !== null ? new Date(timeMs(cp.dueAt)).toISOString() : null;
  const lag = capturedAt && dueAt ? +((timeMs(capturedAt) - timeMs(dueAt)) / 60000).toFixed(1) : null;
  const tolerance = cp && WINDOW_MINUTES[cp.key] ? timingTolerance(WINDOW_MINUTES[cp.key]) : null;
  const timing = lag === null ? 'UNKNOWN' : lag < -1 ? 'EARLY' : lag > tolerance ? 'LATE' : 'ON_TIME';
  const observed = start !== null && end !== null;
  return {
    status: observed ? 'OBSERVED' : 'UNVERIFIED',
    title: String(r.title || ''),
    url: String(r.url || ''),
    symbol: r.tabId === 'gold' ? 'GC=F' : r.tabId === 'forex' ? 'EURUSD=X' : r.tabId === 'crypto' ? 'BTC-USD' : String(r.tabId || 'UNKNOWN'),
    priceSource: describeSource(r),
    impactScore: impact,
    impactDirection: impact === null || impact === 0 ? 'NEUTRAL' : impact > 0 ? 'UP' : 'DOWN',
    priceAtDetect: start,
    priceAtObservation: end,
    observedPct: observed ? pctChange(start, end) : null,
    checkpoint: cp ? cp.key : null,
    dueAt,
    capturedAt,
    captureLagMinutes: lag,
    timing,
    observedCheckpoints: recorded.length,
    totalCheckpoints: Array.isArray(r.checkpoints) ? r.checkpoints.length : null,
    detectedAt: timeMs(r.createdAt) === null ? null : new Date(timeMs(r.createdAt)).toISOString(),
    isCalibratedForecast: false
  };
}
function isoAt(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  // build-atr.js historically serializes a UTC ISO value without T/Z.
  const fixed = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v) ? v.replace(' ', 'T') + 'Z' : v;
  return timeMs(fixed);
}
function unavailable(reason) { return { valid: false, reason }; }

/**
 * Conditional price levels, not an order recommendation. Quote and ATR must
 * describe the identical provider instrument (e.g. GC=F / GC=F).
 */
function buildAtrTargets(input) {
  const v = input || {};
  const price = positive(v.price), atr = positive(v.atr);
  if (!['BUY', 'SELL'].includes(v.signal)) return unavailable('NO_DIRECTION');
  if (!v.quoteSymbol || !v.atrSymbol || v.quoteSymbol !== v.atrSymbol)
    return unavailable('INSTRUMENT_MISMATCH');
  if (price === null || atr === null) return unavailable('INVALID_PRICE_OR_ATR');
  const now = v.now === undefined ? Date.now() : isoAt(v.now);
  const quoteAt = isoAt(v.quoteAt), atrAt = isoAt(v.atrAt);
  if (now === null || quoteAt === null || atrAt === null) return unavailable('MISSING_TIMESTAMP');
  const quoteAge = (now - quoteAt) / 60000, atrAge = (now - atrAt) / 3600000;
  if (quoteAge < -1 || atrAge < -1) return unavailable('FUTURE_TIMESTAMP');
  if (quoteAge > (v.maxQuoteAgeMinutes || 15)) return unavailable('STALE_QUOTE');
  if (atrAge > (v.maxAtrAgeHours || 48)) return unavailable('STALE_ATR');
  if (v.marketOpen === false) return unavailable('MARKET_CLOSED');
  const s = v.signal === 'BUY' ? 1 : -1;
  const sl = price - s * 1.2 * atr, tp1 = price + s * 1.5 * atr, tp2 = price + s * 2.5 * atr;
  const rounded = n => +n.toFixed(v.decimals === undefined ? 3 : v.decimals);
  if (sl <= 0 || tp1 <= 0 || tp2 <= 0) return unavailable('NONPOSITIVE_LEVEL');
  return {
    valid: true, kind: 'ATR_SCENARIO', instrument: v.quoteSymbol, signal: v.signal,
    entry: rounded(price), sl: rounded(sl), tp1: rounded(tp1), tp2: rounded(tp2),
    riskReward1: +(1.5 / 1.2).toFixed(3), riskReward2: +(2.5 / 1.2).toFixed(3),
    quoteAt: new Date(quoteAt).toISOString(), atrAt: new Date(atrAt).toISOString(),
    note: 'Illustrative volatility geometry; does not predict market direction or guarantee TP.'
  };
}

/**
 * Build every timeframe independently. A higher-timeframe ATR must NEVER be
 * copied into M1/M5 or relabeled as a spot-gold forecast.
 * READY means only that inputs passed provenance/freshness gates.
 */
const ALL_TF = require('./atr-mtf-engine').FRAMES;
function buildMultiTimeframeTargets(input) {
  const v=input||{}, quote=v.quote||null, mtf=v.atrMtf||null;
  const out={};
  for(const def of ALL_TF){
    const tf=def.tf, row=mtf&&mtf.timeframes&&mtf.timeframes[tf];
    const unavailableRow=(reason)=>({tf,valid:false,reason,atr:row&&row.atr||null,
      sourceInterval:row&&row.sourceInterval||def.source,atrAt:row&&row.asOf||null});
    if(!quote||!quote.symbol||!quote.source){
      out[tf]=unavailableRow('QUOTE_UNAVAILABLE');continue;
    }
    if(!row) {out[tf]=unavailableRow('ATR_TIMEFRAME_MISSING');continue;}
    if(row.state!=='READY'||!(row.atr>0)) {
      out[tf]=unavailableRow(row.reason||'ATR_TIMEFRAME_UNAVAILABLE');continue;
    }
    if(row.instrument!==quote.symbol||row.source!==quote.source ||
       (mtf.instrument&&mtf.instrument!==quote.symbol) ||
       (mtf.source&&mtf.source!==quote.source)){
      out[tf]=unavailableRow('INSTRUMENT_MISMATCH');continue;
    }
    const target=buildAtrTargets({
      signal:v.signal,price:quote.price,atr:row.atr,
      quoteSymbol:quote.symbol,atrSymbol:row.instrument,quoteAt:quote.marketAt,
      atrAt:row.asOf,now:v.now,marketOpen:v.marketOpen,
      maxAtrAgeHours:def.atrAgeHours,maxQuoteAgeMinutes:15
    });
    out[tf]={tf,...target,atr:row.atr,atrAt:row.asOf,sourceInterval:row.sourceInterval,
      market:mtf.market||null};
  }
  const ready=Object.values(out).filter(x=>x.valid).length;
  return {state:ready===ALL_TF.length?'READY':ready?'PARTIAL':'UNAVAILABLE',
    readyCount:ready,total:ALL_TF.length,timeframes:out,
    note:'ATR14 calculated separately for all nine closed-candle timeframes; illustrative levels only.'};
}
module.exports = { WINDOW_MINUTES, normalizePriceTrack, buildAtrTargets, buildMultiTimeframeTargets };
