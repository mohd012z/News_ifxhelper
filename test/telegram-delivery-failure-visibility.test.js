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
