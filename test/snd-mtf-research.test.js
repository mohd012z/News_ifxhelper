'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {analyze}=require('../lib/snd-mtf-research');
const t=Date.parse('2026-10-01T00:00:00Z');
function candles(ms,n=60){return Array.from({length:n},(_,i)=>{const p=100+i*.1;return {time:new Date(t+i*ms).toISOString(),open:p,high:p+.4,low:p-.4,close:p+.1,complete:true,source:'OBSERVED'};});}
test('rejects malformed request and unknown timeframes',()=>{
 assert.throws(()=>analyze(null,{asOf:new Date(t).toISOString()}));
 assert.throws(()=>analyze({M15:[]},{asOf:'bad'}));
 assert.throws(()=>analyze({M15:[]},{asOf:new Date(t).toISOString(),timeframes:['UNKNOWN']}));
 assert.throws(()=>analyze({M15:[]},{asOf:new Date(t).toISOString(),timeframes:['M15','M15']}));
});
test('per timeframe cutoff excludes still-open bars',()=>{
 const a=candles(900000),b=candles(14400000);
 const cutoff=t+40*900000+60000;
 const x=analyze({M15:a,H4:b},{asOf:new Date(cutoff).toISOString(),timeframes:['H4','M15']});
 assert.equal(x.timeframes.M15.closedCandles,40);
 assert.equal(x.timeframes.H4.closedCandles,2);
 assert.equal(x.kind,'RESEARCH_ONLY');
});
test('future data cannot change historical research snapshot',()=>{
 const a=candles(900000),at=new Date(t+50*900000).toISOString();
 const x=analyze({M15:a},{asOf:at});
 const later=[...a,...candles(900000,70).slice(60)];
 const y=analyze({M15:later},{asOf:at});
 assert.deepEqual(y,x);
});
test('invalid and synthetic input fails closed, never becomes signal',()=>{
 const a=candles(900000);a[10].source='BASELINE_CACHE';
 const x=analyze({M15:a},{asOf:new Date(t+100*900000).toISOString()});
 assert.equal(x.timeframes.M15.state,'UNAVAILABLE');
 assert.equal(x.timeframes.M15.zones.length,0);
});
test('missing input has explicit unavailable state',()=>{
 const x=analyze({},{asOf:new Date(t).toISOString(),timeframes:['H1']});
 assert.equal(x.timeframes.H1.state,'UNAVAILABLE');
 assert.equal(x.summary.unavailable,1);
});
test('research output is deterministic and contains no trade execution action',()=>{
 const args=[{H1:candles(3600000)},{asOf:new Date(t+61*3600000).toISOString()}];
 const a=analyze(...args);assert.deepEqual(a,analyze(...args));
 assert.equal(JSON.stringify(a).includes('sendMessage'),false);
});
