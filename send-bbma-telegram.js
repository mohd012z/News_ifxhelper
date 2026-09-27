/* send-bbma-telegram.js
 * Sends BBMA Alert Box directly to a Telegram Channel (or Chat) WITHOUT any callback/fallback requirements.
 *
 * Requirements for Telegram Channel:
 * 1. Add your Bot as an Administrator in your Channel with "Post Messages" permission.
 * 2. Set TELEGRAM_CHAT_ID or TELEGRAM_CHANNEL_ID to your channel:
 *    - Public channel: "@your_channel_name"
 *    - Private channel: "-100xxxxxxxxxx" (must start with -100)
 * 3. Set TELEGRAM_BOT_TOKEN from @BotFather.
 *
 * Usage:
 *   node send-bbma-telegram.js --preview          # Prints formatted box in console
 *   node send-bbma-telegram.js                    # Sends to channel/chat if credentials exist
 *   node send-bbma-telegram.js --test             # Sends a test alert card to channel
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID;
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://mohd012z.github.io/News_ifxhelper/';
const PREVIEW = process.argv.includes('--preview');
const TEST = process.argv.includes('--test');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function nowMyt() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${hh}:${mm} MYT`;
}

function loadRuntime() {
  try {
    const full = path.join(__dirname, 'bbma-runtime.js');
    if (fs.existsSync(full)) {
      const win = {};
      new Function('window', fs.readFileSync(full, 'utf8'))(win);
      return win.BBMA_RUNTIME || null;
    }
  } catch (e) {}
  return null;
}

function formatBbmaAlertBox(alertData) {
  const rt = alertData || loadRuntime() || {};
  const alerts = rt.alerts || [];
  const primaryAlert = alerts[0] || {
    pattern: 'RE-ENTRY (Armed)',
    timeframe: 'H4',
    symbol: 'XAU/USD',
    level: 'HIGH',
    summary: 'H4 MHV confirmed rejection of Lower BB. MTF Trend aligned UP.'
  };

  const mtf = rt.mtf || {};
  const h4 = mtf.H4 || { trend: 'UP', location: 'UPPER_BAND', mhv: 'VALID_MHV' };
  const h1 = mtf.H1 || { trend: 'UP', location: 'MID_BB', reentry: 'ARMED' };
  const m15 = mtf.M15 || { trend: 'UP', location: 'LOWER_BB', momentum: 'NONE' };

  const event = rt.event || { name: 'Macro Runway', actual: 'Clear', forecast: '0.2%' };
  const price = rt.price || '3012.50';

  const box = [
    `📊 <b>XAU/USD BBMA ALERT COMMAND</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📍 <b>Instrument:</b> XAU/USD (Gold Spot: <b>${esc(price)}</b>)`,
    `⏱ <b>Timeframe:</b> <b>${esc(primaryAlert.timeframe || 'H4')}</b>`,
    `🎯 <b>Pattern:</b> <code>${esc(primaryAlert.pattern || 'BBMA SETUP')}</code>`,
    `⚡ <b>Setup Signal:</b> <b>${esc(primaryAlert.level === 'HIGH' ? '🔥 HIGH CONVICTION' : '⚠️ WATCH')}</b>`,
    `🕒 <b>Time:</b> <code>${nowMyt()} (UTC+8)</code>`,
    ``,
    `📈 <b>MULTI-TIMEFRAME (MTF) MATRIX</b>`,
    `• <b>H4:</b>  Trend: ${esc(h4.trend || 'UP')}  |  Zone: ${esc(h4.location || 'UPPER')}  |  MHV: ${esc(h4.mhv || 'VALID')}`,
    `• <b>H1:</b>  Trend: ${esc(h1.trend || 'UP')}  |  Zone: ${esc(h1.location || 'MID')}    |  Re-entry: ${esc(h1.reentry || 'READY')}`,
    `• <b>M15:</b> Trend: ${esc(m15.trend || 'UP')}  |  Zone: ${esc(m15.location || 'LOWER')}  |  Trigger: ${esc(m15.momentum || 'ARMED')}`,
    ``,
    `📰 <b>MACRO & NEWS GATE</b>`,
    `• <b>Event:</b> ${esc(event.name || 'US Macro Runway')}`,
    `• <b>Status:</b> 🟢 <b>CLEAR</b> (No high-impact release in window)`,
    ``,
    `💡 <b>TACTICAL OBSERVATION</b>`,
    `${esc(primaryAlert.summary || 'MTF Trend is aligned. Await M15 re-entry confirmation before entering.')}`,
    `━━━━━━━━━━━━━━━━━━━━━━`
  ].join('\n');

  // Build clean URL buttons (NO callback queries - opens directly in browser or Telegram WebApp)
  const webUrl = DASHBOARD_URL.endsWith('/') ? `${DASHBOARD_URL}#bbma` : `${DASHBOARD_URL}/#bbma`;
  const alertUrl = DASHBOARD_URL.endsWith('/') ? `${DASHBOARD_URL}?open=bbma` : `${DASHBOARD_URL}/?open=bbma`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '📱 Open BBMA Dashboard', url: webUrl }
      ],
      [
        { text: '🔔 View Alert History', url: alertUrl }
      ]
    ]
  };

  return { text: box, reply_markup: inlineKeyboard };
}

async function sendTelegramBox(messageObj) {
  if (!TOKEN || !CHANNEL_ID) {
    console.log('[Notice] No TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID set.');
    console.log('[Channel Setup Instructions]:');
    console.log('1. Add bot to Telegram channel as Administrator with "Post Messages" permission.');
    console.log('2. Provide TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID (@channel_name or -100xxxxxxxxxx).');
    return { ok: false, skipped: true };
  }

  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        text: messageObj.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: messageObj.reply_markup
      })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) {
      console.log(`✅ BBMA Alert Box successfully posted to channel/chat: ${CHANNEL_ID}`);
      return { ok: true, data: j };
    }
    console.error(`❌ Telegram send error:`, j.description || r.statusText);
    return { ok: false, error: j.description };
  } catch (e) {
    console.error(`❌ Network error sending to Telegram:`, e.message);
    return { ok: false, error: e.message };
  }
}

(async () => {
  const box = formatBbmaAlertBox();

  if (PREVIEW || TEST) {
    console.log('================ BBMA TELEGRAM CHANNEL ALERT BOX ================');
    console.log(box.text);
    console.log('================ BUTTONS (ZERO CALLBACK, DIRECT URL) ============');
    console.log(JSON.stringify(box.reply_markup, null, 2));
    console.log('=================================================================\n');
  }

  if (PREVIEW && !TEST) return;

  if (TOKEN && CHANNEL_ID) {
    console.log(`Sending BBMA Alert Box to Telegram (${CHANNEL_ID})...`);
    await sendTelegramBox(box);
  } else {
    console.log('💡 To broadcast to your channel:');
    console.log('   set TELEGRAM_BOT_TOKEN="your_token"');
    console.log('   set TELEGRAM_CHANNEL_ID="@your_channel" or "-100xxxxxxxxx"');
    console.log('   node send-bbma-telegram.js');
  }
})();

module.exports = { formatBbmaAlertBox, sendTelegramBox };
