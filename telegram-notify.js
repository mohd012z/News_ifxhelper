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
function nowMyt() {
  const d = new Date(Date.now() + 8 * 3600 * 1000); // MYT = UTC+8, fixed offset, no DST
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${hh}:${mm}`;
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

// ==================== Currency / pair inference (mirrors app.js) ====================
const EVENT_CCY_MAP = [
  [/\bFOMC\b|\bFed\b|\bUS\b|United States/i, 'USD'],
  [/\bBoJ\b|Bank of Japan/i, 'JPY'],
  [/\bECB\b|European Central Bank/i, 'EUR'],
  [/\bBoE\b|Bank of England/i, 'GBP'],
  [/\bRBA\b/i, 'AUD'],
  [/\bRBNZ\b/i, 'NZD'],
  [/\bBoC\b|Bank of Canada/i, 'CAD'],
  [/\bSNB\b/i, 'CHF'],
  [/\[(\w{3})\]/, null] // "[GBP] CPI y/y" style ForexFactory country-tagged titles - captured group wins below
];
function eventCurrency(text) {
  const tag = /\[(\w{3})\]/.exec(text || '');
  if (tag) return tag[1];
  for (const [re, ccy] of EVENT_CCY_MAP) { if (ccy && re.test(text || '')) return ccy; }
  return null;
}
function biasOf(currencies, code) {
  const c = (currencies || []).find(x => x.code === code);
  return c ? c.bias : 0;
}
function pairSignal(currencies, p) {
  const s = biasOf(currencies, p.base) - biasOf(currencies, p.quote);
  const sig = s > 0.15 ? 'BUY' : s < -0.15 ? 'SELL' : 'NEUTRAL';
  return { score: s, signal: sig, strength: Math.abs(s) };
}
/* Picks the "headline" pair for a currency, not just the mathematically widest spread - a
 * NZD/USD cross technically scoring higher than EUR/USD is not what anyone means by "the FOMC
 * pair to watch". Priority: 1) the direct pair against USD (the standard way any single
 * currency's move gets read) 2) for USD itself, the conventional major-pair watch order
 * 3) only then fall back to whichever loaded cross has the strongest bias gap. */
const USD_MAJOR_ORDER = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'USD/CHF', 'NZD/USD'];
function bestPairFor(MARKET_DATA, ccy) {
  if (!ccy) return null;
  const fxPairs = MARKET_DATA.fxPairs || [];
  const byPair = name => { const p = fxPairs.find(x => x.pair === name); return p ? { pair: p.pair, s: pairSignal(MARKET_DATA.currencies, p) } : null; };

  if (ccy !== 'USD') {
    const direct = fxPairs.find(p => (p.base === ccy && p.quote === 'USD') || (p.base === 'USD' && p.quote === ccy));
    if (direct) return { pair: direct.pair, s: pairSignal(MARKET_DATA.currencies, direct) };
  } else {
    const nonNeutral = USD_MAJOR_ORDER.map(byPair).filter(Boolean).find(c => c.s.signal !== 'NEUTRAL');
    if (nonNeutral) return nonNeutral;
    const anyMajor = USD_MAJOR_ORDER.map(byPair).find(Boolean);
    if (anyMajor) return anyMajor;
  }
  // fallback: any loaded pair carrying this currency, widest bias gap first
  const candidates = fxPairs
    .filter(p => p.base === ccy || p.quote === ccy)
    .map(p => ({ pair: p.pair, s: pairSignal(MARKET_DATA.currencies, p) }))
    .sort((a, b) => b.s.strength - a.s.strength);
  return candidates[0] || null;
}
// ==================== Pip / price-target calculation ====================
// Same pip-size convention as the dashboard's desk assistant (app.js pipSize()).
function pipSize(sym) {
  const s = String(sym || '').toUpperCase();
  if (s.indexOf('JPY') > -1) return 0.01;
  if (s.indexOf('XAU') > -1 || s.indexOf('GOLD') > -1) return 0.01;
  if (s.indexOf('XAG') > -1 || s.indexOf('SILVER') > -1) return 0.001;
  if (['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'].some(c => s.indexOf(c) > -1)) return 1;
  if (s.indexOf('/') > -1 || /^[A-Z]{6}$/.test(s)) return 0.0001;
  return 0.01;
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
function eventCard(MARKET_DATA, atrData, e) {
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
    `🕒 Time to trade (MYT): <b>${esc(e.timeMyt || '—')}</b>${session ? ` · Session: ${esc(session)}` : ''}`,
    `📤 Alert sent (MYT): ${nowMyt()}`,
    e.note ? `📝 ${esc(e.note)}` : null,
    e.play ? `💡 ${esc(e.play)}` : null,
    e.url ? `🔗 ${esc(e.source || 'Source')}: ${e.url}` : null
  ].filter(Boolean).join('\n');
  return { caption, chartUrl: chartImageUrl(top ? top.pair : (ccy || e.event.slice(0, 20)), top ? +top.s.score.toFixed(2) : 0, signal) };
}
function newsCard(MARKET_DATA, tab, n) {
  const focusSym = tab.id === 'gold' ? 'XAU/USD' : tab.id === 'crypto' ? 'BTC/USD (+ ETH/USD)' : (tab.label.split('·')[1] || tab.label).trim();
  const chart = TF_CHART[n.tf] || n.tf || '—';
  const reasoning = n.impact === 'bearish' ? 'Headline classified bearish (keyword heuristic on real news text) → SELL bias'
    : n.impact === 'bullish' ? 'Headline classified bullish (keyword heuristic on real news text) → BUY bias'
      : 'Headline classified neutral — no clear directional keyword match';
  const priceLine = priceMoveLine(tab.id === 'gold' ? 'XAU/USD' : tab.id === 'crypto' ? 'BTC' : focusSym, tab.price && tab.price.spot, n.impactPct);
  const caption = [
    `<b>${esc(tab.label)}</b> — auto-classified news`,
    orderCallLine(n.signal),
    `ℹ️ ${reasoning}`,
    `🎯 Focus symbol: <b>${esc(focusSym)}</b>`,
    `📊 Predicted move: <b>${n.impactPct > 0 ? '+' : ''}${n.impactPct}%</b> (model estimate)`,
    priceLine,
    `⏱ Timeframe: ${esc(n.tf || '—')} → chart: <b>${esc(chart)}</b>`,
    `📤 Alert sent (MYT): ${nowMyt()}`,
    `📝 ${esc(n.title)}`,
    `🔗 ${esc(n.source || 'Source')}${n.url ? ': ' + n.url : ''}`
  ].filter(Boolean).join('\n');
  return { caption, chartUrl: chartImageUrl(focusSym, n.impactPct || 0, n.signal) };
}
function speakerCard(MARKET_DATA, tab, s) {
  const focusSym = tab.id === 'gold' ? 'XAU/USD' : tab.id === 'crypto' ? 'BTC/USD (+ ETH/USD)' : (tab.label.split('·')[1] || tab.label).trim();
  const arrow = s.side === 'hawkish' ? '🦅 HAWKISH' : '🕊️ DOVISH';
  const priceLine = priceMoveLine(tab.id === 'gold' ? 'XAU/USD' : tab.id === 'crypto' ? 'BTC' : focusSym, tab.price && tab.price.spot, s.impactPct);
  const caption = [
    `<b>${esc(tab.label)}</b> — speaker/central-bank alert`,
    orderCallLine(s.signal),
    `ℹ️ ${esc(reasonFromDirRule(tab, s.side))}`,
    `🗣 ${arrow}: <b>${esc(s.name)}</b> (${esc(s.role)})`,
    `🎯 Focus symbol: <b>${esc(focusSym)}</b>`,
    `📊 Predicted move: <b>${s.impactPct > 0 ? '+' : ''}${s.impactPct}%</b> (weight ${s.w != null ? s.w : '—'} × strength ${s.s != null ? s.s : '—'} × surprise ${s.f != null ? s.f : '—'})`,
    priceLine,
    `📤 Alert sent (MYT): ${nowMyt()}`,
    `📝 “${esc(s.quote)}”`,
    `🔗 ${esc(s.source || 'Source')}${s.url ? ': ' + s.url : ''}`
  ].filter(Boolean).join('\n');
  return { caption, chartUrl: chartImageUrl(focusSym, s.impactPct || 0, s.signal) };
}
/* Countdown reminder card - same focus/reasoning/price-move fields as eventCard(), just framed
 * as "T-minus" instead of "new event detected". stage is one of REMINDER_STAGES (minutes). */
function reminderCard(MARKET_DATA, atrData, e, minutesLeft, stage) {
  const base = eventCard(MARKET_DATA, atrData, e);
  const header = `⏰ <b>REMINDER — ${stage} min to go</b> (${minutesLeft <= 0 ? 'starting now' : `~${minutesLeft} min left`})`;
  return { caption: header + '\n' + base.caption, chartUrl: base.chartUrl };
}

(async () => {
  const MARKET_DATA = loadJsModule('xauusd-data.js', 'MARKET_DATA');
  const NEWS_AUTO = loadJsModule('news-auto.js', 'NEWS_AUTO');
  const ATR_DATA = loadJsModule('atr.js', 'ATR_DATA'); // real Wilder ATR(14) per instrument, for the ATR-based price-target line
  if (!MARKET_DATA) { console.log('No xauusd-data.js found - nothing to check.'); return; }

  if (PREVIEW) {
    const sampleEvent = ((MARKET_DATA.incoming || []).find(e => e.importance === 'high')) || (MARKET_DATA.incoming || [])[0];
    const sampleTab = MARKET_DATA.tabs[0];
    const sampleNews = (sampleTab.news || [])[0];
    const evtCard = sampleEvent ? eventCard(MARKET_DATA, ATR_DATA, sampleEvent) : null;
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
      if (minutesUntil < -5 || minutesUntil > 35) continue; // well outside any stage window - skip without even checking flags
      for (const stage of REMINDER_STAGES) {
        if (minutesUntil > stage) continue; // not within this stage's window yet
        const key = `remind:${e.event}|${e.date}:${stage}`;
        if (seen.has(key)) continue;
        const card = reminderCard(MARKET_DATA, ATR_DATA, e, Math.max(0, minutesUntil), stage);
        const r = await sendTelegramCard(card.caption, card.chartUrl);
        if (r.ok) { seen.add(key); sentCount++; console.log(`SENT reminder (T-${stage}): ${e.event}`); }
        else if (!r.skipped) { failCount++; console.log(`NOT SENT reminder (T-${stage}, will retry): ${e.event}`); }
        await new Promise(res => setTimeout(res, 400));
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
    toSend.push({ key, card: eventCard(MARKET_DATA, ATR_DATA, e) });
  });

  // 2. Auto-classified news/speaker rows with a real hawkish/dovish side (skip NEUTRAL - too noisy)
  const tabs = MARKET_DATA.tabs || [];
  tabs.forEach(tab => {
    (tab.news || []).filter(n => n.auto && n.signal && n.signal !== 'NEUTRAL').forEach(n => {
      const key = 'news:' + n.title;
      if (seen.has(key)) return;
      toSend.push({ key, card: newsCard(MARKET_DATA, tab, n) });
    });
    (tab.speakers || []).filter(s => s.auto && s.side).forEach(s => {
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
    await new Promise(res => setTimeout(res, 400)); // stay well under Telegram's rate limit
  }

  state.sentKeys = Array.from(seen).slice(-2000); // cap growth - only the most recent 2000 keys matter
  saveState(state);
  console.log(`State saved: ${state.sentKeys.length} confirmed-sent keys. (${sentCount} sent, ${failCount} failed this run.)`);

  if (failCount > 0 && !skippedNoCreds) {
    console.error(`${failCount} Telegram send(s) failed - check the TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID secrets and Telegram API errors above.`);
    process.exitCode = 1; // surface as a red X in CI instead of a silent green checkmark
  }
})();
