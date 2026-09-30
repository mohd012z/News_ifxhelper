'use strict';

/**
 * Free-first event-data fabric for market context.
 * IMPORTANT: events are contextual evidence only. This module never creates BUY/SELL,
 * direction, execution, SL/TP, sizing, or broker instructions.
 */

const DEFAULT_TIMEOUT_MS = 8000;

const CCY_MARKETS = {
  USD: ['forex','commodity','crypto'], EUR: ['forex'], GBP: ['forex'], JPY: ['forex'],
  AUD: ['forex','commodity'], NZD: ['forex'], CAD: ['forex','commodity'], CHF: ['forex'],
  CNY: ['forex','commodity','crypto']
};

function timeoutSignal(ms = DEFAULT_TIMEOUT_MS) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  return undefined;
}

async function fetchJson(url, options = {}) {
  const r = await fetch(url, { ...options, signal: options.signal || timeoutSignal(options.timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function iso(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function impact(v) {
  const s = String(v || '').toLowerCase();
  if (s.includes('high') || s === '3') return 'HIGH';
  if (s.includes('medium') || s.includes('med') || s === '2') return 'MEDIUM';
  if (s.includes('low') || s === '1') return 'LOW';
  return 'UNKNOWN';
}

function normalizeCalendarEvent(e, source = 'faireconomy') {
  const currency = String(e.currency || e.country || '').toUpperCase();
  const timestamp = iso(e.date || e.datetime || e.time);
  return {
    id: `${source}:${timestamp || 'unknown'}:${currency}:${e.title || e.event || 'event'}`,
    source,
    sourceType: 'economic-calendar',
    title: e.title || e.event || 'Economic event',
    timestamp,
    displayedDate: timestamp,
    currency,
    country: e.country || null,
    impact: impact(e.impact),
    forecast: e.forecast ?? null,
    previous: e.previous ?? null,
    actual: e.actual ?? null,
    markets: CCY_MARKETS[currency] || ['forex'],
    instruments: [],
    url: e.url || null,
    estimated: false,
    actionable: false
  };
}

async function fetchFairEconomyCalendar() {
  const data = await fetchJson('https://nfs.faireconomy.media/ff_calendar_thisweek.json');
  if (!Array.isArray(data)) throw new Error('Unexpected FairEconomy calendar payload');
  return data.map(e => normalizeCalendarEvent(e));
}

function normalizeCoinMarketCalEvent(e) {
  const coins = Array.isArray(e.coins) ? e.coins : [];
  return {
    id: `coinmarketcal:${e.id}`,
    source: 'coinmarketcal',
    sourceType: 'crypto-event',
    title: e.title || 'Crypto event',
    timestamp: iso(e.date),
    displayedDate: e.displayedDate || null,
    currency: null,
    country: null,
    impact: typeof e.impact === 'number' ? e.impact : null,
    forecast: null,
    previous: null,
    actual: null,
    markets: ['crypto'],
    instruments: coins.map(c => String(c.symbol || c.slug || '').toUpperCase()).filter(Boolean),
    url: null,
    estimated: Boolean(e.isEstimated),
    actionable: false
  };
}

async function fetchCoinMarketCal({ apiKey, from, to, coins, limit = 100 } = {}) {
  if (!apiKey) return [];
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (coins && coins.length) q.set('coins', coins.join(','));
  q.set('limit', String(Math.min(100, Math.max(1, limit))));
  const data = await fetchJson(`https://api.coinmarketcal.com/v2/events?${q}`, {
    headers: { 'x-api-key': apiKey, Accept: 'application/json' }
  });
  return (data.data || []).map(normalizeCoinMarketCalEvent);
}

function dedupe(events) {
  const seen = new Set();
  return events.filter(e => {
    const minute = e.timestamp ? e.timestamp.slice(0, 16) : e.displayedDate || '';
    const key = `${(e.title || '').toLowerCase()}|${e.currency || ''}|${minute}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : Number.MAX_SAFE_INTEGER;
    const tb = b.timestamp ? Date.parse(b.timestamp) : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
}

function relevance(event, market, symbol = '') {
  if (!event || !event.markets || !event.markets.includes(market)) return false;
  if (!symbol) return true;
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Coin events: match by the listed instruments (symbol contains the ticker).
  if (event.instruments && event.instruments.length)
    return event.instruments.some(x => s.includes(x));
  // Calendar events: match by the event's currency (USD CPI is relevant to
  // EURUSD / XAUUSD, but NOT to EURJPY).
  if (event.currency) return s.includes(event.currency);
  // No instruments and no currency: relevance cannot be established — fail
  // closed (the previous fall-through returned true for every symbol).
  return false;
}

async function collectEventData(options = {}) {
  const providers = [
    ['faireconomy', () => fetchFairEconomyCalendar()],
    ['coinmarketcal', () => fetchCoinMarketCal(options.coinMarketCal || {})]
  ];
  const settled = await Promise.allSettled(providers.map(([, fn]) => fn()));
  const health = {};
  const all = [];
  settled.forEach((r, i) => {
    const name = providers[i][0];
    if (r.status === 'fulfilled') {
      health[name] = { ok: true, count: r.value.length };
      all.push(...r.value);
    } else health[name] = { ok: false, count: 0, error: String(r.reason && r.reason.message || r.reason) };
  });
  return { generatedAt: new Date().toISOString(), health, events: sortEvents(dedupe(all)) };
}

module.exports = {
  normalizeCalendarEvent,
  normalizeCoinMarketCalEvent,
  fetchFairEconomyCalendar,
  fetchCoinMarketCal,
  collectEventData,
  relevance,
  dedupe,
  sortEvents
};
