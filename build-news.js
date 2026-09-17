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
const path = require('path');

const OUT = path.join(__dirname, 'news-auto.js');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) XAU-Desk-NewsBot/1.0' };

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
  if (CONTEXT_WORDS.test(text)) {
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

function impactPct(instrumentScale, w, s, f, side) {
  const v = MODEL.base * instrumentScale * w * s * f;
  return +((side === 'hawkish' ? -v : v).toFixed(2));
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
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [, ''])[1].trim();
    if (title) items.push({ title, link, pubDate });
  }
  return items;
}

async function fetchText(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.text();
}

function toMyt(dateIso) {
  try {
    const d = new Date(dateIso);
    const myt = new Date(d.getTime() + 8 * 3600 * 1000);
    return myt.toISOString().slice(0, 16).replace('T', ' ');
  } catch (e) { return null; }
}
function toGmt(dateIso) {
  try { return new Date(dateIso).toISOString().slice(0, 16).replace('T', ' '); } catch (e) { return null; }
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
      importance: e.impact === 'High' ? 'high' : 'med',
      note: [e.forecast ? 'Forecast ' + e.forecast : null, e.previous ? 'Prev ' + e.previous : null].filter(Boolean).join(' - ') || 'No consensus figure published.',
      focusTf: e.impact === 'High' ? 'M5 - M15' : 'M15',
      play: e.impact === 'High' ? 'High-impact release - expect a volatility spike at the print.' : 'Second-tier; matters mainly on a large miss/beat.',
      source: 'ForexFactory calendar feed',
      url: 'https://www.forexfactory.com/calendar',
      auto: true
    }))
    .filter(e => e.date);
}

// ---- 2. Central-bank press releases (real, official) - the trustworthy hawkish/dovish source ----
async function getCentralBankReleases(limit) {
  const feeds = [
    { url: 'https://www.federalreserve.gov/feeds/press_all.xml', name: 'Federal Reserve' },
    { url: 'https://www.ecb.europa.eu/rss/press.html', name: 'European Central Bank' }
  ];
  const out = [];
  for (const f of feeds) {
    try {
      const xml = await fetchText(f.url);
      parseRss(xml, limit).forEach(it => out.push({ ...it, source: f.name }));
    } catch (e) { console.log('WARN central bank: ' + f.name + ' -> ' + e.message); }
    await sleep(150);
  }
  return out;
}

// ---- 3. Market headlines (real, forex/commodities/metals wires) ----
async function getHeadlines(limit) {
  const feeds = [
    { url: 'https://www.investing.com/rss/news_1.rss', name: 'Investing.com - Forex News' },
    { url: 'https://www.investing.com/rss/news_11.rss', name: 'Investing.com - Commodities & Futures' },
    { url: 'https://www.investing.com/rss/commodities_Metals.rss', name: 'Investing.com - Metals Analysis' },
    { url: 'https://www.fxstreet.com/rss/news', name: 'FXStreet - Forex & Markets News' }
  ];
  const out = [];
  for (const f of feeds) {
    try {
      const xml = await fetchText(f.url);
      parseRss(xml, limit).forEach(it => out.push({ ...it, source: f.name }));
    } catch (e) { console.log('WARN headlines: ' + f.name + ' -> ' + e.message); }
    await sleep(150);
  }
  return out;
}

function buildNewsRow(it, instrumentScale) {
  const side = classify(it.title);
  const { w, role } = weightFor(it.title);
  const s = strengthFor(side, it.title);
  const f = MODEL.surprise.default;
  const signal = side === 'hawkish' ? 'SELL' : side === 'dovish' ? 'BUY' : 'NEUTRAL';
  const impact = side ? impactPct(instrumentScale, w, s, f, side) : 0;
  return {
    time: it.pubDate ? new Date(it.pubDate).toISOString().slice(0, 10) : 'unknown',
    tf: 'Intraday',
    title: it.title,
    summary: 'Auto-classified from headline text (keyword heuristic) - verify before trading.',
    source: it.source,
    url: it.link,
    impact: side === 'hawkish' ? 'bearish' : side === 'dovish' ? 'bullish' : 'neutral',
    signal,
    impactPct: impact,
    auto: true
  };
}

function buildSpeakerRow(it, instrumentScale) {
  const side = classify(it.title);
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
    date: it.pubDate ? new Date(it.pubDate).toISOString().slice(0, 10) : 'unknown',
    source: it.source,
    url: it.link,
    w, s, f,
    impactPct: impactPct(instrumentScale, w, s, f, side),
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
      news: newsSource.map(it => buildNewsRow(it, 1.0)),
      speakers: speakerSource.map(it => buildSpeakerRow(it, 1.0)).filter(Boolean)
    },
    crypto: {
      news: newsSource.map(it => buildNewsRow(it, MODEL.cryptoScale)),
      speakers: speakerSource.map(it => buildSpeakerRow(it, MODEL.cryptoScale)).filter(Boolean)
    },
    forex: {
      news: newsSource.map(it => buildNewsRow(it, 1.0)),
      speakers: speakerSource.map(it => buildSpeakerRow(it, 1.0)).filter(Boolean)
    }
  };

  const out = {
    generatedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') + 'Z',
    note: 'Auto-collected: economic calendar is real structured data; news/speaker rows are keyword-classified from real headlines (hawkish/dovish lexicon in build-news.js), NOT hand-verified. Treat auto:true rows as a first pass.',
    incoming: calendar.slice(0, 12),
    byTab
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
