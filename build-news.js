/* build-news.js - fetch REAL economic-calendar events + REAL headlines and turn them into
 * the same shape app.js already renders (D.incoming[], T.news[], T.speakers[]).
 *
 * This is the piece the readme describes as "a cron job... using live search" but that does
 * not exist anywhere in this repo. This script is a working, key-free implementation of it:
 *
 *   1. Economic calendar  -> nfs.faireconomy.media/ff_calendar_thisweek.json  (ForexFactory feed, no key)
 *   2. Fed press releases -> federalreserve.gov/feeds/press_all.xml           (official RSS)
 *   3. Market headlines    -> investing.com commodities/metals RSS            (no key)
 *
 * Classification is a transparent keyword heuristic (hawkish/dovish word lists below), NOT an
 * LLM call - so it is auditable and reproducible, same spirit as the w x s x f model already in
 * xauusd-data.js. impactPct reuses that exact formula (model.base x speakerWeight x
 * signalStrength x surpriseFactor) so scores are comparable to the hand-curated rows.
 *
 * Output: news-auto.js -> window.NEWS_AUTO = { generatedAt, incoming: [...], byTab: { gold:{news,speakers}, crypto:{...}, forex:{...} } }
 * This file is ADDITIVE - it never overwrites xauusd-data.js. Load it after xauusd-data.js and
 * before app.js, then merge (see mergeNewsAuto() at the bottom, called automatically if window.MARKET_DATA exists).
 *
 * Run: node build-news.js   (daily cron / Task Scheduler target, same as build-atr.js)
 */
'use strict';
const fs = require('fs');
const History = require('./lib/history-store');
const path = require('path');

const OUT = path.join(__dirname, 'news-auto.js');
const TRACK_FILE = path.join(__dirname, 'price-track.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) XAU-Desk-NewsBot/1.0' };

// ---- Real-time-ish spot price, one per tab (same free/key-free sources as build-atr.js) ----
// News/speaker rows are scored per TAB (instrumentScale), not per specific pair - see
// buildNewsRow()/buildSpeakerRow() below - so a single representative instrument per tab is the
// right granularity to measure "did price actually move the way the model predicted", not a
// full per-pair price. XAU for gold, BTC for crypto, EUR/USD (dollar's most-traded pair) for forex.
const TRACK_INSTRUMENTS = {
  gold: { label: 'XAU/USD', kind: 'yahoo', sym: 'GC=F' },
  crypto: { label: 'BTC/USD', kind: 'coinbase', product: 'BTC-USD' },
  forex: { label: 'EUR/USD', kind: 'yahoo', sym: 'EURUSD=X' }
};
async function yahooLast(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1m`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const res = j.chart && j.chart.result && j.chart.result[0];
  const price = res && res.meta && res.meta.regularMarketPrice;
  if (price == null) throw new Error('no price');
  return price;
}
async function coinbaseLast(product) {
  const url = `https://api.exchange.coinbase.com/products/${product}/ticker`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const price = j && +j.price;
  if (!price) throw new Error('no price');
  return price;
}
async function fetchSpot(tabId) {
  const cfg = TRACK_INSTRUMENTS[tabId];
  if (!cfg) return null;
  try { return cfg.kind === 'yahoo' ? await yahooLast(cfg.sym) : await coinbaseLast(cfg.product); }
  catch (e) { console.log('WARN spot: ' + tabId + ' -> ' + e.message); return null; }
}
async function fetchAllSpots() {
  const out = {};
  for (const tabId of Object.keys(TRACK_INSTRUMENTS)) { out[tabId] = await fetchSpot(tabId); await sleep(120); }
  return out;
}

function loadTrackState() {
  try { return JSON.parse(fs.readFileSync(TRACK_FILE, 'utf8')); }
  catch (e) { return { pending: [], results: [] }; }
}
function saveTrackState(state) { fs.writeFileSync(TRACK_FILE, JSON.stringify(state, null, 2), 'utf8'); }

const SETTLE_MINUTES = 45; // how long to wait before checking "did the predicted move actually happen"
const MAX_PENDING = 150, MAX_RESULTS = 300; // keep the state file bounded

/* Starts tracking a freshly-classified (non-neutral) row: snapshots the tab's real spot price now,
 * so a later run can measure the REAL price change against the model's predicted impactPct - this
 * is what turns "the model guessed +0.55%" into "the model guessed +0.55%, price actually did
 * +0.62%, correct direction" instead of asking the user to go verify it themselves. */
function trackNewRow(state, tabId, kind, title, url, impactPct, spotNow) {
  if (!impactPct || spotNow == null) return; // nothing to compare a neutral/zero call against
  const key = kind + ':' + tabId + ':' + title;
  if (state.pending.some(p => p.key === key) || state.results.some(r => r.key === key)) return; // already tracked
  if (state.pending.length >= MAX_PENDING) return;
  state.pending.push({
    key, tabId, kind, title, url, predictedPct: impactPct,
    priceAtDetect: spotNow, createdAt: new Date().toISOString(), settleAt: new Date(Date.now() + SETTLE_MINUTES * 60000).toISOString()
  });
}
/* Settles any pending entries whose window has elapsed: fetches the tab's current spot again and
 * computes the REALIZED % move using the identical sign convention as impactPct (positive = price
 * up). "Correct" means the realized move's direction matches the predicted direction and isn't
 * noise-level (>=0.05%) - a dead-flat market isn't a wrong call, it's an inconclusive one. */
async function settlePending(state, spots) {
  const now = Date.now();
  const due = state.pending.filter(p => new Date(p.settleAt).getTime() <= now);
  if (!due.length) return;
  for (const p of due) {
    const spotNow = spots[p.tabId];
    state.pending = state.pending.filter(x => x.key !== p.key);
    if (spotNow == null || p.priceAtDetect == null) continue; // can't settle without both prices - drop it
    const realizedPct = +(((spotNow - p.priceAtDetect) / p.priceAtDetect) * 100).toFixed(2);
    const predictedUp = p.predictedPct > 0, realizedUp = realizedPct > 0;
    const verdict = Math.abs(realizedPct) < 0.05 ? 'flat' : (predictedUp === realizedUp ? 'correct' : 'wrong');
    state.results.unshift({ ...p, priceAtSettle: spotNow, realizedPct, verdict, settledAt: new Date().toISOString() });
  }
  state.results = state.results.slice(0, MAX_RESULTS);
}

// ---- Model constants (mirrors xauusd-data.js model{} so scores are comparable) ----
const MODEL = {
  base: 2.5,
  cryptoScale: 1.3,
  weights: [
    { re: /\b(fed chair|federal reserve chair|powell|warsh)\b/i, v: 1.0, role: 'Fed Chair' },
    { re: /\b(ecb|european central bank|bank of japan|boj|bank of england|boe|pboc|rba|rbnz|snb|bank of canada)\b/i, v: 0.9, role: 'Central-bank decision / head' },
    { re: /\bfomc\b/i, v: 0.8, role: 'FOMC voter' },
    { re: /\b(analyst|economist|strategist|cio)\b/i, v: 0.35, role: 'Analyst / CIO' },
    { re: /\b(president|senator|congress|white house|treasury secretary)\b/i, v: 0.15, role: 'Politician' }
  ],
  defaultWeight: 0.3,
  strength: { decision: 1.0, guidance: 0.7, vote: 0.6, commentary: 0.4, political: 0.25 },
  surprise: { unpriced: 1.0, partly: 0.5, largely: 0.35, fully: 0.15, default: 0.5 }
};

// ---- Hawkish / dovish keyword lexicon (transparent, editable) ----
// Two tiers, to fix the biggest source of false positives: a bare "cut" or "hike" matches
// "oil output cut", "job cuts", "tax hike", "gas price hike" just as readily as a rate move.
//   STRONG phrases are specific enough to stand alone ("rate hike", "hawkish", ...).
//   WEAK words (bare "hike"/"cut"/"ease"/"tighten"/"pause") only count when the SAME headline
//   also contains a monetary-policy context word (Fed, ECB, rate, central bank, ...) - a plain
//   commodity/labour/tax headline won't have both, so it stays unclassified (shown NEUTRAL).
const CONTEXT_WORDS = /\b(rate|rates|\bfed\b|federal reserve|fomc|ecb|european central bank|boj|bank of japan|boe|bank of england|rba|rbnz|snb|bank of canada|central bank|interest rate|monetary policy|policymakers?)\b/i;
// WEAK-tier's own, stricter gate: naming the institution ("Bank of England", "Monetary Policy
// Committee") is NOT enough on its own - that phrase appears in nearly every routine release a
// central bank publishes (technical notices, gilt/bond operations, administrative announcements),
// regardless of actual policy stance. Found live: widening classify() to title+description surfaced
// a BoE "Asset Purchase Facility: Gilt Sales" notice - a bond-operations technicality, not a
// policy signal - that matched DOVISH_WEAK's bare "pause" purely because the notice happened to
// name the Monetary Policy Committee. WEAK-tier words now require an explicit RATE mention, not
// just an institution name.
const RATE_CONTEXT_WORDS = /\b(rate|rates|interest rate|policy rate|benchmark rate|rate decision)\b/i;
const HAWKISH_STRONG = /\b(rate hike|rate increase|rate rise|raised rates|raise rates|hiked rates|hawkish|higher for longer|tightening cycle|restrictive stance)\b/i;
const HAWKISH_WEAK = /\b(hike|hikes|hiking|tighten|tightening|restrictive|overheating|sticky inflation|hot inflation|inflation concern)\b/i;
const DOVISH_STRONG = /\b(rate cut|cut rates|cutting rates|lowered rates|lower rates|dovish|rate decrease|easing cycle|accommodative stance)\b/i;
const DOVISH_WEAK = /\b(cut|cuts|cutting|ease|easing|pause\w*|stimulus|accommodat\w*|soft landing|disinflation|slowing inflation)\b/i;
// A negation ("won't cut", "ruled out further hikes", "unlikely to ease") right before a
// directional word flips the real meaning - regex can't reliably tell which way, so the safer
// move is to strip the negated phrase out before classifying, leaving it unclassified rather
// than confidently wrong.
const NEGATED_PHRASE = /\b(no|not|won'?t|will not|unlikely to|doesn'?t|does not|denies?|denied|rules? out|ruled out)\s+(\w+\s+){0,3}(hike|hikes|hiking|cut|cuts|cutting|ease|easing|tighten|tightening|raise|raises|lower|lowers|pause|pausing)\w*/gi;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function classify(textRaw) {
  const text = textRaw.replace(NEGATED_PHRASE, ' ');
  const hStrong = HAWKISH_STRONG.test(text), dStrong = DOVISH_STRONG.test(text);
  if (hStrong && !dStrong) return 'hawkish';
  if (dStrong && !hStrong) return 'dovish';
  if (CONTEXT_WORDS.test(text) && RATE_CONTEXT_WORDS.test(text)) {
    const hWeak = HAWKISH_WEAK.test(text), dWeak = DOVISH_WEAK.test(text);
    if (hWeak && !dWeak) return 'hawkish';
    if (dWeak && !hWeak) return 'dovish';
  }
  return null; // ambiguous / no monetary context / neutral - shown NEUTRAL, not scored
}

function weightFor(text) {
  for (const w of MODEL.weights) if (w.re.test(text)) return { w: w.v, role: w.role };
  return { w: MODEL.defaultWeight, role: 'Commentary' };
}

function strengthFor(side, text) {
  if (/\b(decision|hiked|cut rates|raised rates)\b/i.test(text)) return MODEL.strength.decision;
  if (/\b(guidance|dot plot|outlook|path)\b/i.test(text)) return MODEL.strength.guidance;
  if (/\b(vote|dissent)\b/i.test(text)) return MODEL.strength.vote;
  if (/\b(president|senator|congress)\b/i.test(text)) return MODEL.strength.political;
  return MODEL.strength.commentary;
}

function impactScore(instrumentScale, w, s, f, side, relevance) {
  const v = MODEL.base * instrumentScale * w * s * f * (relevance == null ? 1 : relevance);
  return +((side === 'hawkish' ? -v : v).toFixed(2));
}

// ---- Country/currency awareness + instrument relevance + conflict gating ----
// ForexFactory's calendar feed tags each event with a 3-letter currency code (e.currency,
// re-used as the "country" column) - map it to a readable country name for display.
const COUNTRY_CCY = [
  { code: 'USD', country: 'United States' },
  { code: 'EUR', country: 'Euro Area' },
  { code: 'GBP', country: 'United Kingdom' },
  { code: 'JPY', country: 'Japan' },
  { code: 'AUD', country: 'Australia' },
  { code: 'NZD', country: 'New Zealand' },
  { code: 'CAD', country: 'Canada' },
  { code: 'CHF', country: 'Switzerland' },
  { code: 'CNY', country: 'China' }
];
const CCY_CODES = COUNTRY_CCY.map(c => c.code);
/* Which market "drivers" a headline is actually talking about - independent of which currency/
 * central bank it names. This is what lets a USD-tagged headline be recognised as being about
 * gold (rate-driven), crypto (risk-driven), both, or neither. */
function driverContext(text) {
  return {
    currencies: CCY_CODES.filter(c => new RegExp('\\b' + c + '\\b', 'i').test(text)),
    gold: /\b(gold|xau|bullion|precious metal)/i.test(text),
    yields: /\b(yield|treasury|10-year|10y\b)/i.test(text),
    usd: /\b(dollar|\busd\b|greenback|\bdxy\b)/i.test(text),
    oil: /\b(oil|brent|wti|crude)/i.test(text),
    risk: /\b(risk[- ]?(on|off|averse|appetite)|safe[- ]?haven|geopolitical)/i.test(text),
    crypto: /\b(bitcoin|crypto|\bbtc\b|ethereum|\beth\b)/i.test(text)
  };
}
/* How much weight this instrument (tab) should give a headline, based on what it's actually
 * about rather than just which currency got tagged. Gold and crypto have well-known dominant
 * drivers (USD/real yields for gold, risk sentiment/USD for crypto); a headline naming a currency
 * with none of those markers is still monetary-policy-relevant, just weaker. The forex tab cares
 * about any currency mention at all - that IS the tab's whole subject. */
function relevanceFor(tab, text) {
  const ctx = driverContext(text);
  if (tab === 'crypto') {
    if (ctx.crypto) return 1.0;
    if (ctx.risk || ctx.usd || ctx.yields) return 0.7;
    return 0.4;
  }
  if (tab === 'forex') return ctx.currencies.length ? 1.0 : 0.5;
  // gold (default)
  if (ctx.gold) return 1.0;
  if (ctx.usd || ctx.yields) return 0.8;
  if (ctx.risk) return 0.6;
  if (ctx.currencies.length && ctx.currencies.indexOf('USD') === -1) return 0.35;
  return 0.5;
}
/* Combines relevance with a "conflict gate": if the headline's OWN described price action
 * contradicts the direction its hawkish/dovish policy tilt would imply for this instrument (e.g.
 * a hawkish-Fed headline that also says gold is rising), that's a real observed-market conflict,
 * not the model being confidently wrong - gate the signal to NEUTRAL/CONFLICT rather than assert
 * a contradicted direction. Same reasoning as classify()'s negation-stripping: safer to go quiet
 * than confidently wrong. */
function instrumentDecision(tab, text, side) {
  const ctx = driverContext(text);
  const relevance = relevanceFor(tab, text);
  let signal = side === 'hawkish' ? 'SELL' : side === 'dovish' ? 'BUY' : 'NEUTRAL';
  let state = side ? 'DIRECTIONAL' : 'NEUTRAL';
  const observedUp = /\b(rise|rises|rising|rallies|rally|jumps?|surge\w*|gains?|climbs?|higher|\bup\b)\b/i.test(text);
  const observedDown = /\b(fall\w*|drops?|slides?|slumps?|declines?|lower|\bdown\b|tumbles?)\b/i.test(text);
  if (side && relevance < 0.4) { signal = 'NEUTRAL'; state = 'LOW_RELEVANCE'; }
  else if (side && observedUp && observedDown) { state = 'CONFLICT'; }
  else if (side && ((signal === 'BUY' && observedDown) || (signal === 'SELL' && observedUp)) && (ctx.gold || ctx.crypto || ctx.usd)) {
    signal = 'NEUTRAL'; state = 'CONFLICT';
  }
  return { relevance, signal, state, context: ctx, policySide: side };
}

// ---- Minimal, dependency-free RSS <item> parser (title/link/pubDate) ----
function parseRss(xml, limit) {
  const items = [];
  const re = /<item[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < (limit || 20)) {
    const block = m[0];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1]
      .replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i) || [, ''])[1]
      .replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [, ''])[1]
      .replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    // Summary/description text, stripped of any HTML markup - classify() reads title+description
    // together so a headline with no keyword of its own ("Powell speaks today") but a hawkish/
    // dovish summary still gets caught, instead of being silently missed.
    const description = (block.match(/<description>([\s\S]*?)<\/description>/i) || [, ''])[1]
      .replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
    if (title) items.push({ title, link, pubDate, description });
  }
  return items;
}
/* Defensive staleness guard: at least one candidate feed (Yahoo Finance's general news RSS,
 * checked and NOT wired in below) was confirmed to interleave genuinely old evergreen articles
 * (2024/2025 dates) alongside real same-day news with no way to tell from feed order alone. Any
 * feed doing this would otherwise get treated as "just detected" - drop anything older than this
 * window regardless of source, rather than trusting every feed's freshness by assumption. */
const MAX_ITEM_AGE_HOURS = 48;
function isFresh(pubDate) {
  const d = parseFeedDate(pubDate);
  if (!d) return true; // no parseable date - let it through rather than silently drop real content
  return (Date.now() - d.getTime()) / 3600000 <= MAX_ITEM_AGE_HOURS;
}

async function fetchText(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.text();
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function toMyt(dateIso) {
  try {
    const d = new Date(dateIso);
    const myt = new Date(d.getTime() + 8 * 3600 * 1000);
    return DAY_NAMES[myt.getUTCDay()] + ', ' + myt.toISOString().slice(0, 16).replace('T', ' ');
  } catch (e) { return null; }
}
function toGmt(dateIso) {
  try {
    const d = new Date(dateIso);
    return DAY_NAMES[d.getUTCDay()] + ', ' + d.toISOString().slice(0, 16).replace('T', ' ');
  } catch (e) { return null; }
}
/* Robust pubDate parsing across the 3 real shapes seen in these feeds:
 *   - RFC822 with an explicit offset ("Wed, 16 Sep 2026 10:00:00 +0200" - ECB) or GMT suffix
 *     ("Thu, 17 Sep 2026 06:28:19 GMT" - FXStreet/Fed) - the native Date parser handles these
 *     correctly and unambiguously regardless of the machine's local timezone.
 *   - A naive "YYYY-MM-DD HH:MM:SS" with NO timezone marker (Investing.com) - `new Date(...)` on
 *     this exact shape is a classic JS trap: it's parsed as LOCAL time, so the same string
 *     produces a different instant depending on where the script runs (fine by luck on GitHub
 *     Actions' UTC runners, wrong on a machine set to MYT). Checked empirically against feed
 *     freshness: these timestamps line up with UTC, so they're parsed explicitly as UTC here
 *     instead of leaving it to chance. */
function parseFeedDate(str) {
  if (!str) return null;
  const naive = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(str);
  if (naive) return new Date(Date.UTC(+naive[1], +naive[2] - 1, +naive[3], +naive[4], +naive[5], +naive[6]));
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
/* Full day + date + time for a headline/speaker row, in Malaysia time - what actually shows
 * next to a news item, not just a bare date. Returns null if the source gave no parseable date
 * (curated hand-entered rows from before this fix only ever had a date, never a time - this
 * function is only used for freshly-fetched rows that do carry a real timestamp). */
function formatMytFull(date) {
  if (!date) return null;
  const myt = new Date(date.getTime() + 8 * 3600 * 1000);
  const hh = String(myt.getUTCHours()).padStart(2, '0'), mm = String(myt.getUTCMinutes()).padStart(2, '0');
  return DAY_NAMES[myt.getUTCDay()] + ' ' + myt.getUTCDate() + ' ' + MONTH_NAMES[myt.getUTCMonth()] + ', ' + hh + ':' + mm + ' MYT';
}

// ---- Economic-release normalization ----
// Keep raw strings for auditability and a parsed numeric form for later historical/statistical work.
// This layer deliberately records surprise; it does not turn a release into a trade instruction.
function parseEconomicNumber(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim().replace(/,/g, '');
  const m = /^([-+]?\d*\.?\d+)\s*([KMBT%]?)$/i.exec(s);
  if (!m) return null;
  let n = Number(m[1]); if (!Number.isFinite(n)) return null;
  const u = m[2].toUpperCase();
  if (u === 'K') n *= 1e3; else if (u === 'M') n *= 1e6; else if (u === 'B') n *= 1e9; else if (u === 'T') n *= 1e12;
  return n;
}
function releaseState(actual, forecast) {
  const a = parseEconomicNumber(actual), f = parseEconomicNumber(forecast);
  if (a == null) return { state: 'RELEASE_PENDING', actualNumeric: null, forecastNumeric: f, surpriseRaw: null, surprisePct: null };
  if (f == null) return { state: 'RELEASED_NO_CONSENSUS', actualNumeric: a, forecastNumeric: null, surpriseRaw: null, surprisePct: null };
  const raw = a - f;
  return { state: 'RELEASED', actualNumeric: a, forecastNumeric: f, surpriseRaw: raw, surprisePct: f === 0 ? null : +((raw / Math.abs(f)) * 100).toFixed(3) };
}

// ---- 1. Economic calendar (real, structured, key-free) ----
async function getCalendar() {
  const j = JSON.parse(await fetchText('https://nfs.faireconomy.media/ff_calendar_thisweek.json'));
  return j
    .filter(e => e.impact === 'High' || e.impact === 'Medium')
    .map(e => ({
      date: e.date ? new Date(e.date).toISOString().slice(0, 10) : null,
      timeMyt: toMyt(e.date),
      timeGmt: toGmt(e.date),
      event: (e.country ? '[' + e.country + '] ' : '') + e.title,
      currency: e.country || null,
      country: (COUNTRY_CCY.find(x => x.code === e.country) || {}).country || null,
      importance: e.impact === 'High' ? 'high' : 'med',
      actual: e.actual != null && e.actual !== '' ? e.actual : null,
      forecast: e.forecast != null && e.forecast !== '' ? e.forecast : null,
      previous: e.previous != null && e.previous !== '' ? e.previous : null,
      release: releaseState(e.actual, e.forecast),
      note: [e.actual ? 'Actual ' + e.actual : null, e.forecast ? 'Forecast ' + e.forecast : null, e.previous ? 'Prev ' + e.previous : null].filter(Boolean).join(' - ') || 'No result/consensus figure published.',
      focusTf: e.impact === 'High' ? 'M5 - M15' : 'M15',
      play: e.actual ? 'Released - compare actual, consensus and observed reaction before interpretation.' : 'Upcoming/pending - scenario context only until an actual result is available.',
      source: 'ForexFactory calendar feed',
      sourceClass: 'OFFICIAL_CALENDAR_AGGREGATE',
      fetchedAt: new Date().toISOString(),
      url: 'https://www.forexfactory.com/calendar',
      auto: true
    }))
    .filter(e => e.date);
}

// ---- 2. Central-bank press releases (real, official) - the trustworthy hawkish/dovish source ----
// BoE and BoJ added after live-testing every G10 central bank's public feed: RBA returns an
// Akamai "Access Denied" page dressed up as XML despite HTTP 200, RBNZ's /rss path 404s, SNB's
// blocks the request outright, and Bank of Canada's general "Posts" feed uses <dc:date> (not
// <pubDate>, so timestamps would silently come through as "unknown time") and mixes in unrelated
// content (public holidays, a conference hosted on bancaditalia.it) - not a clean press-release
// source. Checked empirically, not assumed - same discipline as the ForexFactory feed's
// "thisweek-only" finding. PBoC has no reliable free English RSS at all - a permanent gap.
// Speech-specific feeds are the real answer to "what hint could move the market that isn't a
// formal statement" - a Fed governor's Q&A remarks routinely move markets as much as a press
// release, and unlike social media (X/Instagram have no free RSS - checked live: every public
// Nitter/RSS-proxy for X is currently dead or blocked, and Instagram's endpoint returns a raw web
// page, not a feed - scraping either would be fragile and against their ToS), these are the
// institutions' own OFFICIAL speech transcripts, key-free. ECB has no equivalent speeches.html
// path (404, checked).
async function getCentralBankReleases(limit) {
  const feeds = [
    { url: 'https://www.federalreserve.gov/feeds/press_all.xml', name: 'Federal Reserve' },
    { url: 'https://www.federalreserve.gov/feeds/speeches.xml', name: 'Federal Reserve - Speeches' },
    { url: 'https://www.ecb.europa.eu/rss/press.html', name: 'European Central Bank' },
    { url: 'https://www.bankofengland.co.uk/rss/news', name: 'Bank of England' },
    { url: 'https://www.bankofengland.co.uk/rss/speeches', name: 'Bank of England - Speeches' },
    { url: 'https://www.boj.or.jp/en/rss/whatsnew.xml', name: 'Bank of Japan' }
  ];
  const out = [];
  for (const f of feeds) {
    try {
      const xml = await fetchText(f.url);
      parseRss(xml, limit).filter(it => isFresh(it.pubDate)).forEach(it => out.push({ ...it, source: f.name }));
    } catch (e) { console.log('WARN central bank: ' + f.name + ' -> ' + e.message); }
    await sleep(150);
  }
  return out;
}

// ---- 3. Market headlines (real, forex/commodities/metals wires) ----
// MarketWatch and CNBC added after live-testing: both return clean RFC822 pubDate and genuinely
// fresh content. Yahoo Finance's general news RSS was tested and REJECTED - it interleaves
// evergreen explainer articles (confirmed 2024/2025-dated items mixed into today's feed, with no
// way to tell from feed order alone) - exactly what isFresh() below now guards against generally.
async function getHeadlines(limit) {
  const feeds = [
    { url: 'https://www.investing.com/rss/news_1.rss', name: 'Investing.com - Forex News' },
    { url: 'https://www.investing.com/rss/news_11.rss', name: 'Investing.com - Commodities & Futures' },
    { url: 'https://www.investing.com/rss/commodities_Metals.rss', name: 'Investing.com - Metals Analysis' },
    { url: 'https://www.fxstreet.com/rss/news', name: 'FXStreet - Forex & Markets News' },
    { url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', name: 'MarketWatch - Top Stories' },
    { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', name: 'CNBC - Markets' }
  ];
  const out = [];
  for (const f of feeds) {
    try {
      const xml = await fetchText(f.url);
      parseRss(xml, limit).filter(it => isFresh(it.pubDate)).forEach(it => out.push({ ...it, source: f.name }));
    } catch (e) { console.log('WARN headlines: ' + f.name + ' -> ' + e.message); }
    await sleep(150);
  }
  return out;
}

/* tab drives relevanceFor()/instrumentDecision() below - which market drivers (gold/yields/usd/
 * oil/risk/crypto) actually matter for THIS instrument, not just which currency got tagged. */
function buildNewsRow(it, tab, instrumentScale) {
  // Classify on title+description together - a headline like "Powell speaks at Jackson Hole"
  // carries no hawkish/dovish keyword of its own even when the actual remarks were sharply
  // hawkish; the RSS summary usually does. Title alone was silently under-detecting this.
  const side = classify(it.title + ' ' + (it.description || ''));
  const { w } = weightFor(it.title);
  const s = strengthFor(side, it.title);
  const f = MODEL.surprise.default;
  const d = instrumentDecision(tab, it.title + ' ' + (it.description || ''), side);
  const rawScore = side ? impactScore(instrumentScale, w, s, f, side, d.relevance) : 0;
  const signedScore = d.signal === 'BUY' ? Math.abs(rawScore || 0.01) : d.signal === 'SELL' ? -Math.abs(rawScore || 0.01) : 0;
  return {
    time: formatMytFull(parseFeedDate(it.pubDate)) || 'unknown time',
    tf: 'Intraday',
    title: it.title,
    summary: 'Country/currency-aware classification. Direction requires instrument relevance and checks observed market reaction for conflicts.',
    source: it.source,
    url: it.link,
    impact: d.signal === 'BUY' ? 'bullish' : d.signal === 'SELL' ? 'bearish' : 'neutral',
    signal: d.signal,
    decisionState: d.state,
    relevance: +d.relevance.toFixed(2),
    currencies: d.context.currencies,
    drivers: { gold: d.context.gold, yields: d.context.yields, usd: d.context.usd, oil: d.context.oil, risk: d.context.risk, crypto: d.context.crypto },
    policySide: d.policySide,
    impactScore: signedScore,
    impactPct: signedScore, // compatibility only: UI field retained; this is an impact score, NOT a calibrated return forecast
    auto: true
  };
}

function buildSpeakerRow(it, instrumentScale) {
  const side = classify(it.title + ' ' + (it.description || ''));
  if (!side) return null;
  const { w, role } = weightFor(it.title);
  const s = strengthFor(side, it.title);
  const f = MODEL.surprise.default;
  return {
    name: role === 'Fed Chair' ? 'Federal Reserve' : role,
    role,
    side,
    signal: side === 'hawkish' ? 'SELL' : 'BUY',
    quote: it.title,
    impact: 'Auto-classified from press release headline',
    date: formatMytFull(parseFeedDate(it.pubDate)) || 'unknown time',
    source: it.source,
    url: it.link,
    w, s, f,
    impactPct: impactScore(instrumentScale, w, s, f, side, relevanceFor('forex', it.title)),
    auto: true
  };
}

(async () => {
  console.log('build-news.js - fetching real calendar + headlines...\n');
  let calendar = [], centralBankReleases = [], headlines = [];

  try { calendar = await getCalendar(); console.log('OK   calendar        rows=' + calendar.length); }
  catch (e) { console.log('FAIL calendar        -> ' + e.message); }

  try { centralBankReleases = await getCentralBankReleases(15); console.log('OK   central bank    rows=' + centralBankReleases.length); }
  catch (e) { console.log('FAIL central bank    -> ' + e.message); }

  try { headlines = await getHeadlines(15); console.log('OK   headlines       rows=' + headlines.length); }
  catch (e) { console.log('FAIL headlines       -> ' + e.message); }

  const speakerSource = centralBankReleases; // official releases are the trustworthy hawkish/dovish signal source
  const newsSource = headlines;      // general commodity/metals wire for the news feed

  const byTab = {
    gold: {
      news: newsSource.map(it => buildNewsRow(it, 'gold', 1.0)),
      speakers: speakerSource.map(it => buildSpeakerRow(it, 1.0)).filter(Boolean)
    },
    crypto: {
      news: newsSource.map(it => buildNewsRow(it, 'crypto', MODEL.cryptoScale)),
      speakers: speakerSource.map(it => buildSpeakerRow(it, MODEL.cryptoScale)).filter(Boolean)
    },
    forex: {
      news: newsSource.map(it => buildNewsRow(it, 'forex', 1.0)),
      speakers: speakerSource.map(it => buildSpeakerRow(it, 1.0)).filter(Boolean)
    }
  };

  // ---- Append-only evidence history (DB-ready file adapter) ----
  // Failure here is fail-open: current news-auto.js still builds, but the run logs the archive problem.
  try {
    calendar.forEach(e => History.append('events', History.eventRecord(e)));
    // Archive one canonical speaker stream rather than duplicating the same official speech per instrument tab.
    byTab.forex.speakers.forEach(s => History.append('speeches', History.speechRecord(Object.assign({ sourceClass: 'OFFICIAL_SPEECH' }, s))));
    console.log('OK   history         events=' + calendar.length + ' speeches=' + byTab.forex.speakers.length);
  } catch (e) { console.log('FAIL history         -> ' + e.message); }

  // ---- Price-reaction tracking: "did the predicted move actually happen" ----
  // Real, free spot price per tab (see TRACK_INSTRUMENTS above) - not a model estimate.
  let priceTrack = { pending: 0, resultsRecent: [], accuracy: null };
  try {
    const spots = await fetchAllSpots();
    console.log('OK   spots           ' + Object.entries(spots).map(([k, v]) => k + '=' + (v != null ? v : 'FAIL')).join(' '));
    const state = loadTrackState();
    await settlePending(state, spots);
    for (const tabId of Object.keys(byTab)) {
      const spotNow = spots[tabId];
      byTab[tabId].news.forEach(n => { if (n.impactPct) trackNewRow(state, tabId, 'news', n.title, n.url, n.impactPct, spotNow); });
      byTab[tabId].speakers.forEach(s => { if (s.impactPct) trackNewRow(state, tabId, 'speaker', s.quote, s.url, s.impactPct, spotNow); });
    }
    saveTrackState(state);
    const settled = state.results.filter(r => r.verdict !== 'flat');
    const correct = settled.filter(r => r.verdict === 'correct').length;
    priceTrack = {
      pending: state.pending.length,
      resultsRecent: state.results.slice(0, 20),
      accuracy: settled.length ? { correct, total: settled.length, pct: +((correct / settled.length) * 100).toFixed(1) } : null
    };
    console.log('OK   price-track     pending=' + state.pending.length + '  results=' + state.results.length + (priceTrack.accuracy ? '  accuracy=' + priceTrack.accuracy.pct + '%' : ''));
  } catch (e) { console.log('FAIL price-track     -> ' + e.message); }

  const out = {
    generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') + 'Z',
    note: 'Auto-collected: economic calendar is real structured data; news rows are country/currency-aware and instrument-filtered; mixed observed-vs-policy direction becomes CONFLICT/NEUTRAL. impactPct is retained only for UI compatibility and is an impact score, not a calibrated return forecast. Treat auto:true rows as a first pass.',
    incoming: calendar.slice(0, 12),
    byTab,
    priceTrack
  };

  const body = '/* Auto-generated by build-news.js - real economic-calendar + real headline feeds,\n' +
    ' * classified hawkish/dovish by keyword heuristic and scored with the same\n' +
    ' * impact% = BASE x speakerWeight x signalStrength x surpriseFactor model as xauusd-data.js.\n' +
    ' * ADDITIVE ONLY - never edits xauusd-data.js. Merge happens in the browser, see mergeNewsAuto().\n' +
    ' * Regenerate: node build-news.js (run on the same daily cron as build-atr.js).\n */\n' +
    'window.NEWS_AUTO = ' + JSON.stringify(out, null, 2) + ';\n\n' +
    '/* Merges window.NEWS_AUTO into window.MARKET_DATA in place, de-duplicating by url/title.\n' +
    ' * Call this AFTER xauusd-data.js and news-auto.js are both loaded, BEFORE app.js reads D.\n' +
    ' * Curated (hand-written) rows always sort first; auto rows are appended and flagged auto:true\n' +
    ' * so index.html/app.js can badge them differently if desired. */\n' +
    'window.mergeNewsAuto = function () {\n' +
    '  var D = window.MARKET_DATA, A = window.NEWS_AUTO;\n' +
    '  if (!D || !A) return;\n' +
    '  function dedupe(list, extra, key) {\n' +
    '    var seen = {}; (list || []).forEach(function (x) { seen[x[key]] = 1; });\n' +
    '    return (list || []).concat((extra || []).filter(function (x) { return x[key] && !seen[x[key]]; }));\n' +
    '  }\n' +
    '  D.incoming = dedupe(D.incoming, A.incoming, "event");\n' +
    '  (D.tabs || []).forEach(function (T) {\n' +
    '    var by = A.byTab[T.id]; if (!by) return;\n' +
    '    T.news = dedupe(T.news, by.news, "title");\n' +
    '    T.speakers = dedupe(T.speakers, by.speakers, "quote");\n' +
    '  });\n' +
    '};\n' +
    'if (window.MARKET_DATA) window.mergeNewsAuto();\n';

  fs.writeFileSync(OUT, body, 'utf8');
  console.log('\nwrote ' + OUT);
  console.log('incoming=' + out.incoming.length + '  gold.news=' + byTab.gold.news.length + '  gold.speakers=' + byTab.gold.speakers.length);
  console.log('\nTo wire it in: add these two lines to index.html, right after xauusd-data.js and before app.js:');
  console.log('  <script src="news-auto.js"></script>');
  console.log('  <script>window.mergeNewsAuto && window.mergeNewsAuto();</script>');
})();
