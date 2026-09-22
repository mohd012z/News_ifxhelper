'use strict';
const assert=require('assert');
const H=require('../lib/history-store');
assert.equal(H.stanceDelta('HAWKISH','DOVISH').label,'MORE_HAWKISH');
assert.equal(H.stanceDelta('DOVISH','HAWKISH').label,'MORE_DOVISH');
assert.equal(H.stanceDelta('NEUTRAL','NEUTRAL').label,'UNCHANGED_OR_UNCLEAR');
const e=H.eventRecord({event:'CPI',actual:'3.2%',forecast:'3.0%',previous:'2.9%',release:{state:'RELEASED'}});
assert.equal(e.actual,'3.2%'); assert.equal(e.release.state,'RELEASED');
console.log('history-store tests passed');
