/* telegram-notify.js - posts NEW high-signal items to a Telegram chat after build-atr.js /
 * build-news.js have run, so a scheduled GitHub Action can alert you the moment something
 * changes instead of you having to open the app.
 *
 * Each alert is a small "trade card": what happened, which symbol to focus on, the model's
 * predicted direction, what timeframe/chart to read it on, and the Malaysia-time trade window -
 * the same fields the dashboard itself shows in News Incoming / Trade Focus, reusing the exact
 * same currency-bias and session logic as app.js so the numbers always agree with the app.
 *
 * What it alerts on (kept deliberately narrow to avoid spamming every poll):
 *   - New high-importance calendar events (from D.incoming, xauusd-data.js + news-auto.js)
 *   - New auto-classified news/speaker rows with a real HAWKISH/DOVISH side (skips NEUTRAL)
 *
 * State: .news-alert-state.json holds the keys already CONFIRMED delivered, so re-runs only
 * alert on genuinely new items and a failed send is retried next run instead of being lost.
 * This file is committed back to the repo by the workflow (see
 * .github/workflows/daily-refresh.yml) since GitHub Actions runners are ephemeral.
 *
 * Requires env vars (set as GitHub repo secrets, never hardcoded):
 *   TELEGRAM_BOT_TOKEN  - from @BotFather
 *   TELEGRAM_CHAT_ID    - your user id, group id, or channel id (@userinfobot can find yours)
 *
 * Run: node telegram-notify.js   (after build-atr.js and build-news.js)
 * Preview one sample card without touching state or sending for real: node telegram-notify.js --preview
 * Countdown reminders (T-30/T-10/T-2 min) for high-importance events, own state namespace,
 * meant to run every 5 min independent of the above: node telegram-notify.js --reminders
 */
'use strict';
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '.news-alert-state.json');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PREVIEW = process.argv.includes('--preview');
const REMINDERS = process.argv.includes('--reminders');
const DAILY = process.argv.includes('--daily-summary');
const EVENING = process.argv.includes('--evening-recap');
const WEEKLY = process.argv.includes('--weekly-outlook');

function loadJsModule(file, globalName) {
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) return null;
  const win = {};
  const code = fs.readFileSync(full, 'utf8');
  // xauusd-data.js / news-auto.js are plain `window.X = {...}` assignments - safe to eval in an isolated sandbox.
  new Function('window', code)(win);
  return win[globalName] || null;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return { sentKeys: [] }; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function sendTelegram(text) {
  if (!TOKEN || !CHAT_ID) { console.log('SKIP (no Telegram credentials configured):\n' + text + '\n'); return { ok: false, skipped: true }; }
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) { console.log('FAIL Telegram send: ' + (j.description || r.status)); return { ok: false }; }
  return { ok: true };
}
/* Sends the card as a photo with the full card as its caption (QuickChart.io - free, key-free,
 * renders a real PNG bar from a JSON chart spec, no account needed). Falls back to a plain text
 * message if the photo send fails for any reason (bad URL, caption over Telegram's 1024-char
 * photo-caption limit, QuickChart hiccup) so a chart problem never costs you the alert itself. */
async function sendTelegramCard(caption, chartUrl) {
  if (!TOKEN || !CHAT_ID) { console.log('SKIP (no Telegram credentials configured):\n' + caption + '\n'); return { ok: false, skipped: true }; }
  if (chartUrl && caption.length <= 1024) {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, photo: chartUrl, caption, parse_mode: 'HTML' })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) return { ok: true };
    console.log('Photo send failed (' + (j.description || r.status) + ') - falling back to text.');
  }
  return sendTelegram(caption);
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ==================== Malaysia time + trading session ====================
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function nowMyt() {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // MYT = UTC+8, fixed offset, no DST
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${hh}:${mm}`;
}
/* Prepends the day name to a "DD Mon HH:MM" MYT string that doesn't already start with one
 * (curated calendar rows) - COMPUTED from the real date via parseMytToUtc, not fabricated.
 * Auto-collected rows (build-news.js) already start with a day name and pass through unchanged. */
function mytDisplay(timeMyt) {
  if (!timeMyt) return '—';
  if (/^[A-Za-z]{3},?\s/.test(timeMyt)) return timeMyt;
  const d = parseMytToUtc(timeMyt);
  if (!d) return timeMyt;
  const myt = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${DAY_NAMES[myt.getUTCDay()]}, ${timeMyt}`;
}
function mytHourFromString(timeMyt) {
  if (!timeMyt) return null;
  const m = /(\d{1,2}):(\d{2})/.exec(timeMyt);
  return m ? parseInt(m[1], 10) : null;
}
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/* Parses a "17 Sep 20:30" (or "2026-09-17 20:30") style MYT string into the UTC instant it
 * represents (MYT = UTC+8, no DST, so this is exact arithmetic, not a timezone-library call). */
function parseMytToUtc(timeMyt) {
  if (!timeMyt) return null;
  let m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{1,2}):(\d{2})/.exec(timeMyt);
  let day, month, hour, min;
  if (m) { day = +m[1]; month = MONTHS[m[2]]; hour = +m[3]; min = +m[4]; }
  else {
    m = /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/.exec(timeMyt);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]));
  }
  const now = new Date();
  let year = now.getUTCFullYear();
  let d = new Date(Date.UTC(year, month, day, hour - 8, min));
  if (d.getTime() < now.getTime() - 200 * 86400000) d = new Date(Date.UTC(year + 1, month, day, hour - 8, min));
  return d;
}
function sessionAtMyt(sessions, hour) {
  if (hour == null) return null;
  const hits = (sessions || []).filter(s => {
    const m = /(\d{1,2}):\d{2}-(\d{1,2}):\d{2}/.exec(s.myt || '');
    if (!m) return false;
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    return a <= b ? (hour >= a && hour < b) : (hour >= a || hour < b);
  });
  return hits.map(s => s.k).join(' + ') || 'off-session (thin liquidity)';
}

// ==================== Currency / pair inference (shared-market-logic.js - see that file for why) ====================
const SharedLogic = require('./shared-market-logic.js');
const eventCurrency = SharedLogic.eventCurrency;
function bestPairFor(MARKET_DATA, ccy) { return SharedLogic.bestPairFor(MARKET_DATA.fxPairs, MARKET_DATA.currencies, ccy); }
/* Live snapshot price for a named pair (e.g. "USD/JPY") from fxPairs, or null if not loaded. */
function pairSnap(MARKET_DATA, pairName) {
  const p = (MARKET_DATA.fxPairs || []).find(x => x.pair === pairName);
  return p ? p.snap : null;
}
/* Resolves which actual currency pair a piece of forex news/speaker text is about, instead of
 * the generic "FOREX" tab label. Scans the text for a currency/central-bank mention (eventCurrency)
 * and picks that currency's clearest pair vs USD (bestPairFor). Falls back to the tab's own
 * headline pair (EUR/USD, tab.price.spot) when no specific currency is named in the text, so a
 * broad "dollar gains" headline still resolves to something concrete rather than "FOREX". */
function resolveForexFocus(MARKET_DATA, tab, text) {
  const ccy = eventCurrency(text || '');
  const best = ccy ? bestPairFor(MARKET_DATA, ccy) : null;
  if (best) {
    const spot = pairSnap(MARKET_DATA, best.pair);
    return { sym: best.pair, spot: spot != null ? spot : (tab.price && tab.price.spot) };
  }
  return { sym: 'EUR/USD', spot: tab.price && tab.price.spot };
}
// ==================== Pip / price-target calculation ====================
// Same pip-size convention as the dashboard's desk assistant (shared-market-logic.js pipSize()).
function pipSize(sym) {
  return SharedLogic.pipSize(sym);
}
function fmtPrice(v) { return v == null ? '—' : (Math.abs(v) >= 20 ? v.toFixed(3) : v.toFixed(5)); }
/* "pips" only really means something for FX (0.0001/0.01 quoting) - gold/silver/crypto use the
 * same pipSize() math for consistency with the dashboard, but calling a 4000-unit gold move
 * "3767 pips" reads as broken, not precise. Label those "points" instead; the number is the
 * same, just described honestly. */
function unitLabel(sym) {
  const s = String(sym || '').toUpperCase();
  const isFxPair = s.indexOf('/') > -1 || /^[A-Z]{6}$/.test(s); // atr.js ids (e.g. "NZDUSD") have no slash
  const isMetalOrCrypto = s.indexOf('XAU') > -1 || s.indexOf('XAG') > -1 || ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'].some(c => s.indexOf(c) > -1);
  return (isFxPair && !isMetalOrCrypto) ? 'pips' : 'points';
}
/* Builds "current price -> predicted target price (N pips)" from a spot price and a signed %
 * move (positive = up/BUY, negative = down/SELL - matches impactPct's existing sign convention).
 * Returns null if no spot price is available so callers can omit the line instead of showing junk. */
function priceMoveLine(sym, spot, pct) {
  if (spot == null || pct == null) return null;
  const target = spot * (1 + pct / 100);
  const pips = Math.abs(target - spot) / pipSize(sym);
  return `📏 Price move: <b>${fmtPrice(spot)} → ${fmtPrice(target)}</b> (≈${pips.toFixed(1)} ${unitLabel(sym)})`;
}
/* For calendar events (no direct % estimate): real measured ATR(14) from atr.js x an event
 * multiplier (1.5 for high-impact, matching the dashboard's Range Calc "k" convention), applied
 * in the predicted direction. This is the same "ATR expected range" method as Range Calc method 2. */
function priceMoveLineFromAtr(atrRow, spot, signal, importance) {
  if (!atrRow || spot == null || signal === 'NEUTRAL') return null;
  const k = importance === 'high' ? 1.5 : 1.0;
  const move = atrRow.atr * k;
  const target = signal === 'BUY' ? spot + move : spot - move;
  const pips = move / pipSize(atrRow.id);
  return `📏 Expected move (ATR14 × ${k}): <b>${fmtPrice(spot)} → ${fmtPrice(target)}</b> (≈${pips.toFixed(1)} ${unitLabel(atrRow.id)})`;
}
function findAtrRow(atrData, symbolOrPair) {
  if (!atrData || !symbolOrPair) return null;
  const id = String(symbolOrPair).replace('/', '').toUpperCase();
  return (atrData.rows || []).find(r => r.id === id) || null;
}

const TF_CHART = { Intraday: 'M15 - H1', '1-3D': 'H1 - H4', Weekly: 'H4 - D1', Structural: 'D1 - W1' };
const CREDIT_LINE = '———\n🏷️ ifxhelper_2026';
const SIGNAL_EMOJI = { BUY: '🟢 BUY', SELL: '🔴 SELL', NEUTRAL: '⚪ NEUTRAL' };

/* One bold, color-coded order-call line, e.g.: "🟢🟢🟢 ORDER CALL: BUY 🟢🟢🟢" - deliberately the
 * loudest line in the card since it's the single thing meant to be readable at a glance. */
function orderCallLine(signal) {
  if (signal === 'BUY') return '🟢🟢🟢 <b>ORDER CALL: BUY</b> 🟢🟢🟢';
  if (signal === 'SELL') return '🔴🔴🔴 <b>ORDER CALL: SELL</b> 🔴🔴🔴';
  return '⚪⚪⚪ <b>ORDER CALL: NEUTRAL / NO TRADE</b> ⚪⚪⚪';
}
/* Spells out WHY - ties the order call back to the actual hawkish/dovish speech-direction rule
 * for this instrument (T.dirRule in the dashboard), so the alert reads as reasoning, not a
 * bare signal. */
function reasonFromDirRule(tab, side) {
  const sym = tab.id === 'gold' ? 'gold' : tab.id === 'crypto' ? 'crypto' : 'the dollar';
  if (tab.id === 'forex') {
    return side === 'hawkish'
      ? 'Hawkish Fed speech → BUY USD (SELL EUR/USD, BUY USD/JPY)'
      : 'Dovish Fed speech → SELL USD (BUY EUR/USD, SELL USD/JPY)';
  }
  return side === 'hawkish' ? `Hawkish speech → SELL ${sym}` : `Dovish speech → BUY ${sym}`;
}
/* QuickChart.io - free, key-free chart-image renderer (POST-less GET API, just a URL). One
 * horizontal bar showing the predicted move, colored to match the order call so the image alone
 * (visible even with notifications collapsed) already tells you BUY or SELL at a glance. */
function chartImageUrl(title, value, signal) {
  const color = signal === 'BUY' ? '#16a34a' : signal === 'SELL' ? '#dc2626' : '#9ca3af';
  const spec = {
    type: 'bar',
    data: { labels: [title], datasets: [{ label: 'Predicted move %', data: [value], backgroundColor: [color] }] },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, title: { display: true, text: `${title} — ${signal}`, color, font: { size: 16 } } },
      scales: { x: { grid: { color: '#e5e7eb' } } }
    }
  };
  return 'https://quickchart.io/chart?width=500&height=260&backgroundColor=white&c=' + encodeURIComponent(JSON.stringify(spec));
}

// ==================== Card builders - each returns { caption, chartUrl } ====================
function eventCard(MARKET_DATA, atrData, e, pool) {
  const ccy = eventCurrency(e.event + ' ' + (e.note || ''));
  const top = bestPairFor(MARKET_DATA, ccy);
  const hour = mytHourFromString(e.timeMyt);
  const session = sessionAtMyt(MARKET_DATA.sessions, hour);
  const badge = e.importance === 'high' ? '🚨 <b>HIGH-IMPACT EVENT</b>' : '🔔 <b>Event</b>';
  const signal = top ? top.s.signal : 'NEUTRAL';
  const focusSym = top ? top.pair : (ccy ? `${ccy} exposure (XAU/USD + DXY)` : 'XAU/USD + DXY (broad risk)');
  const focusLine = top
    ? `${esc(top.pair)} — ${SIGNAL_EMOJI[top.s.signal] || top.s.signal} (score ${top.s.score > 0 ? '+' : ''}${top.s.score.toFixed(2)})`
    : (ccy ? `${esc(ccy)} exposure — no single loaded pair, watch XAU/USD + DXY` : 'Broad risk event — watch XAU/USD + DXY directly');
  const reasoning = ccy === 'USD' ? 'Fed-driven event → currency-bias model applied to the standard USD headline pair'
    : ccy ? `${esc(ccy)}-driven event → currency-bias model applied to ${esc(ccy)}'s direct pair against USD`
      : 'No single currency driver — gauge via gold/DXY instead';
  const atrRow = top ? findAtrRow(atrData, top.pair) : null;
  const priceLine = atrRow ? priceMoveLineFromAtr(atrRow, atrRow.last, signal, e.importance) : null;
  const caption = [
    badge,
    `<b>${esc(e.event)}</b>`,
    orderCallLine(signal),
    `ℹ️ ${reasoning}`,
    `🎯 Focus symbol: <b>${esc(focusSym)}</b>`,
    focusLine !== focusSym ? `   ${focusLine}` : null,
    priceLine,
    `⏱ Timeframe: <b>${esc(e.focusTf || '—')}</b>`,
    `🕒 Time to trade (MYT): <b>${esc(mytDisplay(e.timeMyt))}</b>${session ? ` · Session: ${esc(session)}` : ''}`,
    e.note ? `📝 ${esc(e.note)}` : null,
    e.play ? `💡 ${esc(e.play)}` : null,
    pool ? relatedCommentaryBlock(ccy, pool, 2) : null,
    e.url ? `🔗 ${esc(e.source || 'Source')}: ${e.url}` : null,
    CREDIT_LINE,
    `📤 Alert sent (MYT): ${nowMyt()}`
  ].filter(Boolean).join('\n');
  return { caption, chartUrl: chartImageUrl(top ? top.pair : (ccy || e.event.slice(0, 20)), top ? +top.s.score.toFixed(2) : 0, signal) };
}
function newsCard(MARKET_DATA, tab, n) {
  const forexFocus = tab.id === 'forex' ? resolveForexFocus(MARKET_DATA, tab, `${n.title || ''} ${n.summary || ''}`) : null;
  const focusSym = tab.id === 'gold' ? 'XAU/USD' : tab.id === 'crypto' ? 'BTC/USD (+ ETH/USD)' : forexFocus.sym;
  const chart = TF_CHART[n.tf] || n.tf || '—';
  const reasoning = n.impact === 'bearish' ? 'Headline classified bearish (keyword heuristic on real news text) → SELL bias'
    : n.impact === 'bullish' ? 'Headline classified bullish (keyword heuristic on real news text) → BUY bias'
      : 'Headline classified neutral — no clear directional keyword match';
  const priceLine = priceMoveLine(tab.id === 'gold' ? 'XAU/USD' : tab.id === 'crypto' ? 'BTC' : focusSym, tab.id === 'forex' ? forexFocus.spot : (tab.price && tab.price.spot), n.impactPct);
  const caption = [
    `<b>${esc(tab.label)}</b> — auto-classified news`,
    orderCallLine(n.signal),
    `ℹ️ ${reasoning}`,
    `🎯 Focus symbol: <b>${esc(focusSym)}</b>`,
    `📊 Predicted move: <b>${n.impactPct > 0 ? '+' : ''}${n.impactPct}%</b> (model estimate)`,
    priceLine,
    `⏱ Timeframe: ${esc(n.tf || '—')} → chart: <b>${esc(chart)}</b>`,
    `🕒 News time (MYT): <b>${esc(n.time || 'unknown time')}</b>`,
    `📝 ${esc(n.title)}`,
    `🔗 ${esc(n.source || 'Source')}${n.url ? ': ' + n.url : ''}`,
    CREDIT_LINE,
    `📤 Alert sent (MYT): ${nowMyt()}`
  ].filter(Boolean).join('\n');
  return { caption, chartUrl: chartImageUrl(focusSym, n.impactPct || 0, n.signal) };
}
function speakerCard(MARKET_DATA, tab, s) {
  const forexFocus = tab.id === 'forex' ? resolveForexFocus(MARKET_DATA, tab, `${s.name || ''} ${s.role || ''} ${s.quote || ''}`) : null;
  const focusSym = tab.id === 'gold' ? 'XAU/USD' : tab.id === 'crypto' ? 'BTC/USD (+ ETH/USD)' : forexFocus.sym;
  const arrow = s.side === 'hawkish' ? '🦅 HAWKISH' : '🕊️ DOVISH';
  const priceLine = priceMoveLine(tab.id === 'gold' ? 'XAU/USD' : tab.id === 'crypto' ? 'BTC' : focusSym, tab.id === 'forex' ? forexFocus.spot : (tab.price && tab.price.spot), s.impactPct);
  const caption = [
    `<b>${esc(tab.label)}</b> — speaker/central-bank alert`,
    orderCallLine(s.signal),
    `ℹ️ ${esc(reasonFromDirRule(tab, s.side))}`,
    `🗣 ${arrow}: <b>${esc(s.name)}</b> (${esc(s.role)})`,
    `🎯 Focus symbol: <b>${esc(focusSym)}</b>`,
    `📊 Predicted move: <b>${s.impactPct > 0 ? '+' : ''}${s.impactPct}%</b> (weight ${s.w != null ? s.w : '—'} × strength ${s.s != null ? s.s : '—'} × surprise ${s.f != null ? s.f : '—'})`,
    priceLine,
    `🕒 Speech time (MYT): <b>${esc(s.date || 'unknown time')}</b>`,
    `📝 “${esc(s.quote)}”`,
    `🔗 ${esc(s.source || 'Source')}${s.url ? ': ' + s.url : ''}`,
    CREDIT_LINE,
    `📤 Alert sent (MYT): ${nowMyt()}`
  ].filter(Boolean).join('\n');
  return { caption, chartUrl: chartImageUrl(focusSym, s.impactPct || 0, s.signal) };
}
/* Countdown reminder card - same focus/reasoning/price-move fields as eventCard(), just framed
 * as "T-minus" instead of "new event detected". stage is one of REMINDER_STAGES (minutes). */
function reminderCard(MARKET_DATA, atrData, e, minutesLeft, stage, pool) {
  const base = eventCard(MARKET_DATA, atrData, e, pool);
  const header = `⏰ <b>REMINDER — ${stage} min to go</b> (${minutesLeft <= 0 ? 'starting now' : `~${minutesLeft} min left`})`;
  return { caption: header + '\n' + base.caption, chartUrl: base.chartUrl };
}

/* Aggregates a tab's curated + auto-collected news/speakers into a gauge - same method as
 * app.js's computeAutoSentiment() (SELL is uniformly the hawkish direction across every tab's
 * dirRule), duplicated here because this script runs in Node against the raw data files, not
 * against the browser's already-merged D.tabs. Kept deliberately identical so the daily summary
 * never disagrees with what the dashboard itself shows. */
function computeTabSentiment(tab, autoByTab) {
  const items = (tab.news || []).concat(tab.speakers || [], (autoByTab && autoByTab.news) || [], (autoByTab && autoByTab.speakers) || []);
  const scored = items.filter(i => i.signal && i.signal !== 'NEUTRAL' && i.impactPct != null);
  if (!scored.length) return tab.sentiment || null;
  let netPct = 0, buys = 0, sells = 0;
  scored.forEach(i => { netPct += i.impactPct; if (i.signal === 'BUY') buys++; else if (i.signal === 'SELL') sells++; });
  netPct = +netPct.toFixed(2);
  const netSignal = netPct > 0.05 ? 'BUY' : netPct < -0.05 ? 'SELL' : 'NEUTRAL';
  const score = +Math.max(-1, Math.min(1, (sells - buys) / scored.length)).toFixed(2);
  const bias = score > 0.15 ? 'HAWKISH' : score < -0.15 ? 'DOVISH' : 'MIXED';
  const tone = netSignal === 'SELL' ? 'BEARISH' : netSignal === 'BUY' ? 'BULLISH' : 'MIXED';
  return { bias, tone, score, confidence: Math.round(Math.min(95, 40 + scored.length * 4)), netSignal, netPct, count: scored.length, buys, sells };
}

/* One consolidated digest across all three tabs - gauge + top headlines + today's calendar +
 * macro snapshot. Sent once a day (see daily-refresh.yml), separate from the per-item alerts. */
/* Message 1 of 2: the summary - macro snapshot + each tab's gauge + top headlines. No calendar,
 * no predictions - that's the second message (buildDailyPrediction), sent separately per request. */
function buildDailySummary(MARKET_DATA, NEWS_AUTO, MACRO_AUTO) {
  const lines = [`☀️ <b>DAILY SUMMARY — ${nowMyt()}</b>`, ''];

  if (MACRO_AUTO) {
    const m = [];
    if (MACRO_AUTO.dxy) m.push(`DXY ${MACRO_AUTO.dxy.value} (${MACRO_AUTO.dxy.delta})`);
    if (MACRO_AUTO.us10y) m.push(`US10Y ${MACRO_AUTO.us10y.value} (${MACRO_AUTO.us10y.delta})`);
    if (MACRO_AUTO.brent) m.push(`Brent ${MACRO_AUTO.brent.value} (${MACRO_AUTO.brent.delta})`);
    if (m.length) lines.push(`🌐 ${m.join(' · ')}`, '');
  }

  (MARKET_DATA.tabs || []).forEach(tab => {
    const autoByTab = NEWS_AUTO && NEWS_AUTO.byTab && NEWS_AUTO.byTab[tab.id];
    const s = computeTabSentiment(tab, autoByTab) || {};
    const allNews = (tab.news || []).concat((autoByTab && autoByTab.news) || []);
    const top = allNews.slice().sort((a, b) => Math.abs(b.impactPct || 0) - Math.abs(a.impactPct || 0)).slice(0, 3);
    const dot = s.netSignal === 'SELL' ? '🔴' : s.netSignal === 'BUY' ? '🟢' : '⚪';
    lines.push(`<b>${esc(tab.label)}</b>`);
    lines.push(`${dot} <b>${esc(s.netSignal || 'NEUTRAL')}</b> — ${esc(s.bias || '—')}/${esc(s.tone || '—')}, net ${pctFmt(s.netPct)} (${s.count || 0} classified item${s.count === 1 ? '' : 's'})`);
    if (top.length) {
      lines.push('Top headlines:');
      top.forEach(n => lines.push(`  • [${esc(n.signal)}] ${esc(n.title)}`));
    }
    lines.push('');
  });

  lines.push(CREDIT_LINE);
  return lines.join('\n');
}

/* Message 2 of 2: next-24h calendar, each event paired with its predicted focus pair/signal -
 * same bestPairFor() logic the per-event alert cards use, just condensed to one line each. */
function buildDailyPrediction(MARKET_DATA, NEWS_AUTO) {
  const lines = [`🔮 <b>TODAY'S PREDICTIONS — ${nowMyt()}</b>`, ''];
  const now = Date.now();
  const todayEvents = (MARKET_DATA.incoming || []).concat((NEWS_AUTO && NEWS_AUTO.incoming) || [])
    .map(e => ({ e, at: parseMytToUtc(e.timeMyt) }))
    .filter(x => x.at && x.at.getTime() >= now && x.at.getTime() <= now + 24 * 3600000)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (todayEvents.length) {
    lines.push('📅 <b>Next 24h calendar — with prediction:</b>');
    todayEvents.forEach(x => {
      const ccy = eventCurrency(x.e.event + ' ' + (x.e.note || ''));
      const top = bestPairFor(MARKET_DATA, ccy);
      const pred = top ? `${top.pair} ${top.s.signal === 'SELL' ? '🔴' : top.s.signal === 'BUY' ? '🟢' : '⚪'} ${top.s.signal}` : (ccy ? `${ccy} — watch XAU/USD + DXY` : 'no single driver');
      lines.push(`  • ${esc(mytDisplay(x.e.timeMyt))} — ${esc(x.e.event)} (${esc((x.e.importance || '').toUpperCase())})`);
      lines.push(`     → Predicted focus: ${esc(pred)}`);
    });
  } else {
    lines.push('📅 No calendar events in the next 24h.');
  }
  lines.push('', CREDIT_LINE);
  return lines.join('\n');
}
function pctFmt(v) { return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }

/* "Is this today, in MYT?" - compares day+month only (none of these date strings carry a year),
 * which is exactly right for a same-year recurring digest. Handles both the enriched auto format
 * ("Thu 17 Sep, 21:36 MYT") and the shorter curated formats ("17 Sep", "17 Sep 02:00"). */
function todayMytParts() { const d = new Date(Date.now() + 8 * 3600 * 1000); return { day: d.getUTCDate(), month: d.getUTCMonth() }; }
function isTodayMyt(str) {
  if (!str) return false;
  const m = /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.exec(str);
  if (!m) return false;
  const t = todayMytParts();
  return +m[1] === t.day && MONTH_NAMES.indexOf(m[2]) === t.month;
}

/* End-of-day recap - only what actually happened TODAY (real per-item MYT timestamps, now that
 * build-news.js preserves them), as opposed to the morning briefing's forward-looking mix. */
function buildEveningRecap(MARKET_DATA, NEWS_AUTO, MACRO_AUTO) {
  const lines = [`🌙 <b>EVENING RECAP — ${nowMyt()}</b>`, ''];

  if (MACRO_AUTO) {
    const m = [];
    if (MACRO_AUTO.dxy) m.push(`DXY ${MACRO_AUTO.dxy.value} (${MACRO_AUTO.dxy.delta})`);
    if (MACRO_AUTO.us10y) m.push(`US10Y ${MACRO_AUTO.us10y.value} (${MACRO_AUTO.us10y.delta})`);
    if (MACRO_AUTO.brent) m.push(`Brent ${MACRO_AUTO.brent.value} (${MACRO_AUTO.brent.delta})`);
    if (m.length) lines.push(`🌐 ${m.join(' · ')}`, '');
  }

  (MARKET_DATA.tabs || []).forEach(tab => {
    const autoByTab = NEWS_AUTO && NEWS_AUTO.byTab && NEWS_AUTO.byTab[tab.id];
    const allNews = (tab.news || []).concat((autoByTab && autoByTab.news) || []);
    const todayNews = allNews.filter(n => isTodayMyt(n.time));
    const scored = todayNews.filter(n => n.signal && n.signal !== 'NEUTRAL' && n.impactPct != null);
    lines.push(`<b>${esc(tab.label)}</b>`);
    if (!todayNews.length) {
      lines.push('No classified headlines published today.');
    } else {
      let netPct = 0, buys = 0, sells = 0;
      scored.forEach(n => { netPct += n.impactPct; if (n.signal === 'BUY') buys++; else sells++; });
      const netSignal = netPct > 0.05 ? 'BUY' : netPct < -0.05 ? 'SELL' : 'NEUTRAL';
      const dot = netSignal === 'SELL' ? '🔴' : netSignal === 'BUY' ? '🟢' : '⚪';
      lines.push(`${dot} ${todayNews.length} headline(s) today — net ${pctFmt(+netPct.toFixed(2))} (${buys} bullish, ${sells} bearish)`);
      todayNews.slice().sort((a, b) => Math.abs(b.impactPct || 0) - Math.abs(a.impactPct || 0)).slice(0, 3)
        .forEach(n => lines.push(`  • [${esc(n.signal)}] ${esc(n.title)}`));
    }
    lines.push('');
  });

  const todaysEvents = (MARKET_DATA.incoming || []).concat((NEWS_AUTO && NEWS_AUTO.incoming) || [])
    .filter(e => isTodayMyt(e.timeMyt || e.date));
  if (todaysEvents.length) {
    lines.push('📅 <b>Today\'s calendar:</b>');
    todaysEvents.forEach(e => lines.push(`  • ${esc(mytDisplay(e.timeMyt || e.date))} — ${esc(e.event)} (${esc((e.importance || '').toUpperCase())})`));
    lines.push('');
  } else {
    lines.push('📅 No calendar events scheduled today.', '');
  }

  lines.push(CREDIT_LINE);
  return lines.join('\n');
}

/* Which real headline/speaker patterns count as "related commentary" for each currency's driving
 * institution - used to build a research note per calendar event, not just quote its forecast.
 * ForexFactory's free feed has no monthly variant (checked directly: nextweek/lastweek/thismonth
 * all 404) - "thisweek" is genuinely the widest free window, refreshed continuously, so a weekly
 * outlook covers exactly what's available, not an artificial slice of a bigger free feed. */
const CCY_COMMENTARY_PATTERN = {
  USD: /\b(fed|fomc|federal reserve|dollar|usd)\b/i,
  EUR: /\b(ecb|european central bank|euro\b|\beur\b)\b/i,
  GBP: /\b(boe|bank of england|pound|sterling|\bgbp\b)\b/i,
  JPY: /\b(boj|bank of japan|\byen\b|\bjpy\b)\b/i,
  AUD: /\b(rba|aussie|\baud\b)\b/i,
  NZD: /\b(rbnz|kiwi|\bnzd\b)\b/i,
  CAD: /\b(boc|bank of canada|loonie|\bcad\b)\b/i,
  CHF: /\b(snb|swiss franc|\bchf\b)\b/i
};
function relatedCommentaryFor(ccy, pool) {
  const re = CCY_COMMENTARY_PATTERN[ccy];
  if (!re) return [];
  return pool.filter(n => re.test(n.title));
}
/* Every classified news/speaker item collected across all three tabs, deduped by title - the
 * shared research pool both the weekly outlook and the regular per-event alert cards search for
 * "related commentary" on an event's driving currency. */
function buildCommentaryPool(MARKET_DATA, NEWS_AUTO) {
  const pool = [];
  (MARKET_DATA.tabs || []).forEach(tab => {
    const autoByTab = NEWS_AUTO && NEWS_AUTO.byTab && NEWS_AUTO.byTab[tab.id];
    (tab.speakers || []).forEach(s => pool.push({ title: s.name + ' ' + s.role + ' ' + s.quote, signal: s.signal }));
    ((autoByTab && autoByTab.news) || []).forEach(n => pool.push(n));
    ((autoByTab && autoByTab.speakers) || []).forEach(s => pool.push({ title: s.name + ' ' + s.role + ' ' + s.quote, signal: s.signal }));
  });
  const seen = {};
  return pool.filter(n => { if (seen[n.title]) return false; seen[n.title] = 1; return true; });
}
/* Short "related commentary + verdict" block, shared by eventCard() (regular per-event alerts)
 * and eventResearchNote() (the weekly outlook's fuller per-event write-up). */
function relatedCommentaryBlock(ccy, pool, maxItems) {
  const related = ccy ? relatedCommentaryFor(ccy, pool) : [];
  const scored = related.filter(n => n.signal && n.signal !== 'NEUTRAL');
  let verdict = 'MIXED / NO CLEAR LEAN', verdictEmoji = '⚪';
  if (scored.length) {
    const sells = scored.filter(n => n.signal === 'SELL').length, buys = scored.length - sells;
    if (sells > buys) { verdict = 'HAWKISH (' + sells + '/' + scored.length + ' related items bearish-for-risk)'; verdictEmoji = '🦅'; }
    else if (buys > sells) { verdict = 'DOVISH (' + buys + '/' + scored.length + ' related items bullish-for-risk)'; verdictEmoji = '🕊️'; }
  }
  const lines = [`${verdictEmoji} Related analysis: <b>${esc(verdict)}</b>`];
  if (related.length) {
    lines.push(`📰 Related commentary (${related.length} found):`);
    related.slice(0, maxItems || 2).forEach(n => lines.push(`  • [${esc(n.signal || 'NEUTRAL')}] ${esc(n.title)}`));
  } else {
    lines.push(`📰 No related ${ccy || ''} commentary found in the collected pool yet.`);
  }
  return lines.join('\n');
}
/* Full per-event research note: forecast/previous (already in e.note), every related classified
 * headline/speaker item found in this week's collected pool for that event's driving currency,
 * tallied into a hawkish/dovish verdict - not just the bare event title. */
function eventResearchNote(MARKET_DATA, allNewsPool, e) {
  const ccy = eventCurrency(e.event + ' ' + (e.note || ''));
  const bestPair = bestPairFor(MARKET_DATA, ccy);
  const lines = [
    `<b>${esc(e.event)}</b> (${esc((e.importance || '').toUpperCase())})`,
    `🕒 ${esc(mytDisplay(e.timeMyt))}`,
    e.note ? `📈 Fundamentals: ${esc(e.note)}` : null,
    bestPair ? `🎯 Focus: ${esc(bestPair.pair)} ${bestPair.s.signal === 'SELL' ? '🔴' : bestPair.s.signal === 'BUY' ? '🟢' : '⚪'} ${bestPair.s.signal}` : null,
    `⏱ Reference timeframe: <b>${esc(e.focusTf || '—')}</b>`,
    relatedCommentaryBlock(ccy, allNewsPool, 3)
  ];
  lines.push('', CREDIT_LINE);
  return lines.filter(Boolean).join('\n');
}
/* Weekly outlook: every high-importance event in ForexFactory's "this week" window (the widest
 * free scope this feed offers), each with its own research note - sent as ONE MESSAGE PER EVENT
 * (by request: a single combined message reads as one wall of text once several events are in
 * it, and Telegram groups back-to-back messages from the same bot closely enough that a
 * multi-chunk split of one giant text didn't feel "separate" either). A short header message
 * goes out first, then each event gets its own bubble. */
function buildWeeklyOutlook(MARKET_DATA, NEWS_AUTO) {
  const header = `📆 <b>WEEKLY OUTLOOK — ${nowMyt()}</b>\nEvery high-impact event this week gets its own message below: fundamentals, related commentary collected so far, and a hawkish/dovish research verdict.`;
  const dedupedPool = buildCommentaryPool(MARKET_DATA, NEWS_AUTO);

  const weekEvents = (MARKET_DATA.incoming || []).concat((NEWS_AUTO && NEWS_AUTO.incoming) || [])
    .filter(e => e.importance === 'high')
    .map(e => ({ e, at: parseMytToUtc(e.timeMyt) }))
    .sort((a, b) => (a.at ? a.at.getTime() : Infinity) - (b.at ? b.at.getTime() : Infinity));

  const messages = [header + '\n\n' + CREDIT_LINE];
  if (!weekEvents.length) {
    messages[0] = header + '\n\nNo high-impact events found in this week\'s calendar.\n\n' + CREDIT_LINE;
  } else {
    weekEvents.forEach(x => messages.push(eventResearchNote(MARKET_DATA, dedupedPool, x.e)));
  }
  return messages;
}

(async () => {
  const MARKET_DATA = loadJsModule('xauusd-data.js', 'MARKET_DATA');
  const NEWS_AUTO = loadJsModule('news-auto.js', 'NEWS_AUTO');
  const ATR_DATA = loadJsModule('atr.js', 'ATR_DATA'); // real Wilder ATR(14) per instrument, for the ATR-based price-target line
  const MACRO_AUTO = loadJsModule('macro-auto.js', 'MACRO_AUTO');
  if (!MARKET_DATA) { console.log('No xauusd-data.js found - nothing to check.'); return; }
  const COMMENTARY_POOL = buildCommentaryPool(MARKET_DATA, NEWS_AUTO); // shared "related commentary" search pool for every event card

  if (DAILY) {
    // Two separate messages by request: one plain summary, one dedicated to predictions.
    const summary = buildDailySummary(MARKET_DATA, NEWS_AUTO, MACRO_AUTO);
    const prediction = buildDailyPrediction(MARKET_DATA, NEWS_AUTO);
    console.log(summary.replace(/<\/?b>/g, '') + '\n\n' + prediction.replace(/<\/?b>/g, ''));
    const r1 = await sendTelegram(summary);
    await new Promise(res => setTimeout(res, 400));
    const r2 = await sendTelegram(prediction);
    console.log('\nSummary: ' + (r1.ok ? 'SENT' : r1.skipped ? 'skipped (no credentials)' : 'FAILED'));
    console.log('Prediction: ' + (r2.ok ? 'SENT' : r2.skipped ? 'skipped (no credentials)' : 'FAILED'));
    if ((!r1.ok && !r1.skipped) || (!r2.ok && !r2.skipped)) process.exitCode = 1;
    return;
  }

  if (EVENING) {
    const summary = buildEveningRecap(MARKET_DATA, NEWS_AUTO, MACRO_AUTO);
    console.log(summary.replace(/<\/?b>/g, ''));
    const r = await sendTelegram(summary);
    console.log(r.ok ? '\nSENT evening recap.' : r.skipped ? '\n(no Telegram credentials - printed above only)' : '\nFAILED to send evening recap.');
    if (!r.ok && !r.skipped) process.exitCode = 1;
    return;
  }

  if (WEEKLY) {
    const chunks = buildWeeklyOutlook(MARKET_DATA, NEWS_AUTO);
    console.log(chunks.map(c => c.replace(/<\/?b>/g, '')).join('\n\n=== next message ===\n\n'));
    let sentAll = true, anySkipped = false;
    for (const chunk of chunks) {
      const r = await sendTelegram(chunk);
      if (r.skipped) anySkipped = true; else if (!r.ok) sentAll = false;
      await new Promise(res => setTimeout(res, 1500));
    }
    console.log(anySkipped ? '\n(no Telegram credentials - printed above only)' : sentAll ? `\nSENT weekly outlook (${chunks.length} message(s)).` : '\nFAILED to send one or more weekly outlook messages.');
    if (!sentAll && !anySkipped) process.exitCode = 1;
    return;
  }

  if (PREVIEW) {
    const sampleEvent = ((MARKET_DATA.incoming || []).find(e => e.importance === 'high')) || (MARKET_DATA.incoming || [])[0];
    const sampleTab = MARKET_DATA.tabs[0];
    const sampleAutoByTab = NEWS_AUTO && NEWS_AUTO.byTab && NEWS_AUTO.byTab[sampleTab.id];
    const sampleNews = ((sampleAutoByTab && sampleAutoByTab.news) || [])[0] || (sampleTab.news || [])[0];
    const evtCard = sampleEvent ? eventCard(MARKET_DATA, ATR_DATA, sampleEvent, COMMENTARY_POOL) : null;
    const nwsCard = sampleNews ? newsCard(MARKET_DATA, sampleTab, sampleNews) : null;
    console.log('===== EVENT CARD PREVIEW =====\n' + (evtCard ? evtCard.caption + '\n[chart] ' + evtCard.chartUrl : '(no incoming events loaded)'));
    console.log('\n===== NEWS CARD PREVIEW =====\n' + (nwsCard ? nwsCard.caption + '\n[chart] ' + nwsCard.chartUrl : '(no news loaded)'));
    if (TOKEN && CHAT_ID && evtCard) {
      console.log('\nSending the event card preview to Telegram (as a photo) for a real render check...');
      const r = await sendTelegramCard('🧪 <b>PREVIEW</b> (not a real alert, not saved to state)\n\n' + evtCard.caption, evtCard.chartUrl);
      console.log(r.ok ? 'Preview sent.' : 'Preview send failed.');
    }
    return;
  }

  if (REMINDERS) {
    // Countdown reminders for high-importance events, independent of the "new item detected"
    // alerts above - own dedup namespace ("remind:...") in the same state file so they never
    // collide with or duplicate the detection alerts.
    const REMINDER_STAGES = [30, 10, 2]; // minutes before - see readme/PR notes: 2-min stage is
    // best-effort only, GitHub Actions' free scheduler does not guarantee sub-5-minute accuracy.
    const state = loadState();
    const seen = new Set(state.sentKeys || []);
    const incoming = (MARKET_DATA.incoming || []).concat((NEWS_AUTO && NEWS_AUTO.incoming) || []).filter(e => e.importance === 'high');
    const now = Date.now();
    let sentCount = 0, failCount = 0;
    for (const e of incoming) {
      const at = parseMytToUtc(e.timeMyt);
      if (!at) continue;
      const minutesUntil = Math.round((at.getTime() - now) / 60000);
      if (minutesUntil < -20 || minutesUntil > 35) continue; // well outside any window - skip without even checking flags

      // Pre-event countdown stages
      for (const stage of REMINDER_STAGES) {
        if (minutesUntil > stage || minutesUntil < 0) continue; // not within this stage's window (or already past)
        const key = `remind:${e.event}|${e.date}:${stage}`;
        if (seen.has(key)) continue;
        const card = reminderCard(MARKET_DATA, ATR_DATA, e, Math.max(0, minutesUntil), stage, COMMENTARY_POOL);
        const r = await sendTelegramCard(card.caption, card.chartUrl);
        if (r.ok) { seen.add(key); sentCount++; console.log(`SENT reminder (T-${stage}): ${e.event}`); }
        else if (!r.skipped) { failCount++; console.log(`NOT SENT reminder (T-${stage}, will retry): ${e.event}`); }
        await new Promise(res => setTimeout(res, 1500)); // Telegram's real limit is ~20 msg/min per chat
      }

      // Post-event follow-up: this app has no free source for the actual released figure (checked -
      // the ForexFactory feed we use never populates "actual", even for past events), so rather than
      // stay silent or invent a number, nudge once to go check the real source and re-read the chart.
      if (minutesUntil <= -10 && minutesUntil >= -20) {
        const key = `followup:${e.event}|${e.date}`;
        if (!seen.has(key)) {
          const caption = [
            '🔔 <b>RESULT CHECK</b>',
            `<b>${esc(e.event)}</b> should be out by now (was due ${esc(mytDisplay(e.timeMyt))} MYT).`,
            '⚠️ This bot has no free feed for the actual released figure - go verify it directly:',
            e.url ? `🔗 ${esc(e.source || 'Source')}: ${e.url}` : '(no source link on this event)',
            '💡 Once you see the actual vs forecast, re-check the chart on your predicted focus symbol - a big beat/miss can reverse the pre-event call.',
            CREDIT_LINE
          ].filter(Boolean).join('\n');
          const r = await sendTelegram(caption);
          if (r.ok) { seen.add(key); sentCount++; console.log(`SENT follow-up: ${e.event}`); }
          else if (!r.skipped) { failCount++; console.log(`NOT SENT follow-up (will retry): ${e.event}`); }
          await new Promise(res => setTimeout(res, 1500));
        }
      }
    }
    state.sentKeys = Array.from(seen).slice(-2000);
    saveState(state);
    console.log(`Reminder check: ${incoming.length} high-impact events in window, ${sentCount} sent, ${failCount} failed.`);
    if (failCount > 0) process.exitCode = 1;
    return;
  }

  const state = loadState();
  const seen = new Set(state.sentKeys || []);
  // key is recorded as sent ONLY after a confirmed Telegram delivery (see loop below) - queuing
  // a candidate must never mark it as sent, or a delivery failure would silently drop it forever.
  const toSend = [];

  // 1. High-importance calendar events (curated + auto), deduped by event+date
  const incoming = (MARKET_DATA.incoming || []).concat((NEWS_AUTO && NEWS_AUTO.incoming) || []);
  incoming.filter(e => e.importance === 'high').forEach(e => {
    const key = 'evt:' + e.event + '|' + e.date;
    if (seen.has(key)) return;
    toSend.push({ key, card: eventCard(MARKET_DATA, ATR_DATA, e, COMMENTARY_POOL) });
  });

  // 2. Auto-classified news/speaker rows with a real hawkish/dovish side (skip NEUTRAL - too noisy)
  // BUG FIX: this used to read tab.news (MARKET_DATA's static curated array, which never has
  // .auto set) instead of NEWS_AUTO.byTab[tab.id].news (the freshly-fetched rows this whole
  // script exists to alert on) - the filter below was therefore always empty, silently. Curated
  // rows are never candidates here (they were already hand-reviewed before being committed).
  const tabs = MARKET_DATA.tabs || [];
  tabs.forEach(tab => {
    const autoByTab = NEWS_AUTO && NEWS_AUTO.byTab && NEWS_AUTO.byTab[tab.id];
    ((autoByTab && autoByTab.news) || []).filter(n => n.signal && n.signal !== 'NEUTRAL').forEach(n => {
      const key = 'news:' + n.title;
      if (seen.has(key)) return;
      toSend.push({ key, card: newsCard(MARKET_DATA, tab, n) });
    });
    ((autoByTab && autoByTab.speakers) || []).filter(s => s.side).forEach(s => {
      const key = 'spk:' + s.name + '|' + s.date;
      if (seen.has(key)) return;
      toSend.push({ key, card: speakerCard(MARKET_DATA, tab, s) });
    });
  });

  console.log(`Checked ${incoming.length} calendar rows, ${tabs.reduce((n, t) => n + (t.news || []).length + (t.speakers || []).length, 0)} news/speaker rows -> ${toSend.length} new candidate(s).`);

  let sentCount = 0, failCount = 0, skippedNoCreds = false;
  for (const item of toSend) {
    const r = await sendTelegramCard(item.card.caption, item.card.chartUrl);
    if (r.ok) { seen.add(item.key); sentCount++; console.log('SENT: ' + item.card.caption.split('\n')[1]); }
    else if (r.skipped) { skippedNoCreds = true; } // no credentials configured (local/dev run) - don't mark as sent, don't count as a failure
    else { failCount++; console.log('NOT SENT (will retry next run): ' + item.card.caption.split('\n')[1]); }
    await new Promise(res => setTimeout(res, 1500)); // Telegram's real limit is ~20 msg/min per chat - 400ms was too tight and caused 429s on the first real catch-up burst
  }

  state.sentKeys = Array.from(seen).slice(-2000); // cap growth - only the most recent 2000 keys matter
  saveState(state);
  console.log(`State saved: ${state.sentKeys.length} confirmed-sent keys. (${sentCount} sent, ${failCount} failed this run.)`);

  if (failCount > 0 && !skippedNoCreds) {
    console.error(`${failCount} Telegram send(s) failed - check the TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID secrets and Telegram API errors above.`);
    process.exitCode = 1; // surface as a red X in CI instead of a silent green checkmark
  }
})();
