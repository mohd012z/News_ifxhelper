import assert from 'node:assert/strict';
import {normalize,due,eventKey,format,runReminders} from '../worker/reminder.mjs';
import worker from '../worker/index.mjs';
const now=Date.parse('2026-11-06T12:00:00Z');
const raw={title:'CPI y/y',country:'USD',impact:'High',date:new Date(now+29*60000).toISOString(),forecast:'2.4%',previous:'2.3%'};
assert.equal(due(normalize(raw),now),true);
assert.equal(due(normalize({...raw,date:new Date(now+31*60000).toISOString()}),now),false);
assert.equal(due(normalize({...raw,date:new Date(now+25*60000).toISOString()}),now),false);
assert.equal(normalize({...raw,impact:'Low'}).impact,'Low');
assert.equal(normalize({...raw,impact:'Medium'}).impact,'Medium');
assert.equal(normalize({...raw,impact:'Invalid'}),null);
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
// Concurrent schedules share one atomic D1 claim; no duplicate sends.
const sameTime=Date.parse('2026-11-06T13:00:00Z');
const parallelEvent={...raw,date:new Date(sameTime+29*60000).toISOString()};
let concurrentSends=0;
const concurrentFetch=async url=>url.includes('faireconomy')?{ok:true,json:async()=>[parallelEvent]}:(concurrentSends++,{ok:true,json:async()=>({ok:true,result:{message_id:concurrentSends}})});
const runs=await Promise.all([runReminders(env,{now:sameTime,fetchImpl:concurrentFetch}),runReminders(env,{now:sameTime,fetchImpl:concurrentFetch})]);
assert.equal(runs.reduce((n,r)=>n+r.sent,0),2);
assert.equal(concurrentSends,2);
// A restart must not resend even if a prior claim has expired.
const staleTime=Date.parse('2026-11-06T14:00:00Z');
const staleEvent={...raw,date:new Date(staleTime+29*60000).toISOString()};
const staleKey=eventKey(normalize(staleEvent),'a');
db.set(staleKey,{status:'sending',lease:staleTime-600000,attempts:1});
let restartSends=0;
const restartFetch=async url=>url.includes('faireconomy')?{ok:true,json:async()=>[staleEvent]}:(restartSends++,{ok:true,json:async()=>({ok:true,result:{message_id:9}})});
const afterRestart=await runReminders({...env,TELEGRAM_CHANNEL_ID:null},{now:staleTime,fetchImpl:restartFetch});
assert.equal(afterRestart.sent,0);
assert.equal(restartSends,0);
const ctx={waitUntil(p){this.task=p;}};
await worker.scheduled({scheduledTime:now},{ENABLE_T30_REMINDERS:'false'},ctx);
assert.equal(ctx.task,undefined);
console.log('PASS T-30 mocked timing, concurrent claims, restart dedupe and disabled scheduler');


const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async url => {
    if (String(url).includes('nfs.faireconomy.media')) {
      return {ok:true,json:async()=>({error:'upstream schema changed'})};
    }
    throw Error('unexpected network call');
  };
  const malformed = await worker.fetch(new Request('https://example.test/api/ff-calendar'));
  assert.equal(malformed.status,502);
  assert.match((await malformed.json()).error,/invalid event collection/);
  globalThis.fetch = async url => {
    if (String(url).includes('nfs.faireconomy.media')) return {ok:true,json:async()=>{throw SyntaxError('bad json')}};
    throw Error('unexpected network call');
  };
  const invalidJson = await worker.fetch(new Request('https://example.test/api/ff-calendar'));
  assert.equal(invalidJson.status,502);
  assert.match((await invalidJson.json()).error,/invalid JSON/);
} finally {
  globalThis.fetch = originalFetch;
}
