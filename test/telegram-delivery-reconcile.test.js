'use strict';
const assert=require('node:assert/strict');
const {reconcileDelivery}=require('../lib/telegram-delivery-reconcile');
const now=Date.parse('2026-11-03T12:00:00Z');
const base={key:'channel:alert-1',chatId:'-1001234567890',status:'pending',attempts:0};
const receipt={ok:true,messageId:12,chatId:-1001234567890};
const delivered=reconcileDelivery(base,receipt,now);
assert.equal(delivered.status,'delivered');
assert.equal(delivered.messageId,12);
assert.deepEqual(reconcileDelivery(delivered,{ok:false},now),delivered);
const named={...base,chatId:'@ifxhelper2'};
assert.equal(reconcileDelivery(named,{ok:true,messageId:13,chat:{username:'IFXHELPER2'}},now).status,'delivered');
for(const response of [
 {ok:true,messageId:12,chatId:-1009999999999},
 {ok:true,messageId:12},
 {ok:true,messageId:0,chatId:-1001234567890},
 {ok:true,chatId:-1001234567890},
 {ok:true,messageId:12,chatId:-1001234567890,uncertain:true}
]) {
 const outcome=reconcileDelivery(base,response,now);
 assert.equal(outcome.status,'uncertain');
 assert.equal(outcome.nextAttemptAt,null);
 assert.equal(outcome.failureCategory,'uncertain');
 assert.deepEqual(reconcileDelivery(outcome,receipt,now),outcome);
}
assert.equal(reconcileDelivery(named,{ok:true,messageId:12,chatId:-1001234567890},now).status,'uncertain');
assert.equal(reconcileDelivery({...base,chatId:undefined},receipt,now).status,'uncertain');
const limited=reconcileDelivery(base,{ok:false,status:429,retryAfter:60},now);
assert.equal(limited.status,'retry');
assert.equal(limited.failureCategory,'rate-limited');
assert.equal(Date.parse(limited.nextAttemptAt)-now,60000);
assert.equal(reconcileDelivery({...base,attempts:4},{ok:false},now).status,'dead-letter');
assert.equal(reconcileDelivery(base,{uncertain:true},now).status,'uncertain');
assert.throws(()=>reconcileDelivery({}, {},now),/Invalid/);
console.log('Telegram delivery reconciliation checks passed');
