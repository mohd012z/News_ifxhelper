'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sender=fs.readFileSync(path.join(__dirname,'..','send-bbma-telegram.js'),'utf8');
const workflow=fs.readFileSync(path.join(__dirname,'..','.github','workflows','daily-refresh.yml'),'utf8');
assert(sender.includes('const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || null;'));
assert(!sender.includes('process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHAT_ID'));
assert(workflow.includes('TELEGRAM_CHANNEL_ID: ${{ secrets.TELEGRAM_CHANNEL_ID }}'));
assert(!workflow.includes('secrets.TELEGRAM_CHANNEL_ID || secrets.TELEGRAM_CHAT_ID'));
assert(sender.includes('if (require.main === module) {'), 'import must not trigger a real send');
assert(sender.includes('AbortController'), 'BBMA send must have bounded network wait');

const savedToken = process.env.TELEGRAM_BOT_TOKEN;
const savedChannel = process.env.TELEGRAM_CHANNEL_ID;
const savedFetch = global.fetch;
process.env.TELEGRAM_BOT_TOKEN = '123:mock-only';
process.env.TELEGRAM_CHANNEL_ID = '@ifxhelper2';
const {sendTelegramBox} = require('../send-bbma-telegram.js');
async function mockSend(response, {throwNetwork=false, httpOk=true}={}) {
  global.fetch = async (url, opts) => {
    assert(url.endsWith('/sendMessage'));
    assert.equal(opts.method, 'POST');
    assert(opts.signal, 'request must have an abort signal');
    assert.equal(JSON.parse(opts.body).chat_id, '@ifxhelper2');
    if (throwNetwork) throw Error('simulated offline');
    return {ok:httpOk,status:httpOk?200:503,json:async()=>response};
  };
  return sendTelegramBox({text:'local mock only',reply_markup:{inline_keyboard:[]}});
}
(async () => {
  try {
    const confirmed = await mockSend({ok:true,result:{message_id:17,chat:{username:'ifxhelper2'}}});
    assert.equal(confirmed.ok, true, 'matching Telegram receipt should be accepted');
    assert.equal((await mockSend({ok:true,result:{message_id:17,chat:{username:'wrong'}}})).ok, false, 'wrong destination must fail');
    assert.equal((await mockSend({ok:true,result:{chat:{username:'ifxhelper2'}}})).ok, false, 'missing message ID must fail');
    assert.equal((await mockSend({ok:true,result:{message_id:-1,chat:{username:'ifxhelper2'}}})).ok, false, 'invalid message ID must fail');
    assert.equal((await mockSend({ok:true,result:{message_id:17,chat:{username:'ifxhelper2'}}},{httpOk:false})).ok, false, 'HTTP failure must fail');
    assert.equal((await mockSend({}, {throwNetwork:true})).ok, false, 'network failure must fail');
    console.log('Telegram channel routing and six mocked receipt cases passed');
  } finally {
    global.fetch = savedFetch;
    if (savedToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = savedToken;
    if (savedChannel === undefined) delete process.env.TELEGRAM_CHANNEL_ID;
    else process.env.TELEGRAM_CHANNEL_ID = savedChannel;
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
