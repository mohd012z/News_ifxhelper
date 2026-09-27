'use strict';
const assert=require('assert'),D=require('../lib/js-doctor');
const good=D.run({now:'2026-09-23T08:00:00Z',current:{sourceAt:'2026-09-23T07:58:00Z',snapshotId:'s1',frames:{W1:{complete:true},MN1:{complete:true}}},learning:{sourceAt:'2026-09-23T07:00:00Z',pending:2},research:{generatedAt:'2026-09-23T06:00:00Z',version:4},health:{sourceAt:'2026-09-23T07:59:00Z'}});
assert.equal(good.status,'PASS');
const bad=D.run({now:'2026-09-23T08:00:00Z',current:{sourceAt:'2026-09-23T06:00:00Z',snapshotId:'s1',frames:{W1:{complete:false},MN1:{complete:true}}},learning:{sourceAt:null},research:{generatedAt:'2026-09-20T00:00:00Z',version:1},health:{sourceAt:null}});
assert.equal(bad.status,'FAIL');assert(bad.checks.some(x=>x.code==='MARKET_STALE'));assert(bad.checks.some(x=>x.code==='W1_INCOMPLETE'));assert(bad.checks.some(x=>x.code==='LEARNING_MISSING'));
console.log('js doctor tests passed');
