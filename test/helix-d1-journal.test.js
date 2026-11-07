'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {journal,retryDelay}=require('../lib/helix-d1-journal');
const now=Date.parse('2026-11-07T00:00:00Z');
const id='a'.repeat(64),token='lease_token_000001';
function fakeDb(){
 const state={record:null,attempts:new Map()};
 const db={prepare(sql){return {bind(...v){return {
  async first(){return state.record&&state.record.report_hash===v[0]?{...state.record}:null;},
  async run(){
   let changes=0,r=state.record;
   if(sql.startsWith('INSERT OR IGNORE')){if(!r){state.record={report_hash:v[0],destination:v[1],payload:v[2],state:'AWAITING_APPROVAL',created_at:v[3],updated_at:v[4],attempts:0};changes=1;}}
   else if(sql.includes("state='APPROVED'")){if(r&&r.report_hash===v[4]&&r.state==='AWAITING_APPROVAL'){Object.assign(r,{state:'APPROVED',approved_by:v[0],approved_at:v[1],approval_expires_at:v[2]});changes=1;}}
   else if(sql.includes("state='LEASED'")){if(r&&r.report_hash===v[3]&&['APPROVED','RETRY_WAIT'].includes(r.state)&&r.approval_expires_at>v[5]&&(r.next_retry_at==null||r.next_retry_at<=v[6])&&!state.attempts.has(v[7])){Object.assign(r,{state:'LEASED',lease_token:v[0],lease_expires_at:v[1],attempts:r.attempts+1});changes=1;}}
   else if(sql.startsWith('INSERT INTO helix_delivery_attempts')){if(state.attempts.has(v[0]))throw new Error('duplicate attempt');state.attempts.set(v[0],{outcome:'STARTED'});changes=1;}
   else if(sql.startsWith('UPDATE helix_research_delivery SET state=?')){if(r&&r.report_hash===v[5]&&r.state==='LEASED'&&r.lease_token===v[6]){Object.assign(r,{state:v[0],next_retry_at:v[1],telegram_message_id:v[2],last_error_code:v[3],lease_token:null,lease_expires_at:null});changes=1;}}
   else if(sql.startsWith('UPDATE helix_delivery_attempts')){const a=state.attempts.get(v[4]);if(a&&a.outcome==='STARTED'){a.outcome=v[1];changes=1;}}
   else if(sql.includes("state='UNCERTAIN'")){if(r&&r.state==='LEASED'&&r.lease_expires_at<=v[1]){Object.assign(r,{state:'UNCERTAIN',lease_token:null,lease_expires_at:null});changes=1;}}
   else throw new Error('unexpected SQL');
   return {meta:{changes}};
  }
 };}};}};
 return {db,state};
}
test('retry delay bounded and validated',()=>{assert.equal(retryDelay(1),30000);assert.equal(retryDelay(2),60000);assert.equal(retryDelay(30),3600000);assert.throws(()=>retryDelay(0));});
test('approval gate, lease contention, idempotent claim and retry',async()=>{
 const {db,state}=fakeDb();state.record={report_hash:id,destination:'@ifxhelper2',state:'AWAITING_APPROVAL',attempts:0};
 const j=journal(db);
 assert.equal((await j.claim(id,token,now)).claimed,false);
 assert.equal(await j.approve(id,'reviewer',now+3600000,now),true);
 assert.equal(await j.approve(id,'reviewer',now+3600000,now),false);
 assert.equal((await j.claim(id,token,now)).claimed,true);
 assert.equal((await j.claim(id,'another_token_00001',now)).claimed,false);
 assert.equal(await j.settle(id,'wrong_token_00001','CONFIRMED_NOT_SENT',{now}),false);
 assert.equal(await j.settle(id,token,'CONFIRMED_NOT_SENT',{now}),true);
 assert.equal((await j.claim(id,'another_token_00001',now+1000)).claimed,false);
 assert.equal((await j.claim(id,'another_token_00001',now+30000)).claimed,true);
 assert.equal(await j.settle(id,'another_token_00001','CONFIRMED_SUCCESS',{messageId:123,now:now+30000}),true);
 assert.equal((await j.claim(id,'third_token_000001',now+31000)).claimed,false);
 assert.equal((await j.inspect(id)).state,'DELIVERED');
});
test('restart recovers expired lease into UNCERTAIN without replay',async()=>{
 const {db,state}=fakeDb();state.record={report_hash:id,destination:'@ifxhelper2',state:'APPROVED',approved_by:'reviewer',approval_expires_at:now+3600000,attempts:0};
 const first=journal(db);assert.equal((await first.claim(id,token,now,1000)).claimed,true);
 const restarted=journal(db);assert.equal((await restarted.recover(now+1001)).quarantined,1);
 assert.equal((await restarted.inspect(id)).state,'UNCERTAIN');
 assert.equal((await restarted.claim(id,'another_token_00001',now+2000)).claimed,false);
 assert.equal((await restarted.recover(now+3000)).quarantined,0);
});
test('rejects invalid IDs, tokens and unverified successful delivery',async()=>{
 const {db,state}=fakeDb();state.record={report_hash:id,destination:'@ifxhelper2',state:'APPROVED',approved_by:'reviewer',approval_expires_at:now+3600000,attempts:0};
 const j=journal(db);await assert.rejects(j.claim('bad',token,now));await assert.rejects(j.claim(id,'weak',now));
 await j.claim(id,token,now);await assert.rejects(j.settle(id,token,'CONFIRMED_SUCCESS',{now}));
});
