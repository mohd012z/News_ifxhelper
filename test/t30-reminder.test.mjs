import assert from 'node:assert/strict';
import {normalize,due,eventKey,format,runReminders} from '../worker/reminder.mjs';
const now=Date.parse('2026-11-06T12:00:00Z');
const raw={title:'CPI y/y',country:'USD',impact:'High',date:new Date(now+29*60000).toISOString(),forecast:'2.4%',previous:'2.3%'};
assert.equal(due(normalize(raw),now),true);
assert.equal(due(normalize({...raw,date:new Date(now+31*60000).toISOString()}),now),false);
assert.equal(due(normalize({...raw,date:new Date(now+25*60000).toISOString()}),now),false);
assert.equal(normalize({...raw,impact:'Low'}),null);
assert.equal(normalize({...raw,date:'2026-11-06 12:29'}),null);
assert.notEqual(eventKey(normalize(raw),'a'),eventKey(normalize(raw),'b'));
assert.match(format(normalize({...raw,title:'<CPI>'})),/&lt;CPI&gt;/);
const db=new Map();
const mockDb={prepare(sql){let args=[];return {bind(...v){args=v;return this;},async run(){
 if(sql.startsWith('INSERT')){if(db.has(args[0]))return {meta:{changes:0}};db.set(args[0],{status:'sending',lease:args[1],attempts:1});return {meta:{changes:1}};}
 if(sql.includes('attempts=attempts+1')){const d=db.get(args[1]);if(d.status==='sent'||d.lease>=args[2]||d.attempts>=4)return {meta:{changes:0}};d.status='sending';d.lease=args[0];d.attempts++;return {meta:{changes:1}};}
 const d=db.get(args[1]);d.status=sql.includes("status='sent'")?'sent':'uncertain';return {meta:{changes:1}};
}};}};
let messages=0;
const mockFetch=async url=>{if(url.includes('faireconomy'))return {ok:true,json:async()=>[raw]};messages++;return {ok:true,json:async()=>({ok:true,result:{message_id:messages}})};};
const env={REMINDER_DB:mockDb,TELEGRAM_BOT_TOKEN:'fake:token',TELEGRAM_CHAT_ID:'a',TELEGRAM_CHANNEL_ID:'b'};
assert.deepEqual(await runReminders(env,{now,fetchImpl:mockFetch}),{sent:2,skipped:0,failed:0});
assert.deepEqual(await runReminders(env,{now,fetchImpl:mockFetch}),{sent:0,skipped:2,failed:0});
assert.equal(messages,2);
await assert.rejects(runReminders({...env,REMINDER_DB:null},{now,fetchImpl:mockFetch}),/Missing/);
console.log('PASS T-30 mock delivery and dedupe');
