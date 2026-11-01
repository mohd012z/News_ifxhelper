import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAction,handleWebhook} from '../telegram/menu-bot.mjs';
const NOW=Date.parse('2026-11-01T08:00:00Z');
const events=Array.from({length:23},(_,i)=>({date:new Date(NOW+(i+1)*1800000).toISOString(),country:i%2?'EUR':'USD',title:'Event '+i+(i===0?'<untrusted>&':''),impact:i%3===0?'High':'Low'}));
events.push({...events[0]},{date:'not-a-date',title:'Invalid',impact:'High'});
const fetcher=async()=>new Response(JSON.stringify(events));
const keys=p=>p.reply_markup.inline_keyboard.flat().map(k=>k.callback_data).filter(Boolean);
test('calendar deduplicates, escapes HTML and offers next page',async()=>{
 const p=await renderAction('calendar',{now:NOW,fetcher});
 assert.match(p.text,/Page 1\/3 · 23 unique matching events/);
 assert.match(p.text,/&lt;untrusted&gt;&amp;/);
 assert(keys(p).includes('ifx:v1:calendar:p:1'));
});
test('calendar page 2 supports previous and next',async()=>{
 const p=await renderAction('calendar:p:1',{now:NOW,fetcher});
 assert.match(p.text,/Page 2\/3/);
 assert(keys(p).includes('ifx:v1:calendar:p:0'));
 assert(keys(p).includes('ifx:v1:calendar:p:2'));
});
test('bounded calendar pages clamp and cannot exceed available pages',async()=>{
 const p=await renderAction('calendar:p:31',{now:NOW,fetcher});
 assert.match(p.text,/Page 3\/3/);
 assert(!keys(p).includes('ifx:v1:calendar:p:3'));
});
test('high impact filter does not show low impact events',async()=>{
 const p=await renderAction('calendar_high',{now:NOW,fetcher});
 assert.match(p.text,/8 unique matching events/);
 assert.doesNotMatch(p.text,/\(Low impact\)/);
});
test('calendar callback is acknowledged and yields editable pagination message',async()=>{
 const calls=[];
 const stub=async(url,opts={})=>{calls.push({url:String(url),opts});return String(url).startsWith('https://api.telegram.org/')?new Response(JSON.stringify({ok:true,result:true})):fetcher();};
 const update={update_id:17,callback_query:{id:'callback17',data:'ifx:v1:calendar:p:2',message:{chat:{id:123},message_id:45}}};
 const request=new Request('https://example.invalid/api/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'secret'},body:JSON.stringify(update)});
 const resp=await handleWebhook(request,{TELEGRAM_BOT_TOKEN:'test',TELEGRAM_WEBHOOK_SECRET:'secret',TELEGRAM_ALLOWED_CHAT_IDS:'123'},stub);
 assert.equal(resp.status,200);
 assert.match(calls[0].url,/answerCallbackQuery$/);
 assert.match(JSON.parse(calls.find(c=>c.url.endsWith('/editMessageText')).opts.body).text,/Page 3\/3/);
});
test('news reads historical research, escaping untrusted titles and exposing stale age',async()=>{
 const item={sourceGeneratedAt:'2026-10-30T00:00:00Z',news:{event:{title:'Test <untrusted> & speech',currency:'USD',impact:'LOW',time:'2026-10-30T02:00:00Z'}}};
 const f=async u=>new Response(JSON.stringify(String(u).includes('intelligence-360')?item:{generatedAt:'2026-11-01T07:59:00Z'}));
 const p=await renderAction('news',{fetcher:f,now:NOW});
 assert.match(p.text,/&lt;untrusted&gt; &amp;/);
 assert.match(p.text,/STALE SNAPSHOT/);
 assert.match(p.text,/historical research context/);
});
test('health shows stored agent state, without inventing live-delivery status',async()=>{
 const f=async()=>new Response(JSON.stringify({generatedAt:'2026-10-30T00:00:00Z',agents:{market:{state:'STALE'},intelligence:{status:'ACCEPTED'}}}));
 const p=await renderAction('health',{fetcher:f,now:NOW});
 assert.match(p.text,/market: STALE/);
 assert.match(p.text,/intelligence: ACCEPTED/);
 assert.match(p.text,/delivery.*unverified/);
});
