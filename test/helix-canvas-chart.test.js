'use strict';
const assert=require('node:assert/strict');
const chart=require('../helix-canvas-chart.js');
const candles=[
{time:'2026-11-08T00:00:00Z',open:100,high:105,low:98,close:104},
{time:'2026-11-08T00:01:00Z',open:104,high:107,low:102,close:103}
];
assert.equal(chart.validate(candles).length,2);
const g=chart.geometry(chart.validate(candles),400,240);
assert(g.x(0)<g.x(1));
assert(g.y(107)<g.y(98));
assert.throws(()=>chart.validate([candles[1],candles[0]]),/increasing/);
assert.throws(()=>chart.validate([{...candles[0],high:99}]),/Invalid OHLC/);
assert.throws(()=>chart.validate([{...candles[0],close:NaN}]),/Invalid OHLC/);
assert.throws(()=>chart.geometry([],400,240),/No candles/);
assert.throws(()=>chart.geometry(chart.validate(candles),10,10),/Invalid viewport/);
const calls=[];
const ctx={clearRect:(...a)=>calls.push(['clear',...a]),beginPath:()=>{},moveTo:()=>{},lineTo:()=>{},stroke:()=>{},fillRect:(...a)=>calls.push(['body',...a])};
const canvas={width:400,height:240,getContext:()=>ctx};
assert.equal(chart.draw(canvas,candles).count,2);
assert.equal(calls.filter(x=>x[0]==='body').length,2);
assert.throws(()=>chart.draw({getContext:()=>null},candles),/unavailable/);
console.log('HELIX independent Canvas geometry regression passed');
