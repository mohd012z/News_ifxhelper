'use strict';
const assert=require('assert');
const E=require('../lib/evidence-engine');
assert(E.sourceWeight('OFFICIAL_RELEASE')>E.sourceWeight('SPECULATION'));
assert.equal(E.combine([]).state,'INSUFFICIENT_DATA');
assert.equal(E.combine([{direction:'UP',confidence:90,sourceClass:'OFFICIAL_RELEASE'}]).state,'ALIGNED');
assert.equal(E.combine([{direction:'UP',confidence:90,sourceClass:'OFFICIAL_RELEASE'},{direction:'DOWN',confidence:90,sourceClass:'OFFICIAL_RELEASE'}]).state,'CONFLICT');
assert.equal(E.combine([{direction:'UP',confidence:90,sourceClass:'OFFICIAL_RELEASE'},{direction:'DOWN',confidence:90,sourceClass:'SPECULATION'}]).direction,'UP');
console.log('evidence-engine tests passed');
