const test=require('node:test');
const assert=require('node:assert/strict');
const {validateBbmaResearchSnapshot,formatBbmaAlertBox}=require('../send-bbma-telegram.js');
const now=Date.parse('2026-11-01T08:00:00Z');
function snapshot(mod={}){
 return {price:3000,provenance:{verified:true,kind:'provider_market_data',provider:'AUTHORIZED_PROVIDER',providerQuoteId:'quote-fixture-01',sourceTime:new Date(now-2000).toISOString()},
  alerts:[{id:'a',validated:true,closedCandle:true,sourceTime:new Date(now-60000).toISOString()}],
  ohlc:{H1:[{open:3000,high:3001,low:2999,close:3000,source:'SOURCE_VALIDATED'}]},...mod};
}
test('synthetic browser runtime with LIVE_TICK_DERIVED flag is rejected',()=>{
 const fake={source:'LIVE_TICK_DERIVED',fresh:true,price:'2658.50',alerts:[{pattern:'MHV',level:'HIGH'}],ohlc:{H1:[{source:'BASELINE_CACHE'}]}};
 assert.equal(validateBbmaResearchSnapshot(fake,now).reason,'source_unverified');
});
test('missing runtime is not a verified feed',()=>{assert.equal(validateBbmaResearchSnapshot(null,now).reason,'runtime_missing');});
test('future quotes and stale quotes fail closed',()=>{
 assert.equal(validateBbmaResearchSnapshot(snapshot({provenance:{...snapshot().provenance,sourceTime:new Date(now+3000).toISOString()}}),now).reason,'future_quote');
 assert.equal(validateBbmaResearchSnapshot(snapshot({provenance:{...snapshot().provenance,sourceTime:new Date(now-30000).toISOString()}}),now).reason,'quote_stale');
});
test('demo candles and non-validated alerts block broadcasting',()=>{
 assert.equal(validateBbmaResearchSnapshot(snapshot({ohlc:{H1:[{source:'BASELINE_CACHE'}]}}),now).reason,'baseline_candle_present');
 assert.equal(validateBbmaResearchSnapshot(snapshot({alerts:[{validated:false,closedCandle:true}]}),now).reason,'validated_alert_missing');
});
test('structurally valid research provenance is accepted without claiming external verification',()=>{
 const result=validateBbmaResearchSnapshot(snapshot(),now);assert.equal(result.ok,true);assert.equal(result.reason,'internally_validated_snapshot');
});
test('formatting does not assert macro runway clear without evidence',()=>{
 const result=formatBbmaAlertBox({price:3000,alerts:[{timeframe:'H1',pattern:'RESEARCH',summary:'Study only'}]});
 assert.match(result.text,/UNVERIFIED/);
 assert.doesNotMatch(result.text,/No high-impact release in window/);
});
