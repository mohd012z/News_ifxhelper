'use strict';
const assert=require('node:assert/strict');
const {planNotifications,redactDeliveryResult}=require('../lib/whatsapp-reminder-planner');
const now=Date.parse('2026-11-03T08:00:00Z');
const event=(offset,importance='high')=>({event:'Economic release',date:'2026-11-03',timeMyt:'2026-11-03 16:30',timeUtc:new Date(now+offset*60000).toISOString(),importance});
const cases=[[30,30],[27,30],[10,10],[8,10],[2,2],[1,2]];
for(const [minutes,stage] of cases) {
 const found=planNotifications([event(minutes)],now);
 assert.equal(found.length,1,'expected one reminder at '+minutes);
 assert.equal(found[0].stage,stage);
}
assert.equal(planNotifications([event(20)],now).length,0);
assert.equal(planNotifications([event(-1)],now).length,0);
assert.equal(planNotifications([event(36)],now).length,0);
assert.equal(planNotifications([event(30,'low')],now,{impacts:['high']}).length,0);
assert.equal(planNotifications([event(30,'med')],now).length,1);
const first=planNotifications([event(30)],now)[0];
assert.equal(planNotifications([event(30)],now,{sentKeys:[first.key]}).length,0);
assert.deepEqual(redactDeliveryResult({ok:false,status:429,errorCode:4,accessToken:'secret',recipient:'private'}),{ok:false,status:429,providerCode:4});
assert.throws(()=>planNotifications([],NaN),TypeError);
console.log('WhatsApp reminder planner tests passed');
