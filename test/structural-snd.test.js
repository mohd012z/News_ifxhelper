'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const S=require('../lib/structural-snd');
const start=Date.parse('2026-01-01T00:00:00Z');
function c(i,o,cl,lo=Math.min(o,cl)-0.2,hi=Math.max(o,cl)+0.2){return {time:new Date(start+i*60000).toISOString(),open:o,high:hi,low:lo,close:cl,complete:true,source:'OBSERVED'};}
function fixture(arrival,departure){
 const a=Array.from({length:16},(_,i)=>c(i,100+(i%2)*0.3,100+(i%2)*0.3));
 a[13]=c(13,100,arrival==='UP'?101:99);
 a[14]=c(14,100,100.05,99.9,100.2);
 a[15]=c(15,100.05,100,99.9,100.2);
 a.push(c(16,100,departure==='UP'?103:97,departure==='UP'?99.9:96.8,departure==='UP'?103.2:100.1));
 return a;
}
test('rejects forming, synthetic, malformed and unordered candles',()=>{
 for(const change of [{complete:false},{source:'BASELINE_CACHE'},{high:0},{time:'invalid'}])assert.throws(()=>S.detect([{...c(0,100,101),...change}]));
 assert.throws(()=>S.detect([c(0,100,101),c(0,100,101)]));
});
test('empty and insufficient inputs produce no zones',()=>{assert.deepEqual(S.detect([]),[]);assert.deepEqual(S.detect([c(0,100,101)]),[]);});
test('detects all four structural patterns with confirmed departure',()=>{
 for(const [arrival,departure,type] of [['UP','UP','RBR'],['DOWN','DOWN','DBD'],['DOWN','UP','DBR'],['UP','DOWN','RBD']]){
  const zones=S.detect(fixture(arrival,departure),{impulse:1,baseRatio:2});
  assert.ok(zones.some(z=>z.type===type),type);
  assert.ok(zones.every(z=>Date.parse(z.confirmedAt)<=Date.parse(fixture(arrival,departure).at(-1).time)));
 }
});
test('no lookahead: confirmation cannot exist before departure candle',()=>{
 const a=fixture('DOWN','UP');
 assert.ok(!S.detect(a.slice(0,-1),{impulse:1,baseRatio:2}).some(z=>z.confirmedAt===a.at(-1).time));
});
test('lifecycle touch, mitigation and invalidation are chronological',()=>{
 const a=fixture('DOWN','UP'),opts={impulse:1,baseRatio:2};
 const first=S.detect(a,opts).find(z=>z.type==='DBR');assert.ok(first);
 const touch=c(17,first.proximal+0.1,first.proximal+0.1,first.proximal-0.1,first.proximal+0.2);
 const tested=S.detect([...a,touch],opts).find(z=>z.id===first.id);assert.equal(tested.status,'TESTED');
 const mitigated=S.detect([...a,touch,c(18,touch.close,touch.close,touch.low,touch.high)],opts).find(z=>z.id===first.id);assert.equal(mitigated.status,'MITIGATED');
 const broken=c(19,first.distal+0.1,first.distal-0.5,first.distal-0.7,first.distal+0.2);
 const invalid=S.detect([...a,touch,c(18,touch.close,touch.close,touch.low,touch.high),broken],opts).find(z=>z.id===first.id);
 assert.equal(invalid.status,'INVALIDATED');assert.equal(invalid.invalidatedAt,broken.time);
});
test('BBMA confluence is research-only and fails closed on insufficient data',()=>{
 const a=fixture('DOWN','UP'),z=S.detect(a,{impulse:1,baseRatio:2}).find(z=>z.type==='DBR');
 assert.equal(S.confluence(z,a).state,'INSUFFICIENT_DATA');
});
