'use strict';
const assert=require('assert'),O=require('../lib/output-coordinator');
assert.equal(O.ownerFor('data/current-snapshot.json'),'market-intelligence');
assert.equal(O.ownerFor('data/learning-summary.json'),'background-learning');
assert.equal(O.ownerFor('data/system-health.json'),'health-coordinator');
assert.throws(()=>O.assertOwner('data/current-snapshot.json','background-learning'),/WRITE_OWNER_MISMATCH/);
const a={sourceAt:'2026-09-23T07:50:00Z',value:1};
assert.equal(O.shouldWrite(a,a).state,'SKIPPED_UNCHANGED');
assert.equal(O.shouldWrite(a,{...a,value:2}).state,'CHANGED');
// Required stale source is RED. A conflict may degrade GREEN to YELLOW, but must never mask RED freshness failure.
const health=O.health({now:'2026-09-23T08:00:00Z',market:{sourceAt:'2026-09-23T07:58:00Z',maxAgeMin:15},news:{sourceAt:'2026-09-23T07:20:00Z',maxAgeMin:30},learning:{sourceAt:null,maxAgeMin:1440},conflicts:['H1_M30']});
assert.equal(health.components.market,'GREEN');assert.equal(health.components.news,'RED');assert.equal(health.components.learning,'GRAY');assert.equal(health.overall,'RED');
const conflictOnly=O.health({now:'2026-09-23T08:00:00Z',market:{sourceAt:'2026-09-23T07:58:00Z',maxAgeMin:15},news:{sourceAt:'2026-09-23T07:58:00Z',maxAgeMin:30},learning:{sourceAt:'2026-09-23T07:00:00Z',maxAgeMin:1440},conflicts:['H1_M30']});
assert.equal(conflictOnly.overall,'YELLOW');
console.log('output coordinator tests passed');
