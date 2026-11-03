'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const daily=fs.readFileSync(path.join(root,'.github/workflows/daily-refresh.yml'),'utf8');
const frequent=fs.readFileSync(path.join(root,'.github/workflows/news-watch.yml'),'utf8');
const notifier=fs.readFileSync(path.join(root,'telegram-notify.js'),'utf8');
const bbma=fs.readFileSync(path.join(root,'send-bbma-telegram.js'),'utf8');
for(const [name,wf] of [['daily',daily],['frequent',frequent]]){
 for(const step of ['Send Telegram alerts for anything new','Send BBMA Alert to Channel']){
  const section=wf.split('      - name: '+step+'\n')[1]?.split('      - name: ')[0]||'';
  assert(section.includes('run: node '),name+' missing '+step);
  assert(!section.includes('continue-on-error: true'),name+' masks Telegram failure');
 }
 assert(wf.includes('if: always()'),name+' must persist notification state after failure');
}
assert(notifier.includes('process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID'),'channel must take priority over private chat');
assert(!notifier.includes('DESTINATION_CONFLICT'),'legitimate separate chat and channel must not be rejected');
assert(notifier.includes('AbortController'),'Telegram network timeout must be bounded');
assert(notifier.includes('message_id'),'Telegram receipt not validated');
assert(notifier.includes('even with zero news candidates'),'empty news queue must not hide missing credentials');
assert(bbma.includes('process.exitCode = 1'),'BBMA sender missing exit failure');
console.log('Telegram delivery failure-visibility contract passed');


// Fully mocked Telegram HTTP responses: no live requests, no real credentials.
(async function regressionAmbiguousDelivery() {
  const oldFetch = global.fetch, oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID, oldChannel = process.env.TELEGRAM_CHANNEL_ID;
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'mock-token-not-a-secret';
    process.env.TELEGRAM_CHAT_ID = '12345';
    delete process.env.TELEGRAM_CHANNEL_ID;
    delete require.cache[require.resolve('../telegram-notify.js')];
    const { sendTelegram, sendTelegramCard, shouldAttemptDelivery } = require('../telegram-notify.js');
    const valid = { ok: true, result: { message_id: 71, chat: { id: 12345 } } };
    const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    let calls = [];
    global.fetch = async url => { calls.push(url); throw Error('simulated dropped connection'); };
    assert.equal((await sendTelegramCard('caption', 'https://chart.invalid/a')).uncertain, true);
    assert.equal(calls.length, 1, 'ambiguous photo must not fall back to text');
    calls = [];
    assert.equal((await sendTelegram('caption')).uncertain, true);
    assert.equal(calls.length, 1, 'ambiguous text send must be reported');
    calls = [];
    global.fetch = async url => { calls.push(url); return response(200, { ok: true }); };
    assert.equal((await sendTelegramCard('caption', 'https://chart.invalid/a')).uncertain, true);
    assert.equal(calls.length, 1, 'missing receipt must not fall back');
    calls = [];
    global.fetch = async url => { calls.push(url); return response(200, { ok: true, result: { message_id: 77, chat: { id: 987 } } }); };
    assert.equal((await sendTelegramCard('caption', 'https://chart.invalid/a')).uncertain, true);
    assert.equal(calls.length, 1, 'wrong destination must not fall back');
    calls = [];
    global.fetch = async url => { calls.push(url); return response(429, { ok: false, error_code: 429 }); };
    assert.equal((await sendTelegramCard('caption', 'https://chart.invalid/a')).rateLimited, true);
    assert.equal(calls.length, 1, '429 must not fall back');
    calls = [];
    global.fetch = async url => { calls.push(url); return response(503, { ok: false }); };
    assert.equal((await sendTelegramCard('caption', 'https://chart.invalid/a')).uncertain, true);
    assert.equal(calls.length, 1, '5xx must not fall back');
    calls = [];
    global.fetch = async url => { calls.push(url); return calls.length === 1 ? response(400, { ok: false, description: 'Bad photo' }) : response(200, valid); };
    assert.equal((await sendTelegramCard('caption', 'https://chart.invalid/a')).ok, true);
    assert.equal(calls.length, 2, 'explicit photo rejection may fall back');
    calls = [];
    global.fetch = async url => { calls.push(url); return response(200, valid); };
    assert.equal((await sendTelegramCard('caption', 'https://chart.invalid/a')).ok, true);
    assert.equal(calls.length, 1, 'confirmed photo must not fall back');
    assert.equal(shouldAttemptDelivery('alert:1', new Set(), new Set(['alert:1'])), false);
    assert.equal(shouldAttemptDelivery('alert:1', new Set(), new Set()), true);
    assert(notifier.includes('state.uncertainKeys = Array.from(uncertain)'), 'unknown outcomes must persist');
    console.log('Telegram ambiguous-delivery regression passed');
  } finally {
    global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID; else process.env.TELEGRAM_CHAT_ID = oldChat;
    if (oldChannel === undefined) delete process.env.TELEGRAM_CHANNEL_ID; else process.env.TELEGRAM_CHANNEL_ID = oldChannel;
    delete require.cache[require.resolve('../telegram-notify.js')];
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
