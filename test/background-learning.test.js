'use strict';
const assert=require('assert'),L=require('../lib/background-learning');
const observations=[
 {id:'a',snapshotId:'s1',timeframe:'M30',predictionTime:'2026-09-23T10:00:00Z',status:'PENDING'},
 {id:'b',snapshotId:'s2',timeframe:'H1',predictionTime:'2026-09-23T10:00:00Z',status:'PENDING'},
 {id:'c',snapshotId:'s3',timeframe:'M30',predictionTime:'2026-09-23T09:00:00Z',status:'SETTLED'}
];
const due=L.due(observations,'2026-09-23T10:31:00Z');assert.deepEqual(due.map(x=>x.id),['a']);
const candles=[{time:'2026-09-23T10:30:00.000Z',open:100,close:101},{time:'2026-09-23T11:00:00.000Z',open:101,close:102}];
const settled=L.settle(observations[0],candles,'2026-09-23T10:31:00Z');assert.equal(settled.status,'SETTLED');assert.equal(settled.outcomeTime,'2026-09-23T10:30:00.000Z');
const missing=L.settle({...observations[0],predictionTime:'2026-09-23T11:00:00Z'},candles,'2026-09-23T12:00:00Z');assert.equal(missing.status,'PENDING');assert.equal(missing.reason,'EXACT_OUTCOME_MISSING');
console.log('background learning tests passed');
