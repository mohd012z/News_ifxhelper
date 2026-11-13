/* trader-chat-notify.js — Trader-Desk RESEARCH signals for the linked discussion group
 * ("ifxhelper_Trader Chat", -1004296386476). NOT the channel broadcast.
 *
 * Why it exists (Anam, 2026-11-13): the channel card (telegram-notify.js) is a bare
 * keyword-heuristic ORDER CALL — the same message in the linked group is redundant, and
 * the "Heuristic impact score" bar can be a flat zero. This script re-runs the SAME
 * candidate detection (new high-signal news/speaker rows) but renders a different card:
 * the news direction is CROSS-CHECKED against the live BBMA multi-timeframe alignment
 * and combined with live levels (Camarilla pivots + ATR14), macro context (DXY/US10Y),
 * the 48h catalyst check, and the related-commentary tally.
 *
 * Verdicts (the whole point of the card):
 *   ✅ CONFIRMED   — news direction == chart alignment (N/M directional TFs agree)
 *   ⚠️ CONTRADICTED — news direction == OPPOSITE of chart alignment
 *   (silent)       — chart mixed or unavailable: nothing to confirm, so stay quiet
 * The chat gets only the interesting cases; the channel keeps its format unchanged.
 *
 * Destination: TELEGRAM_TRADER_CHAT_ID (ifx.env), fallback the linked-group constant.
 * Dedup: own state file .trader-alert-state.json, keys "news:<title>" / "spk:<name>|<date>",
 * recorded ONLY after confirmed delivery (same contract as telegram-notify.js).
 * Runs in the 30-min poller cycle AFTER build-news.js + telegram-notify.js.
 *
 * Run:  node trader-chat-notify.js             (live: detect + send + state)
 *       node trader-chat-notify.js --preview   (show candidates + verdicts, no send/state)
 *       node trader-chat-notify.js --force <substr>  (send the newest candidate whose
 *       title matches <substr>, regardless of dedup — for a manual test send)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '.trader-alert-state.json');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_TRADER_CHAT_ID || '-1004296386476';
const PREVIEW = process.argv.includes('--preview');
const FORCE_IDX = process.argv.indexOf('--force');
const FORCE = FORCE_IDX > -1 ? process.argv[FORCE_IDX + 1] : null;

const SharedLogic = require('./shared-market-logic.js');
const BBMASignals = require('./lib/bbma-telegram-signals.js');

function loadJsModule(file, globalName) {
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) return null;
  const win = {};
  const code = fs.readFileSync(full, 'utf8');
  new Function('window', code)(win);
  return win[globalName] || null;
}
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return { sentKeys: [] }; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtPrice(v) { return v == null ? '—' : (Math.abs(v) >= 20 ? v.toFixed(3) : v.toFixed(5)); }
function nowMyt() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${hh}:${mm}`;
}

// Same MYT parser contract as telegram-notify.js (curated "17 Sep 20:30" + auto "Tue, 2026-11-10 21:30").
const MONTHS_ = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseMytToUtc(timeMyt) {
  if (!timeMyt) return null;
  let m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{1,2}):(\d{2})/.exec(timeMyt);
  if (!m) {
    m = /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/.exec(timeMyt);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]));
  }
  const now = new Date();
  let year = now.getUTCFullYear();
  let d = new Date(Date.UTC(year, MONTHS_[m[2]], +m[1], +m[3] - 8, +m[4]));
  if (d.getTime() < now.getTime() - 200 * 86400000) d = new Date(Date.UTC(year + 1, MONTHS_[m[2]], +m[1], +m[3] - 8, +m[4]));
  return d;
}

/* Focus symbol for a candidate — identical resolution to telegram-notify.js
 * (gold tab -> XAU/USD, crypto -> BTC/USD, forex -> currency in text's best USD pair). */
function focusSymbolFor(MARKET_DATA, tab, text) {
  if (tab.id === 'gold') return 'XAU/USD';
  if (tab.id === 'crypto') return 'BTC/USD';
  const f = resolveForexFocus(MARKET_DATA, tab, text || '');
  return (f && f.sym) || 'EUR/USD';
}
function resolveForexFocus(MARKET_DATA, tab, text) {
  const ccy = SharedLogic.eventCurrency(text || '');
  const best = ccy ? SharedLogic.bestPairFor(MARKET_DATA.fxPairs, MARKET_DATA.currencies, ccy) : null;
  const spot = best && MARKET_DATA.fxPairs ? ((MARKET_DATA.fxPairs || []).find(x => x.pair === best.pair) || {}).snap : null;
  if (best) return { sym: best.pair, spot: spot != null ? spot : (tab.price && tab.price.spot) };
  return { sym: 'EUR/USD', spot: tab.price && tab.price.spot };
}
function symId(sym) { return String(sym || '').replace('/', '').toUpperCase(); }
/* Best focus for a headline that appears under several tabs: a NAMED-currency resolution
 * (forex tab whose text names a currency/bank -> its best USD pair) beats the generic gold
 * tab, which beats crypto — "Euro Falls as US Dollar gains" is a EUR/USD story even though
 * the RSS also filed it under gold. The channel posts one card per tab; the chat posts ONE
 * card per headline. A forex tab whose text names NO currency is the tab's default fallback
 * (always EUR/USD) and never outranks a named pair. */
function bestFocus(MARKET_DATA, group) {
  let gold = null, crypto = null;
  for (const c of group) {
    const tab = c.tab, item = c.item;
    const text = `${item.title || ''} ${item.summary || ''} ${item.name || ''} ${item.quote || ''}`;
    const sym = focusSymbolFor(MARKET_DATA, tab, text);
    if (tab.id === 'forex') {
      if (SharedLogic.eventCurrency(text)) return { tab, sym, text }; // named-currency pair wins
      continue; // no named currency: EUR/USD default fallback
    }
    if (tab.id === 'gold') { if (!gold) gold = { tab, sym, text }; continue; }
    if (tab.id === 'crypto') { if (!crypto) crypto = { tab, sym, text }; continue; }
    return { tab, sym, text };
  }
  return gold || crypto || { tab: group[0].tab, sym: focusSymbolFor(MARKET_DATA, group[0].tab, ''), text: '' };
}
/* Collapse same-title candidates (an RSS headline is filed under several tabs) to ONE,
 * keeping the best focus. Returns [{ key, item, focus }] where focus = { tab, sym, text }. */
function dedupCandidates(MARKET_DATA, candidates) {
  const byTitle = new Map();
  for (const c of candidates) {
    const title = (c.item.title || c.item.name || '').trim();
    if (!title) continue;
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(c);
  }
  const out = [];
  for (const [title, group] of byTitle) {
    const first = group[0];
    const focus = bestFocus(MARKET_DATA, group);
    const item = { ...first.item };
    if (!item.time) { const t = group.find(g => g.item.time); if (t) item.time = t.item.time; }
    out.push({ key: first.key, allKeys: group.map(g => g.key), item, focus });
  }
  return out;
}

/* Related-commentary tally for the focus symbol's driving currency (same pattern table
 * as telegram-notify.js — the chat card must never disagree with the channel research). */
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
function drivingCurrencyFor(sym) {
  const id = symId(sym);
  if (id.startsWith('XAU') || id.startsWith('XAG')) return 'USD';
  if (id.startsWith('BTC') || id.startsWith('ETH')) return null;
  const base = id.slice(0, 3);
  return CCY_COMMENTARY_PATTERN[base] ? base : null;
}

/* The verdict: news direction vs live BBMA alignment. Returns { verdict, emoji, text } or
 * null when the chart is mixed/unavailable (fail-closed: a card that confirms nothing is
 * noise — the chat stays silent in that case). */
function crossCheckVerdict(signal, itemSignal) {
  const newsDir = itemSignal === 'SELL' ? 'DOWN' : itemSignal === 'BUY' ? 'UP' : null;
  if (!newsDir) return null;
  if (!signal || !signal.ok) return null; // chart unavailable -> fail closed
  const chartDir = signal.alignment === 'DOWN_ALIGNED' ? 'DOWN' : signal.alignment === 'UP_ALIGNED' ? 'UP' : null;
  if (!chartDir) return null; // mixed
  const d = (signal.directional || { up: 0, down: 0, total: 0 });
  if (chartDir === newsDir) {
    const agreeing = newsDir === 'DOWN' ? d.down : d.up;
    return {
      verdict: 'CONFIRMED', emoji: '✅',
      text: `✅ CONFIRMED ${newsDir} — news and ${agreeing}/${d.total} directional timeframes agree`
    };
  }
  return {
    verdict: 'CONTRADICTED', emoji: '⚠️',
    text: `⚠️ CONTRADICTED — news says ${newsDir}, chart is ${chartDir} (${d.up}/${d.down} up/down of ${d.total})`
  };
}

/* Build the Trader-Desk research card. Pure (no fetch): signal/pivots/atr/macro/catalyst/
 * commentary are pre-resolved, so the test suite pins every line without network. */
function traderResearchCard({ item, sym, signal, pivots, atrRow, macro, catalyst, commentary, force = false }) {
  const verdict = crossCheckVerdict(signal, item.signal);
  const mixedReason = !verdict && (!signal || !signal.ok) ? `chart unavailable (${signal ? signal.reason : 'no data'})` : 'chart mixed — nothing confirmed';
  if (!verdict && !force) return { silent: true, reason: mixedReason, sym, item };

  const lines = [
    '🔬 <b>TRADER DESK — RESEARCH SIGNAL</b> (news × chart cross-check)',
    '',
    `📰 “${esc(item.title)}” — ${esc(item.source || 'Source')}`,
    `   ${esc(item.time || item.date || '—')}${item.url ? ' · 🔗 ' + item.url : ''}`,
    '',
    '⚖️ <b>News vs Chart</b>',
    `   • News heuristic: ${item.signal === 'SELL' ? '🔴' : '🟢'} ${esc(item.signal)} ${esc(sym)} (keyword ${esc(item.impact || (item.side || '—'))}, impact ${item.impactPct != null ? esc(item.impactPct) : '—'})`,
    signal && signal.ok
      ? `   • Chart (BBMA, ${(signal.directional ? signal.directional.up + signal.directional.down : 0)}/${signal.directional ? signal.directional.total : 0} directional TFs): ${signal.alignment === 'DOWN_ALIGNED' ? 'aligned ↓' : signal.alignment === 'UP_ALIGNED' ? 'aligned ↑' : 'mixed'}`
      : `   • Chart (BBMA): n/a — ${esc(signal ? signal.reason : 'no data')}`,
    verdict ? `   • Verdict: ${esc(verdict.text)}` : `   • Verdict: 🟡 FORCED (test) — ${esc(mixedReason)}`,
    '',
    '🧭 <b>Levels & context (live)</b>',
    `   • ${esc(sym)} ${signal && signal.price != null ? fmtPrice(signal.price) : '—'} · ATR14 ${atrRow && atrRow.atr != null ? `${(atrRow.atr * 10000).toFixed(0)} pips` : '—'}`
  ];
  if (pivots && pivots.ok) {
    lines.push(`   • Pivots (${esc(pivots.session)} session): R1 ${fmtPrice(pivots.R1)} · S1 ${fmtPrice(pivots.S1)} · S2 ${fmtPrice(pivots.S2)} · S3 ${fmtPrice(pivots.S3)} · S4 ${fmtPrice(pivots.S4)} · close ${Math.round((pivots.closePos || 0) * 100)}% of range`);
  }
  if (macro && (macro.dxy || macro.us10y)) {
    const bits = [];
    if (macro.dxy) bits.push(`DXY ${esc(macro.dxy.value)} (${esc(macro.dxy.delta)})`);
    if (macro.us10y) bits.push(`US10Y ${esc(macro.us10y.value)} (${esc(macro.us10y.delta)})${/elevated|higher|real yield/i.test(macro.us10y.note || '') ? ' — real-yield pressure' : ''}`);
    lines.push(`   • Macro: ${bits.join(' · ')}`);
  }
  lines.push(`   • Catalyst: ${catalyst ? esc(catalyst) : 'no high-impact events in 48h — size positions accordingly'}`);
  if (commentary && commentary.length) {
    lines.push(`   • Related commentary (${commentary.length}): ${commentary.map(c => `“${esc((c.title || '').slice(0, 60))}” [${esc(c.signal || 'NEUTRAL')}]`).join(' · ')}`);
  }
  lines.push('');
  lines.push(deskViewLine(sym, signal, pivots, item.signal));
  lines.push(BBMASignals.renderCompact(signal));
  lines.push('———');
  lines.push('🏷️ ifxhelper_2026 · Trader Desk (research) · Educational, not investment advice');
  return { caption: lines.join('\n'), sym, verdict: verdict ? verdict.verdict : 'FORCED' };
}

/* One honest operational line derived ONLY from live levels: short bias -> which level
 * breaks the trend, which level is the bullish surprise; buy bias mirrored. Never invents
 * targets beyond the published pivot ladder. */
function deskViewLine(sym, signal, pivots, itemSignal) {
  if (!pivots || !pivots.ok) return '🎯 <b>Desk view</b>: no fresh pivot session loaded — read the chart, size small.';
  if (itemSignal === 'SELL') {
    return `🎯 <b>Desk view</b>: trend-short below S3 ${fmtPrice(pivots.S3)}; a break of S4 ${fmtPrice(pivots.S4)} opens the next leg. Bullish surprise = reclaim R1 ${fmtPrice(pivots.R1)}.`;
  }
  if (itemSignal === 'BUY') {
    return `🎯 <b>Desk view</b>: trend-long above R1 ${fmtPrice(pivots.R1)}; a break of R2 ${fmtPrice(pivots.R2)} opens the next leg. Bearish surprise = lose S1 ${fmtPrice(pivots.S1)}.`;
  }
  return '🎯 <b>Desk view</b>: no directional bias — watch the levels above.';
}

async function sendTelegram(text) {
  if (!TOKEN || !CHAT_ID) { console.log('SKIP (no Telegram credentials configured):\n' + text + '\n'); return { ok: false, skipped: true }; }
  let r;
  try {
    r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
  } catch (e) { console.log('FAIL Telegram send (network): ' + e.message); return { ok: false }; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    console.log('FAIL Telegram send: ' + (j.description || r.status));
    return { ok: false, rateLimited: /too many requests/i.test(j.description || '') };
  }
  return { ok: true };
}

module.exports = { traderResearchCard, crossCheckVerdict, focusSymbolFor, parseMytToUtc, drivingCurrencyFor, dedupCandidates, bestFocus };

if (require.main === module) (async () => {
  const MARKET_DATA = loadJsModule('xauusd-data.js', 'MARKET_DATA');
  const NEWS_AUTO = loadJsModule('news-auto.js', 'NEWS_AUTO');
  const MACRO_AUTO = loadJsModule('macro-auto.js', 'MACRO_AUTO');
  const PIVOTS = loadJsModule('pivots.js', 'PIVOTS_AUTO');
  const ATR_DATA = loadJsModule('atr.js', 'ATR_DATA');
  if (!MARKET_DATA) { console.log('No xauusd-data.js found - nothing to check.'); return; }

  // Same candidate set the channel uses (new high-signal news/speaker rows, skip NEUTRAL),
  // with its own dedup state so the chat is independent of the channel's sent-keys.
  const state = loadState();
  const seen = new Set(state.sentKeys || []);
  const candidates = [];
  (MARKET_DATA.tabs || []).forEach(tab => {
    const autoByTab = NEWS_AUTO && NEWS_AUTO.byTab && NEWS_AUTO.byTab[tab.id];
    ((autoByTab && autoByTab.news) || []).filter(n => n.signal && n.signal !== 'NEUTRAL').forEach(n => {
      candidates.push({ kind: 'news', key: 'news:' + n.title, item: n, tab });
    });
    ((autoByTab && autoByTab.speakers) || []).filter(s => s.side).forEach(s => {
      candidates.push({ kind: 'spk', key: 'spk:' + s.name + '|' + s.date, item: s, tab });
    });
  });
  const forceMatch = FORCE ? candidates.filter(c => (c.item.title || c.item.name || '').includes(FORCE)) : null;
  const candPool = forceMatch || candidates;
  // ONE card per headline: collapse same-title rows (RSS files a headline under several tabs)
  // and pick the best focus. Dedup state records EVERY key in the group so a future run
  // never re-fires any tab's copy.
  const deduped = dedupCandidates(MARKET_DATA, candPool);
  const toProcess = FORCE ? deduped : deduped.filter(c => !seen.has(c.key) && !(c.allKeys && c.allKeys.some(k => seen.has(k))));
  console.log(`Candidates: ${candidates.length} total, ${deduped.length} unique headline(s), ${toProcess.length} new (force=${FORCE || 'off'}).`);

  // 48h catalyst (shared by every card in this run — computed once).
  const nowMs = Date.now();
  const catalystEvent = (MARKET_DATA.incoming || []).concat((NEWS_AUTO && NEWS_AUTO.incoming) || [])
    .filter(e => e.importance === 'high')
    .map(e => ({ e, at: parseMytToUtc(e.timeMyt) }))
    .filter(x => x.at && x.at.getTime() >= nowMs - 5 * 60000 && x.at.getTime() <= nowMs + 48 * 3600000)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  const catalyst = catalystEvent ? `${catalystEvent.e.event} (${catalystEvent.e.timeMyt})` : null;

  // Commentary pool (all classified rows, deduped by title — same source the channel uses).
  const pool = [];
  (MARKET_DATA.tabs || []).forEach(tab => {
    const autoByTab = NEWS_AUTO && NEWS_AUTO.byTab && NEWS_AUTO.byTab[tab.id];
    ((autoByTab && autoByTab.news) || []).forEach(n => pool.push({ title: n.title, signal: n.signal }));
    ((autoByTab && autoByTab.speakers) || []).forEach(s => pool.push({ title: s.name + ' ' + (s.role || '') + ' ' + (s.quote || ''), signal: s.signal }));
  });
  const poolSeen = {};
  pool.forEach(p => { if (!poolSeen[p.title]) poolSeen[p.title] = p; });

  let sentCount = 0, silentCount = 0, failCount = 0;
  for (const c of toProcess) {
    const sym = c.focus.sym;
    const itemLabel = c.item.name ? `${c.item.name} (${c.item.role || ''}) — “${c.item.quote || ''}”` : c.item.title;
    let signal;
    try { signal = await BBMASignals.buildSignalFor(sym); } catch (e) { signal = { ok: false, symbol: sym, reason: e.message }; }
    const pid = symId(sym);
    const pivots = (PIVOTS && PIVOTS.symbols && PIVOTS.symbols[pid]) || null;
    const atrRow = (ATR_DATA && ATR_DATA.rows || []).find(r => r.id === pid) || null;
    const ccy = drivingCurrencyFor(sym);
    const re = ccy ? CCY_COMMENTARY_PATTERN[ccy] : null;
    const commentary = re ? Object.values(poolSeen).filter(p => re.test(p.title || '')).slice(0, 3) : [];
    const card = traderResearchCard({ item: c.item, sym, signal, pivots, atrRow, macro: MACRO_AUTO, catalyst, commentary, force: !!FORCE });
    if (card.silent) {
      silentCount++;
      console.log(`SILENT (${card.reason}): [${c.item.signal}] ${itemLabel} -> ${sym}`);
      continue;
    }
    if (PREVIEW) {
      console.log(`\n===== PREVIEW (${card.verdict}) [${c.item.signal}] ${itemLabel} -> ${sym} =====\n` + card.caption + '\n');
      continue;
    }
    const r = await sendTelegram(card.caption);
    if (r.ok) { (c.allKeys || [c.key]).forEach(k => seen.add(k)); sentCount++; console.log(`SENT (${card.verdict}): ${itemLabel} -> ${sym}`); }
    else if (!r.skipped) { failCount++; console.log(`NOT SENT (will retry next run): ${itemLabel}`); }
    await new Promise(res => setTimeout(res, 1500));
  }
  if (!PREVIEW) {
    state.sentKeys = Array.from(seen).slice(-2000);
    saveState(state);
    console.log(`State saved: ${state.sentKeys.length} keys. (${sentCount} sent, ${silentCount} silent, ${failCount} failed.)`);
  }
  if (failCount > 0) process.exitCode = 1;
})().catch(e => { console.log('ERR ' + (e && e.stack || e)); process.exitCode = 1; });
