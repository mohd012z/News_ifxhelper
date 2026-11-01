import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCalendar,parseCalendarAction,isCalendarAction} from '../telegram/calendar-filters.mjs';
import {renderAction,handleWebhook} from '../telegram/menu-bot.mjs';
const now=Date.parse('2026-11-01T15:00:00+08:00');
const events=[
 ...Array.from({length:12},(_,i)=>({date:new Date(now+(i+1)*600000).toISOString(),country:'USD',title:'USD event '+i,impact:'High'})),
 ...Array.from({length:5},(_,i)=>({date:new Date(now+(i+1)*1200000).toISOString(),country:'EUR',title:'EUR event '+i,impact:'Medium'})),
 {date:'2026-11-01T17:00:00Z',country:'JPY',title:'Tomorrow <release> & test',impact:'Low'},
 {date:'not a date',country:'USD',title:'Invalid',impact:'High'}
];events.push({...events[0]});
const source=async()=>new Response(JSON.stringify(events));
const keys=view=>view.reply_markup.inline_keyboard.flat().map(x=>x.callback_data).filter(Boolean);
test('geographic and impact buttons remain below Telegram callback byte limit',async()=>{
 const p=await renderCalendar('calendar',{now,fetcher:source});
 for(const country of ['USD','EUR','GBP','JPY','AUD','CAD','NZD','CHF'])assert(keys(p).some(k=>k.startsWith('ifx:v1:cal2:'+country+':')));
 for(const key of keys(p))assert(Buffer.byteLength(key,'utf8')<=64);
});
test('country filter persists across paginated calendar',async()=>{
 const p=await renderAction('cal2:USD:A:W:0',{now,fetcher:source});
 assert.match(p.text,/12 unique matching events/);assert.doesNotMatch(p.text,/EUR event/);
 assert(keys(p).includes('ifx:v1:cal2:USD:A:W:1'));
 const q=await renderAction('cal2:USD:A:W:1',{now,fetcher:source});
 assert.match(q.text,/Page 2\/2/);assert(keys(q).includes('ifx:v1:cal2:USD:A:W:0'));
});
test('medium impact filter matches only EUR fixtures',async()=>{
 const p=await renderCalendar('cal2:EUR:M:W:0',{now,fetcher:source});
 assert.match(p.text,/5 unique matching events/);assert.doesNotMatch(p.text,/USD event/);
});
test('today tomorrow use Malaysia day boundaries',async()=>{
 const a=await renderCalendar('cal2:ALL:A:T:0',{now,fetcher:source});
 assert.match(a.text,/17 unique matching events/);assert.doesNotMatch(a.text,/Tomorrow &lt;release&gt;/);
 const b=await renderCalendar('cal2:ALL:A:N:0',{now,fetcher:source});
 assert.match(b.text,/Tomorrow &lt;release&gt; &amp; test/);assert.match(b.text,/1 unique matching events/);
});
test('invalid country, impact, period, page or HTML cannot enter routing',()=>{
 for(const s of ['cal2:BTC:A:W:0','cal2:USD:X:W:0','cal2:USD:H:X:0','cal2:USD:H:W:32','cal2:USD:H:W:0<script>','cal2:USD:H:W:100']){
  assert.equal(parseCalendarAction(s),null);assert.equal(isCalendarAction(s),false);
 }
});
test('upstream error remains explicit and fail closed',async()=>{
 const p=await renderCalendar('cal2:USD:H:T:0',{now,fetcher:async()=>new Response('blocked',{status:403})});
 assert.match(p.text,/unavailable/);assert.doesNotMatch(p.text,/USD event/);
});
test('Telegram callback acknowledges before edit of filtered calendar',async()=>{
 const calls=[];
 const futureEvents=Array.from({length:5},(_,i)=>({date:new Date(Date.now()+(i+1)*600000).toISOString(),country:'EUR',title:'Relative event '+i,impact:'Medium'}));
 const f=async(url,opts={})=>{calls.push({url:String(url),opts});return String(url).includes('api.telegram.org')?new Response(JSON.stringify({ok:true,result:true})):new Response(JSON.stringify(futureEvents));};
 const r=new Request('https://unit.test/api/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'secret'},body:JSON.stringify({update_id:777,callback_query:{id:'q777',data:'ifx:v1:cal2:EUR:M:W:0',message:{chat:{id:123},message_id:8}}})});
 const res=await handleWebhook(r,{TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_WEBHOOK_SECRET:'secret',TELEGRAM_ALLOWED_CHAT_IDS:'123'},f);
 assert.equal(res.status,200);const tg=calls.filter(x=>x.url.includes('api.telegram.org'));
 assert.match(tg[0].url,/answerCallbackQuery$/);assert.match(tg[1].url,/editMessageText$/);
 assert.match(JSON.parse(tg[1].opts.body).text,/5 unique matching events/);
});
test('research menu does not claim actionable buy/sell order',async()=>{
 const v=await renderAction('menu');assert.doesNotMatch(v.text,/BUY NOW|SELL NOW/);
});
