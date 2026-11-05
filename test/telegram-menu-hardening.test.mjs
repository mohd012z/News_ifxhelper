import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {parseCalendarAction,renderCalendar} from '../telegram/calendar-filters.mjs';
import {candleEvidence,renderAction} from '../telegram/menu-bot.mjs';
const now=Date.parse('2026-11-01T08:00:00Z');
const data=[
 {date:'2026-11-01T08:10:00Z',country:'USD',impact:'Low',title:'Low <impact> & fixture'},
 {date:'2026-11-01T08:20:00Z',country:'EUR',impact:'Medium',title:'Medium fixture'},
 {date:'2026-11-01T08:30:00Z',country:'USD',impact:'High',title:'High fixture'},
 {date:'2026-11-01T08:10:00Z',country:'USD',impact:'Low',title:'Low <impact> & fixture'}
];
const fetcher=async()=>new Response(JSON.stringify(data));
const buttons=p=>p.reply_markup.inline_keyboard.flat().map(x=>x.callback_data).filter(Boolean);
test('calendar accepts Low-impact callback, rejects invalid impact',()=>{
 assert.deepEqual(parseCalendarAction('cal2:USD:L:W:0'),{country:'USD',impact:'L',period:'W',page:0,legacy:false});
 assert.equal(parseCalendarAction('cal2:USD:Z:W:0'),null);
});
test('Low impact filter deduplicates and escapes headline HTML',async()=>{
 const p=await renderCalendar('cal2:ALL:L:W:0',{now,fetcher});
 assert.match(p.text,/1 unique matching events/);
 assert.match(p.text,/Low &lt;impact&gt; &amp; fixture/);
 assert.doesNotMatch(p.text,/Medium fixture|High fixture/);
 assert(buttons(p).includes('ifx:v1:cal2:ALL:L:W:0'));
});
test('country selection retains Low impact filter',async()=>{
 const p=await renderCalendar('cal2:USD:L:W:0',{now,fetcher});
 assert.match(p.text,/1 unique matching events/);
 assert(buttons(p).includes('ifx:v1:cal2:EUR:L:W:0'));
});
test('legacy calendar callbacks still accepted',async()=>{
 const p=await renderCalendar('calendar_high',{now,fetcher});
 assert.match(p.text,/High impact/);
 assert.equal(parseCalendarAction('calendar:p:1').page,1);
});
test('BBMA candle evidence enforces future and stale checks',()=>{
 assert.equal(candleEvidence('M15','not a time',now),'CANDLE_TIME_UNKNOWN');
 assert.equal(candleEvidence('M15',new Date(now+90000).toISOString(),now),'CANDLE_TIME_INVALID_FUTURE');
 assert.equal(candleEvidence('M15',new Date(now-60000).toISOString(),now),'RECENT_STORED_CANDLE');
 assert.equal(candleEvidence('M15',new Date(now-86400000).toISOString(),now),'STALE_STORED_CANDLE');
 assert.equal(candleEvidence('W1',new Date(now-8*86400000).toISOString(),now),'RECENT_STORED_CANDLE');
});
test('Gold proxy and candle provenance displayed as historical',async()=>{
 const payload={symbol:'GC=F',provider:'YAHOO_CHART',sourceGeneratedAt:new Date(now-86400000).toISOString(),analysis:{H1:{bbma:{trend:'DOWN',reentry:'NONE',lastTime:new Date(now-86400000).toISOString()}}}};
 const f=async()=>new Response(JSON.stringify(payload));
 const res=await renderAction('tf:H1',{fetcher:f,now});
 assert.match(res.text,/Candle evidence: STALE_STORED_CANDLE/);
 assert.match(res.text,/Gold futures proxy; not XAUUSD spot/);
 assert.doesNotMatch(res.text,/LIVE STREAMING|BUY NOW|SELL NOW/);
});
test('BBMA preview never broadcasts with missing credentials',()=>{
 const env={...process.env};delete env.TELEGRAM_BOT_TOKEN;delete env.TELEGRAM_CHANNEL_ID;delete env.TELEGRAM_CHAT_ID;
 const res=spawnSync(process.execPath,['send-bbma-telegram.js','--preview'],{env,encoding:'utf8',timeout:5000});
 assert.equal(res.status,0,res.stderr);
 assert.match(res.stdout,/BUTTONS/);
 assert.doesNotMatch(res.stdout,/Sending BBMA Alert Box to Telegram/);
});
