'use strict';
const assert=require('assert'),T=require('../lib/timestamps');
const s=T.stamp('2026-09-23T00:00:00Z');
assert.equal(s.utc,'2026-09-23T00:00:00.000Z');
assert.equal(s.myt,'2026-09-23T08:00:00.000+08:00');
assert.equal(s.weekUtc,'2026-W39');
assert.equal(s.monthUtc,'2026-09');
console.log('timestamp tests passed');
