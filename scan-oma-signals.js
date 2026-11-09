'use strict';
/* scan-oma-signals.js — Oma-ally-style MTF signal scanner (run by the ifx poller every 5 min).
 * Scans USDJPY / EURGBP / EURUSD / GBPUSD / XAUUSD from keyless Dukascopy m5 (7d), renders
 * the channel-format card for any deterministic signal, and posts NEW signals only
 * (dedup by symbol+direction+M15-bar; 24h expiry). Fail-closed: no signal -> no post.
 * Usage: node scan-oma-signals.js            # scan + send
 *        node scan-oma-signals.js --dry      # scan only, print (no Telegram)
 */
const fs = require('fs');
const path = require('path');
const Oma = require('./lib/bbma-oma-signals');

const SYMBOLS = ['USDJPY', 'EURGBP', 'EURUSD', 'GBPUSD', 'XAUUSD'];
const STATE_FILE = path.join(__dirname, '.oma-signal-state.json');
const DRY = process.argv.includes('--dry');

async function fetchM5(instrument) {
  const { getHistoricalRates } = require('dukascopy-node');
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // exclusive
  const rows = await getHistoricalRates({
    instrument, dates: { from, to }, timeframe: 'm5', priceType: 'bid', format: 'array',
    batchSize: 10, pauseBetweenBatchesMs: 400, timeoutMs: 25000,
    retryCount: 2, pauseBetweenRetriesMs: 800, failAfterRetryCount: false
  });
  return (rows || [])
    .filter(r => Array.isArray(r) && r.length >= 5 && [r[0], r[1], r[2], r[3], r[4]].every(Number.isFinite))
    .map(r => ({ time: new Date(r[0]).toISOString(), open: +r[1], high: +r[2], low: +r[3], close: +r[4] }));
}
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { sent: {} }; } }
function saveState(s) {
  const cutoff = Date.now() - 24 * 3600000;
  s.sent = Object.fromEntries(Object.entries(s.sent).filter(([, v]) => (v && v.at) && v.at > cutoff));
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));
}

(async () => {
  const state = loadState();
  let posted = 0, failed = 0;
  for (const sym of SYMBOLS) {
    let m5;
    try { m5 = await fetchM5(sym.toLowerCase()); }
    catch (e) { console.log(sym + ': fetch failed (' + (e && e.message) + ') - skipped'); continue; }
    const s = Oma.scanSymbol(sym, m5);
    if (s.state !== 'SIGNAL') { console.log(sym + ': ' + s.state); continue; }
    const key = sym + ':' + s.dir + ':' + s.m15Time;
    const prev = state.sent[key];
    if (prev && prev.bar === s.m15Time) { console.log(sym + ': signal unchanged (M15 ' + s.m15Time + ') - not reposted'); continue; }
    const card = Oma.renderCard(s);
    console.log('--- ' + sym + ' ' + s.action + ' (entry ' + s.entry + ') ---');
    if (DRY) { console.log(card.replace(/<[^>]+>/g, '')); state.sent[key] = { bar: s.m15Time, at: Date.now() }; continue; }
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID;
    if (!token || !chat) { console.log(sym + ': no Telegram creds - printed only'); continue; }
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: card, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) { posted++; state.sent[key] = { bar: s.m15Time, at: Date.now() }; console.log(sym + ': SENT (msg ' + j.result.message_id + ')'); }
    else { failed++; console.log(sym + ': send failed - ' + (j.description || r.status)); }
    await new Promise(res => setTimeout(res, 1500));
  }
  saveState(state);
  console.log('oma scan done: ' + SYMBOLS.length + ' symbols, ' + posted + ' posted, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
})().catch(e => { console.error('oma scan error:', e && e.stack || e); process.exitCode = 1; });
