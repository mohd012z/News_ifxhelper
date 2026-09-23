'use strict';
const assert=require('assert'),R=require('../lib/ohlc-resampler');
const rows=[];for(let i=0;i<30;i++)rows.push({time:new Date(Date.UTC(2026,8,23,1,i)).toISOString(),open:100+i,high:101+i,low:99+i,close:100.5+i,volume:10});
const m5=R.resample(rows,5);assert.equal(m5.length,6);assert.equal(m5[0].open,100);assert.equal(m5[0].close,104.5);assert.equal(m5[0].high,105);assert.equal(m5[0].low,99);assert.equal(m5[0].sourceCount,5);
const m15=R.resample(rows,15);assert.equal(m15.length,2);assert.equal(m15[1].sourceCount,15);
const m30=R.resample(rows,30);assert.equal(m30.length,1);assert.equal(m30[0].sourceCount,30);assert.equal(m30[0].complete,true);
const missing=rows.filter((_,i)=>i!==7);assert.equal(R.resample(missing,15).length,1);

// Calendar-aware higher-timeframe tests: W1 starts Monday 00:00 UTC and MN1 starts on calendar month.
const daily=[];
for(let d=0;d<14;d++){
 const t=new Date(Date.UTC(2026,8,14+d));
 daily.push({time:t.toISOString(),open:200+d,high:202+d,low:198+d,close:201+d,volume:100});
}
const w1=R.resampleCalendar(daily,'W1',{sourceTf:'D1',requireComplete:true});
assert.equal(w1.length,2);
assert.equal(w1[0].time,'2026-09-14T00:00:00.000Z');
assert.equal(w1[0].sourceCount,7);
assert.equal(w1[0].open,200);assert.equal(w1[0].close,207);

const monthly=[];
for(let d=0;d<61;d++){
 const t=new Date(Date.UTC(2026,7,1+d));
 monthly.push({time:t.toISOString(),open:300+d,high:302+d,low:298+d,close:301+d,volume:50});
}
const mn1=R.resampleCalendar(monthly,'MN1',{sourceTf:'D1',requireComplete:true});
assert.equal(mn1.length,2);
assert.equal(mn1[0].time,'2026-08-01T00:00:00.000Z');
assert.equal(mn1[0].sourceCount,31);
assert.equal(mn1[1].time,'2026-09-01T00:00:00.000Z');
assert.equal(mn1[1].sourceCount,30);

const incompleteMonth=monthly.slice(0,40);
assert.equal(R.resampleCalendar(incompleteMonth,'MN1',{sourceTf:'D1',requireComplete:true}).length,1);
console.log('ohlc resampler tests passed');
