'use strict';
const assert=require('assert');
const S=require('../lib/bbma-alert-signal');
const mtf={M5:{state:'MOMENTUM_UP',location:'UPPER',fresh:true},M15:{state:'MOMENTUM_UP',location:'UPPER',fresh:true},M30:{state:'REENTRY_BUY',location:'MID',fresh:true},H1:{state:'EXTREME_HIGH',location:'UPPER',fresh:true},H4:{state:'TREND_UP',location:'ABOVE_EMA50',fresh:true},D1:{state:'TREND_UP',location:'ABOVE_EMA50',fresh:true},W1:{state:'TREND_UP',location:'ABOVE_EMA50',fresh:true},MN1:{state:'TREND_UP',location:'ABOVE_EMA50',fresh:true}};
let r=S.build({symbol:'XAU/USD',mtf,event:{name:'US CPI',impact:'HIGH',minutesTo:25,currency:'USD'}});
assert.equal(r.blocked,false);assert.equal(r.newsWindow,'PRE_EVENT');assert(r.alerts.some(x=>x.code==='NEWS_NEAR_BB_EXTREME'));assert(r.evidence.some(x=>x.includes('H1')));assert(r.signal==='BULLISH_ALIGNMENT'||r.signal==='MIXED');
r=S.build({symbol:'XAU/USD',mtf:{...mtf,H1:{...mtf.H1,fresh:false}},event:{name:'US CPI',impact:'HIGH',minutesTo:5,currency:'USD'}});assert.equal(r.blocked,true);assert(r.alerts.some(x=>x.code==='STALE_BBMA'));
r=S.build({symbol:'XAU/USD',mtf,event:{name:'US CPI',impact:'HIGH',minutesTo:-3,currency:'USD',actual:3.2,forecast:3.0,previous:2.9}});assert.equal(r.newsWindow,'POST_EVENT');assert(r.alerts.some(x=>x.code==='NEWS_RELEASED'));
console.log('bbma alert signal tests passed');
