'use strict';
/* The Telegram BBMA publisher must be able to broadcast ONLY state backed by
 * real, fresh, validated data. It must NEVER fabricate the old demo box
 * (gold 3012.50 / "RE-ENTRY (Armed)" / "H4 MHV confirmed rejection"). These
 * tests pin that contract so a regression can't quietly start posting demos. */
const fs=require('fs'),assert=require('assert');
const P=require('../send-bbma-telegram.js');

const now=Date.now();
function iso(msAgo){return new Date(now-msAgo).toISOString();}
/* A realistic watch snapshot built from REAL (synthetic-but-shaped) data:
 * 8 timeframes all trend UP, all fresh (EXACT), a live last close. */
function goodWatch({ageMin=5,signal='UP'}={}){
  const rows=['M1','M5','M15','M30','H1','H4','D1'].map(tf=>({tf,role:'SETUP',trend:signal,pattern:squeezeOrBadge(signal),quality:'EXACT',lastTime:iso(60000)}));
  const analysis={};
  rows.forEach(r=>analysis[r.tf]={bbma:{zone:'MID_BB',momentum:'NONE',reentry:'NONE'}});
  return {
    schemaVersion:3,generationId:'bbma-test-1',generatedAt:iso(ageMin*60000),sourceGeneratedAt:iso(ageMin*60000),
    symbol:'GC=F',provider:'yahoo',httpMs:12,
    source:{candles:4800,valid:4790,gaps:10,duplicates:0},
    last:{time:iso(60000),close:4215.33,bar:'M1'},
    news:{state:'NORMAL',event:{title:'US CPI',currency:'USD',impact:'HIGH',actual:null,forecast:0.3,previous:0.2},minutes:300},
    analysis,dashboard:{rows,chains:[],overall:signal==='UP'?'UP_ALIGNED':'MIXED'}
  };
}
function squeezeOrBadge(t){return t==='UP'?'TREND_UP':'TREND_DOWN';}

// 1) No snapshot at all -> not publishable, no demo.
let d=P.boxDataFromWatch(null);
assert.strictEqual(d.publishable,false);
assert.match(d.reason,/no_watch_snapshot/);

// 2) Fresh + aligned -> publishable, real price, no demo strings.
d=P.boxDataFromWatch(goodWatch({ageMin:5}));
assert.strictEqual(d.publishable,true,'fresh aligned snapshot must be publishable');
assert.strictEqual(d.price,4215.33);
assert(d.signal==='BULLISH_ALIGNMENT','expected bullish alignment, got '+d.signal);
let box=P.formatBbmaAlertBox(d).text;
assert(!box.includes('3012.50'),'must not contain the old fabricated demo price');
assert(!/RE-ENTRY \(Armed\)/.test(box),'must not contain the old demo alert');
assert(!/H4 MHV confirmed rejection/.test(box),'must not contain the old demo summary');
assert(box.includes('4215.33'),'box must show the REAL price');
assert(box.includes('GC=F'),'box must attribute the price to its real source');

// 3) Stale snapshot (> 6h) -> suppressed.
d=P.boxDataFromWatch(goodWatch({ageMin:7*60}));
assert.strictEqual(d.publishable,false);
assert.match(d.reason,/watch_snapshot_stale/);

// 4) MTF MIXED -> suppressed (no direction).
d=P.boxDataFromWatch(goodWatch({ageMin:5,signal:'DOWN'}));
// All-DOWN is still a (bearish) alignment, so flip to a genuine mix instead.
d=P.boxDataFromWatch(mixWatch());
assert.strictEqual(d.publishable,false,'MIXED alignment must not be published');
assert.match(d.reason,/mtf_mixed/);

// 5) Missing price -> suppressed even if aligned.
const w=goodWatch({ageMin:5}); w.last=null;
d=P.boxDataFromWatch(w);
assert.strictEqual(d.publishable,false);
assert.match(d.reason,/missing_price/);

// 6) loadWatchSnapshot: absent file -> null (never throws).
assert.strictEqual(P.loadWatchSnapshot('/nonexistent/bbma-watch.json'),null);

// 7) The committed file (if present in CI) is parsed, otherwise null — no crash.
const real=P.loadWatchSnapshot();
if(real) assert(real.generatedAt&&real.analysis&&real.dashboard);

function mixWatch(){
  const g=goodWatch({ageMin:5});
  // Half UP, half DOWN -> MIXED (neither direction dominates 2x).
  g.dashboard.rows.forEach((r,i)=>{r.trend=i%2===0?'UP':'DOWN';g.analysis[r.tf].bbma.zone=i%2===0?'ABOVE_TOP_BB':'BELOW_LOW_BB';});
  g.dashboard.overall='MIXED';
  return g;
}

console.log('BBMA Telegram publisher honesty contract passed');
