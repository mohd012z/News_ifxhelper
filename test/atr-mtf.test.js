'use strict';
const assert=require('node:assert/strict');
const E=require('../lib/atr-mtf-engine');
const R=require('../lib/market-signal-review');
const NOW=Date.UTC(2026,9,30,12,0,0); // Fri 30 October, noon UTC

function createSeries(stepMs,count,lastClosedAt,{weekdays=false}={}){
  const rows=[];
  for(let i=count;i>=1;i--){
    const ms=lastClosedAt-i*stepMs;
    if(weekdays&&[0,6].includes(new Date(ms).getUTCDay()))continue;
    const o=4000+(count-i)*0.015;
    rows.push({time:new Date(ms).toISOString(),open:o,high:o+2,low:o-2,close:o+.5});
  }
  return rows;
}
function sample(){
  return {
    '1m':createSeries(60000,350,NOW),
    '5m':createSeries(300000,600,NOW),
    '1h':createSeries(3600000,700,NOW),
    '1d':createSeries(86400000,1400,Date.UTC(2026,9,30),{weekdays:true})
  };
}
const source={now:NOW,instrument:'GC=F',provider:'YAHOO_CHART',source:'yahoo:GC=F'};
const all=E.analyzeAll(sample(),source);
assert.equal(all.total,9);
assert.equal(all.readyCount,9);
assert.equal(all.state,'READY');
assert.deepEqual(Object.keys(all.timeframes),['M1','M5','M15','M30','H1','H4','D1','W1','MN1']);
for(const frame of Object.values(all.timeframes)){
  assert.equal(frame.state,'READY',frame.tf+':'+frame.reason);
  assert(frame.atr>0,frame.tf);
  assert(frame.closedBars>=15,frame.tf);
  assert(frame.asOf && Date.parse(frame.asOf)<=NOW,frame.tf);
  assert.equal(frame.instrument,'GC=F');
}
assert.equal(all.timeframes.M1.sourceInterval,'1m');
assert.equal(all.timeframes.M15.sourceInterval,'5m');
assert.equal(all.timeframes.H4.sourceInterval,'1h');
assert.equal(all.timeframes.MN1.sourceInterval,'1d');
assert(all.timeframes.MN1.atr!==all.timeframes.M1.atr);
assert(all.timeframes.MN1.asOf < all.timeframes.W1.asOf);
// Wilder TR math: constant 4 range, prior close stays inside future bar.
assert.equal(E.wilderATR(createSeries(60000,30,NOW)),4);
// Missing bar prevents an otherwise complete synthetic H4 aggregate.
const three=createSeries(3600000,4,NOW).filter(x=>Date.parse(x.time)!==NOW-2*3600000);
assert.equal(E.aggregateBars(three,240,60,NOW).length,0);
// Current forming candle at NOW is rejected, not used as completed evidence.
const withForming=[...sample()['1m'],{time:new Date(NOW).toISOString(),open:4000,high:4001,low:3999,close:4000}];
assert.equal(E.cleanRows(withForming,1,NOW).future,1);
const broken=sample();
broken['5m'].push({...broken['5m'][0]});
const degraded=E.analyzeAll(broken,source);
for(const tf of ['M5','M15','M30']) assert.equal(degraded.timeframes[tf].reason,'CORRUPT_SOURCE_BARS');
assert.equal(degraded.timeframes.H4.state,'READY');
const noHistory=E.analyzeAll({},source);
assert.equal(noHistory.readyCount,0);
assert.equal(noHistory.timeframes.MN1.reason,'INSUFFICIENT_CLOSED_CANDLES');
// Source-independent engine can accept genuine broker XAU/USD OHLC, but must
// never claim Yahoo futures is spot.
const broker=E.analyzeAll(sample(),{...source,instrument:'XAU/USD',provider:'BROKER',source:'broker:XAU/USD'});
assert.equal(broker.readyCount,9);
assert.equal(broker.timeframes.M1.instrument,'XAU/USD');
const quoteAt=new Date(NOW-3*60000).toISOString();
const quote={symbol:'GC=F',source:'yahoo:GC=F',price:4000,marketAt:quoteAt};
const plan=R.buildMultiTimeframeTargets({quote,atrMtf:all,signal:'SELL',now:new Date(NOW).toISOString()});
assert.equal(plan.total,9);
assert.equal(plan.readyCount,9);
assert.notEqual(plan.timeframes.M1.tp1,plan.timeframes.D1.tp1);
assert.equal(plan.timeframes.M1.instrument,'GC=F');
const spotQuote={...quote,symbol:'XAU/USD',source:'broker:XAU/USD'};
const mismatch=R.buildMultiTimeframeTargets({quote:spotQuote,atrMtf:all,signal:'SELL',now:new Date(NOW).toISOString()});
assert.equal(mismatch.readyCount,0);
assert.equal(mismatch.timeframes.M1.reason,'INSTRUMENT_MISMATCH');
const brokerPlan=R.buildMultiTimeframeTargets({quote:spotQuote,atrMtf:broker,signal:'SELL',now:new Date(NOW).toISOString()});
assert.equal(brokerPlan.readyCount,9);
const weekend=R.buildMultiTimeframeTargets({quote,atrMtf:all,signal:'SELL',now:new Date(NOW+2*86400000).toISOString()});
assert.equal(weekend.readyCount,0);
assert.equal(weekend.timeframes.M1.reason,'STALE_QUOTE');
const noQuote=R.buildMultiTimeframeTargets({quote:null,atrMtf:all,signal:'SELL',now:new Date(NOW).toISOString()});
assert.equal(noQuote.readyCount,0);
assert.equal(noQuote.timeframes.MN1.reason,'QUOTE_UNAVAILABLE');
console.log('nine-timeframe ATR tests passed');
