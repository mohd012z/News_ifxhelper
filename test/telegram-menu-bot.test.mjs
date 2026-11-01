import test from 'node:test';
import assert from 'node:assert/strict';
import {handleWebhook,renderAction,COMMANDS,WEB_ROOT} from '../telegram/menu-bot.mjs';
const headers={'x-telegram-bot-api-secret-token':'samplesecret'};
const config={TELEGRAM_BOT_TOKEN:'fake-token',TELEGRAM_WEBHOOK_SECRET:'samplesecret',TELEGRAM_ALLOWED_CHAT_IDS:'123,-100456'};
const clock=Date.parse('2026-11-01T09:00:00Z');
const sources={
 'data-manifest.json':{generatedAt:'2026-11-01T08:59:00Z'},
 'data/bbma-watch.json':{sourceGeneratedAt:'2026-10-30T20:00:00Z',symbol:'GC=F',provider:'YAHOO_CHART',analysis:{H1:{bbma:{trend:'UP',reentry:'NONE',lastTime:'2026-10-30T20:00:00Z'}}},dashboard:{rows:[{tf:'H1',trend:'UP',pattern:'NONE'}]}},
 'data/agent-health.json':{generatedAt:'2026-10-30T00:00:00Z'}
};
const calendar=[{date:'2026-11-02T13:30:00Z',country:'USD',title:'Test <Untrusted> & event',impact:'High'},
{date:'2026-11-02T14:30:00Z',country:'JPY',title:'Other',impact:'Low'}];
function mock(){const calls=[];const fetcher=async(url,options={})=>{
 calls.push({url:String(url),options});
 if(String(url).startsWith('https://api.telegram.org/')) return new Response(JSON.stringify({ok:true,result:true}),{status:200,headers:{'content-type':'application/json'}});
 if(url.includes('ff_calendar_thisweek'))return new Response(JSON.stringify(calendar));
 const found=Object.entries(sources).find(([key])=>String(url).endsWith('/'+key));
 return new Response(JSON.stringify(found?.[1]),{status:found?200:404});
};return {calls,fetcher};}
function req(payload,extra={}){return new Request('https://unit.example/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json',...headers,...extra},body:JSON.stringify(payload)});}
function update(text='/start'){return {update_id:1,message:{chat:{id:123},text}};}
function cb(action='menu',chat=123){return {update_id:2,callback_query:{id:'callback01',data:'ifx:v1:'+action,message:{chat:{id:chat},message_id:55}}};}
test('menu action renders every actionable callback and dashboard URL',async()=>{
 const p=await renderAction('menu',{now:clock});
 assert.match(p.text,/Main menu/);
 const actions=p.reply_markup.inline_keyboard.flat().filter(x=>x.callback_data).map(x=>x.callback_data);
 assert.deepEqual(actions,['ifx:v1:news','ifx:v1:calendar','ifx:v1:bbma','ifx:v1:alerts','ifx:v1:health','ifx:v1:help']);
 assert(p.reply_markup.inline_keyboard.flat().some(x=>x.url===WEB_ROOT));
 for(const a of actions){const m=mock();const view=await renderAction(a.slice(7),{fetcher:m.fetcher,now:clock});assert.match(view.text,/<b>/);}
});
test('commands map to supported menu actions',()=>{assert.equal(COMMANDS.length,8);assert(COMMANDS.some(c=>c.command==='start'));});
test('rejects invalid secret, missing configuration and unauthorized chats',async()=>{
 const m=mock();assert.equal((await handleWebhook(req(update(),{'x-telegram-bot-api-secret-token':'wrong'}),config,m.fetcher)).status,403);
 assert.equal((await handleWebhook(req(update()),{},m.fetcher)).status,503);
 assert.equal((await handleWebhook(req({update_id:3,message:{chat:{id:999},text:'/start'}}),config,m.fetcher)).status,200);
 assert.equal(m.calls.length,0);
});
test('telegram /start sends working menu',async()=>{const m=mock();assert.equal((await handleWebhook(req(update()),config,m.fetcher)).status,200);const c=m.calls.filter(c=>c.url.includes('api.telegram.org'));assert.equal(c.length,1);assert.match(c[0].url,/sendMessage$/);const payload=JSON.parse(c[0].options.body);assert.equal(payload.chat_id,123);assert.equal(payload.reply_markup.inline_keyboard.length,4);});
test('callback acknowledges before editing and honors selected action',async()=>{const m=mock();assert.equal((await handleWebhook(req(cb('bbma')),config,m.fetcher)).status,200);const telegram=m.calls.filter(c=>c.url.includes('api.telegram.org'));assert.match(telegram[0].url,/answerCallbackQuery$/);assert.match(telegram[1].url,/editMessageText$/);assert.match(JSON.parse(telegram[1].options.body).text,/research snapshot/);});
test('all callbacks, including timeframe and high impact, resolve with a response',async()=>{
 for(const action of ['menu','news','calendar','calendar_high','bbma','tf:M15','tf:H1','tf:H4','tf:D1','alerts','health','help','invalid']){
  const m=mock();const result=await handleWebhook(req(cb(action)),config,m.fetcher);assert.equal(result.status,200,action);
  assert(m.calls.some(x=>x.url.endsWith('/editMessageText')),action);
 }
});
test('BBMA snapshots never claim stale stored observations live',async()=>{const m=mock();const r=await renderAction('bbma',{fetcher:m.fetcher,now:clock});assert.match(r.text,/STALE SNAPSHOT/);assert.doesNotMatch(r.text,/LIVE STREAMING|BUY NOW|SELL NOW/);});
test('calendar escapes untrusted event titles, includes MYT and filters impact',async()=>{const m=mock();const r=await renderAction('calendar_high',{fetcher:m.fetcher,now:Date.parse('2026-11-01T10:00:00Z')});assert.match(r.text,/&lt;Untrusted&gt; &amp; event/);assert.doesNotMatch(r.text,/Other/);assert.match(r.text,/MYT/);});
test('missing provider data returns explicit unknown, no invented signal',async()=>{const m={fetcher:async()=>new Response('Service unavailable',{status:503})};for(const a of ['news','calendar','bbma','health']){let p=await renderAction(a,m);assert.match(p.text,/unavailable|No validated/i);}});
test('forged command and oversized request blocked',async()=>{const m=mock();assert.equal((await handleWebhook(req({update_id:2,message:{chat:{id:123},text:'/<script>'}}),config,m.fetcher)).status,200);assert.equal((await handleWebhook(req(update(),{'content-length':'40000'}),config,m.fetcher)).status,413);});
test('Telegram 5xx produces retryable failure instead of a false success',async()=>{const m=mock();let n=0;const fetcher=async(url,o)=>String(url).includes('/sendMessage')?(n++,new Response('{}',{status:503})):m.fetcher(url,o);let x=await handleWebhook(req(update()),config,fetcher);assert.equal(x.status,503);assert.equal(n,1);});
test('edit "message is not modified" is safe; other nonretry 400 can send new response',async()=>{
 const m=mock();let first=true;const fetcher=async(url,o)=>{
  if(String(url).endsWith('/editMessageText')&&first){first=false;return new Response(JSON.stringify({ok:false,description:'Bad Request: message is not modified'}),{status:400});}
  return m.fetcher(url,o);
 };
 assert.equal((await handleWebhook(req(cb('menu')),config,fetcher)).status,200);
 assert(!m.calls.some(x=>x.url.endsWith('/sendMessage')));
});
test('Alert History button opens the actual history view', async()=>{
 const p=await renderAction('alerts');
 assert(p.reply_markup.inline_keyboard.flat().some(b=>b.url?.includes('open=bbma&view=history')));
});
