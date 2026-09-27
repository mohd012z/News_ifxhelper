'use strict';
const assert=require('assert'),R=require('../lib/ohlc-resampler');
const rows=[];for(let i=0;i<30;i++)rows.push({time:new Date(Date.UTC(2026,8,23,1,i)).toISOString(),open:100+i,high:101+i,low:99+i,close:100.5+i,volume:10});
const m5=R.resample(rows,5);assert.equal(m5.length,6);assert.equal(m5[0].open,100);assert.equal(m5[0].close,104.5);assert.equal(m5[0].high,105);assert.equal(m5[0].low,99);assert.equal(m5[0].sourceCount,5);
const m15=R.resample(rows,15);assert.equal(m15.length,2);assert.equal(m15[1].sourceCount,15);
const m30=R.resample(rows,30);assert.equal(m30.length,1);assert.equal(m30[0].sourceCount,30);assert.equal(m30[0].complete,true);
const missing=rows.filter((_,i)=>i!==7);assert.equal(R.resample(missing,15).length,1);
console.log('ohlc resampler tests passed');
