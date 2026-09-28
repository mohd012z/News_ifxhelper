'use strict';
const assert=require('assert');
const K=require('../lib/kernel-ai');

const analysis={next:{state:'UP_BIAS',confidence:80,reasons:['trend_up','reentry_up']}};

let x=K.combine({analysis,evidence:{sampleSize:100,empiricalAccuracyPct:70,publishable:true},quality:{stale:true},mtfScore:80});
assert.equal(x.state,'WAIT');assert.equal(x.publishable,false);assert(x.reasons.includes('STALE_DATA'));

x=K.combine({analysis,evidence:{sampleSize:10,empiricalAccuracyPct:80,publishable:false},quality:{},mtfScore:80});
assert.equal(x.state,'LEARNING');assert.equal(x.publishable,false);

x=K.combine({analysis,evidence:{sampleSize:100,empiricalAccuracyPct:70,publishable:true},quality:{},mtfScore:80,newsState:'NORMAL'});
assert.equal(x.state,'UP_BIAS');assert.equal(x.publishable,true);assert.equal(x.confidence,76);

x=K.combine({analysis,evidence:{sampleSize:100,empiricalAccuracyPct:70,publishable:true},quality:{},mtfScore:80,newsState:'NEWS_RELEASE'});
assert.equal(x.state,'WATCH');assert.equal(x.publishable,false);assert(x.reasons.includes('NEWS_RELEASE_GATE'));

console.log('kernel-ai tests passed');
