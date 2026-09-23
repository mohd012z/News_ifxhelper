'use strict';
const assert=require('assert'),C=require('../lib/cron-orchestrator');
const jobs=[
 {name:'market',deps:[],maxAttempts:3},
 {name:'research',deps:['market'],maxAttempts:2},
 {name:'publish',deps:['market','research'],maxAttempts:2}
];
const plan=C.plan(jobs,{market:'SUCCESS',research:'PENDING',publish:'PENDING'});assert.deepEqual(plan.runnable,['research']);
const plan2=C.plan(jobs,{market:'SUCCESS',research:'SUCCESS',publish:'PENDING'});assert.deepEqual(plan2.runnable,['publish']);
assert.equal(C.acquire({market:{owner:'run1',expiresAt:'2026-09-23T10:10:00Z'}},'market','run2','2026-09-23T10:00:00Z',10).state,'LOCKED');
assert.equal(C.acquire({market:{owner:'run1',expiresAt:'2026-09-23T09:50:00Z'}},'market','run2','2026-09-23T10:00:00Z',10).state,'ACQUIRED');
assert.equal(C.retry({attempt:1,maxAttempts:3},'TRANSIENT').state,'RETRY');assert.equal(C.retry({attempt:3,maxAttempts:3},'TRANSIENT').state,'FAILED');assert.equal(C.retry({attempt:1,maxAttempts:3},'PERMANENT').state,'FAILED');
const missed=C.missedRuns({lastSuccessAt:'2026-09-23T08:00:00Z',now:'2026-09-23T10:10:00Z',intervalMin:60,maxCatchup:3});assert.deepEqual(missed,['2026-09-23T09:00:00.000Z','2026-09-23T10:00:00.000Z']);
const roll=C.dailyRollover('2026-09-23T23:59:00Z','2026-09-24T00:01:00Z');assert.equal(roll,true);
console.log('cron orchestrator tests passed');
