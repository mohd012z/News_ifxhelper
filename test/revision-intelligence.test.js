'use strict';
const assert=require('assert'),R=require('../lib/revision-intelligence');
const first={eventId:'US-CPI-2026-10',scheduledAt:'2026-10-14T12:30:00Z',previous:2.0,forecast:2.1,actual:2.3,source:'primary',sourceAt:'2026-10-14T12:30:10Z'};
let s=R.ingest(null,first);assert.equal(s.firstRelease.actual,2.3);assert.equal(s.current.actual,2.3);assert.equal(s.revisions.length,0);
s=R.ingest(s,{...first,actual:2.2,sourceAt:'2026-10-14T13:15:00Z'});assert.equal(s.firstRelease.actual,2.3);assert.equal(s.current.actual,2.2);assert.equal(s.revisions.length,1);assert.equal(s.revisions[0].from,2.3);assert.equal(s.revisions[0].to,2.2);
const snap=R.learningSnapshot(s);assert.equal(snap.actual,2.3);assert.equal(snap.releaseType,'FIRST_RELEASE');
const consensus=R.reconcile([{source:'a',actual:2.3,sourceAt:'2026-10-14T12:30:10Z'},{source:'b',actual:2.3,sourceAt:'2026-10-14T12:30:12Z'},{source:'c',actual:2.5,sourceAt:'2026-10-14T12:30:11Z'}]);assert.equal(consensus.state,'AGREE');assert.equal(consensus.actual,2.3);assert.equal(consensus.support,2);
const conflict=R.reconcile([{source:'a',actual:2.2},{source:'b',actual:2.4}]);assert.equal(conflict.state,'CONFLICT');
console.log('revision intelligence tests passed');
