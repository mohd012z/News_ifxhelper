import test from 'node:test';
import assert from 'node:assert/strict';
import {withTelegramReceipt} from '../telegram/update-receipts.mjs';
import {renderAction,handleWebhook} from '../telegram/menu-bot.mjs';
function fakeD1(){
 const rows=new Map();
 return {rows,db:{prepare(s){return {bind(...p){return {
  async first(){return rows.has(p[0])?{...rows.get(p[0])}:null;},
  async run(){
   let changes=0;
   if(s.startsWith('INSERT OR IGNORE')){if(!rows.has(p[0])){rows.set(p[0],{state:'processing',lease_until_ms:p[1],epoch:1,attempts:1});changes=1;}}
   else if(s.includes('epoch=epoch+1')){const r=rows.get(p[2]);if(r&&r.state==='processing'&&r.epoch===p[3]&&r.lease_until_ms<=p[4]){r.epoch++;r.attempts++;r.lease_until_ms=p[0];changes=1;}}
   else if(s.includes("SET state='done'")){const r=rows.get(p[1]);if(r&&r.state==='processing'&&r.epoch===p[2]){r.state='done';r.lease_until_ms=0;changes=1;}}
   else if(s.includes('SET lease_until_ms=0')){const r=rows.get(p[1]);if(r&&r.state==='processing'&&r.epoch===p[2]){r.lease_until_ms=0;changes=1;}}
   else throw Error('unexpected SQL');
   return {meta:{changes}};
  }
 };}};}}};
}
test('done receipt suppresses repeats',async()=>{
 const {db}=fakeD1();let calls=0;const send=async()=>{calls++;return new Response('OK')};
 assert.equal((await withTelegramReceipt(db,12,send,{now:()=>100000})).status,'done');
 assert.equal((await withTelegramReceipt(db,12,send,{now:()=>100001})).status,'duplicate');assert.equal(calls,1);
});
test('rejected reply releases receipt for retry',async()=>{
 const {db}=fakeD1();
 assert.equal((await withTelegramReceipt(db,11,async()=>new Response('failed',{status:503}),{now:()=>100000})).status,'retry');
 assert.equal((await withTelegramReceipt(db,11,async()=>new Response('OK'),{now:()=>100001})).status,'done');
});
test('fenced old lease cannot finalize after new owner',async()=>{
 const {db}=fakeD1();let release;
 const first=withTelegramReceipt(db,22,async()=>{await new Promise(r=>release=r);return new Response('OK')},{now:()=>100000,leaseMs:30000});
 while(!release)await new Promise(r=>setImmediate(r));
 assert.equal((await withTelegramReceipt(db,22,async()=>new Response('OK'),{now:()=>140000,leaseMs:30000})).status,'done');
 release();await assert.rejects(first,/fencing changed/);
});
test('BBMA response shows all nine timeframe buttons',async()=>{
 const fetcher=async()=>new Response(JSON.stringify({generatedAt:'2026-10-30',dashboard:{rows:[]},analysis:{}}));
 const view=await renderAction('bbma',{fetcher});
 const buttons=view.reply_markup.inline_keyboard.flat().map(v=>v.callback_data);
 for(const tf of ['M1','M5','M15','M30','H1','H4','D1','W1','MN1'])assert(buttons.includes('ifx:v1:tf:'+tf));
});
test('required inbox without binding refuses webhook',async()=>{
 const request=new Request('https://unit.invalid/api/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'secret'},body:JSON.stringify({update_id:5,message:{chat:{id:123},text:'/start'}})});
 const r=await handleWebhook(request,{TELEGRAM_BOT_TOKEN:'stub',TELEGRAM_WEBHOOK_SECRET:'secret',TELEGRAM_ALLOWED_CHAT_IDS:'123',TELEGRAM_REQUIRE_INBOX:'true'});
 assert.equal(r.status,503);
});
