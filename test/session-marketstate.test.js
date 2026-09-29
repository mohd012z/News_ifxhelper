'use strict';
const assert=require('assert');
const SE=require('../lib/session-engine.js');
const MS=require('../lib/market-state.js');
const W=require('../lib/bbma-candle-watch.js');
let pass=0;function ok(c,m){assert(c,m);pass++;}
function n(v){return Number.isFinite(+v)?+v:null;}
/* deterministic M15 (weekdays) .time=OPEN */
function m15(t0,nb){let p=4167,out=[];let seed=7;const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};let t=t0;while(out.length<nb){const d=new Date(t);if(d.getUTCDay()!==0&&d.getUTCDay()!==6){const o=p;p=Math.max(1000,o+(rnd()-0.48)*1.2);const c=p;out.push({time:new Date(t).toISOString(),open:o,high:Math.max(o,c)+.4,low:Math.min(o,c)-.4,close:c});}t+=900000;}return out;}

/* ===== DST: US cash open must be 13:30 UTC in winter (EST), 12:30 UTC in summer (EDT) ===== */
const winter=SE.usOpenUtc(Date.UTC(2026,0,15,14,0,0));  /* Jan 15 14:00 UTC = 9:00 EST -> that trading day */
const summer=SE.usOpenUtc(Date.UTC(2026,6,15,13,0,0));  /* Jul 15 13:00 UTC = 9:00 EDT */
const wH=new Date(winter).getUTCHours(),wM=new Date(winter).getUTCMinutes();
const sH=new Date(summer).getUTCHours(),sM=new Date(summer).getUTCMinutes();
ok(wH===13&&wM===30,'US open winter = 13:30 UTC (EST, 09:30 ET)',`got ${wH}:${wM}`);
ok(sH===12&&sM===30,'US open summer = 12:30 UTC (EDT, 09:30 ET)',`got ${sH}:${sM}`);
ok(winter!==summer,'US first-candle time tracks DST (not hardcoded all year)');
ok(new Date(SE.tokyoOpenUtc(Date.UTC(2026,0,15,1,0,0))).getUTCHours()===0,'Tokyo open = 00:00 UTC (09:00 JST, no DST)');

/* ===== session summary: first COMPLETED candle + locked zone + reaction ===== */
/* build a day where the NY session opened and a first closed candle exists */
const dayStart=Date.UTC(2026,0,15,0,0,0); /* Wed Jan 15 2026 00:00 UTC */
const candles=m15(dayStart,60); /* 60 M15 = 15h, from 00:00 UTC (covers NY open 13:30) */
const now=dayStart+20*3600*1000; /* 20:00 UTC same day — well into NY, several closed NY candles */
const ny=SE.summary({candles:candles,tf:'M15',now:now,session:'NEW_YORK'});
ok(ny.session==='NEW_YORK','NY session identified');
ok(ny.openUtc===SE.usOpenUtc(now),'NY open = DST-correct US open');
ok(ny.firstCandle!=null,'a first COMPLETED NY candle was found');
ok(ny.firstCandle.time>=new Date(ny.openUtc).toISOString(),'first candle opens at/after session open');
ok(ny.high!=null&&ny.low!=null&&ny.midpoint!=null,'opening range high/low/midpoint computed');
ok(ny.locked===true,'zone is LOCKED from the first completed candle');
ok(['UP','DOWN','FLAT'].indexOf(ny.reaction)>=0,'reaction of current close vs first candle');
ok(['ABOVE_OPEN','BELOW_OPEN','WITHIN_OPEN'].indexOf(ny.zone)>=0,'price locked to an opening-range zone');
/* first completed candle is itself a real closed candle (completedAt <= now) */
ok(Date.parse(ny.firstCandle.time)+15*60000<=now,'first candle is COMPLETED (open+tf<=now)');

/* Tokyo: first candle of the day at 00:00 UTC */
const tk=SE.summary({candles:candles,tf:'M15',now:dayStart+3*3600*1000,session:'TOKYO'});
ok(tk.session==='TOKYO','Tokyo session identified');
ok(tk.firstCandle!=null&&Date.parse(tk.firstCandle.time)===dayStart,'Tokyo first candle = 00:00 UTC (no DST)');

/* ===== MarketState: single canonical object, render-only, no recomputation ===== */
/* build a realistic runtime/builder `out` */
const win=m15(dayStart,120);
const loc=W.location(win);
const out={
  tf:'M15',symbol:'XAU/USD',generatedAt:new Date(now).toISOString(),
  instrument:{display:'XAU/USD',analysisSymbol:'XAUUSD',providerSymbol:'GC=F',isProxy:true},
  feed:{state:'LIVE',provider:'twelvedata',latencyMs:120,droppedTicks:0,gapDetected:false,backfillRequired:false},
  analysis:{M15:{bbma:loc,squeeze:{squeeze:loc.squeeze,widthPct:loc.values&&loc.values.bb&&loc.values.bb.widthPct},next:{state:'UP_BIAS',confidence:71}}},
  news:{state:'CLEAR',events:[]},
  lifecycle:{stage:'EVIDENCE_COMPLETE',passed:true,failedAt:null,direction:'UP',checks:{data_validated:true,mtf_validated:true,news_checked:true,evidence_complete:true,continuity:!false}},
  confidence:{score:88.5,verdict:'WAIT',prohibitions:['instrumentMismatchUnresolved'],weights:{DataQuality:30}},
  sessions:ny,
  oneStep:{status:'PENDING_SHADOW',direction:'UP',heuristicScore:71}
};
const ms=MS.build(out);
ok(ms.schema==='MarketState/v1','MarketState schema');
ok(ms.technical.bbma.zone===loc.zone,'technical.bbma READ from the engine (not recomputed)');
ok(ms.technical.bbma.heuristicScore===71,'one-step heuristicScore carried');
ok(ms.technical.sessions===ny,'sessions = the session-engine summary (single source)');
ok(ms.decision.direction==='UP','decision.direction READ from lifecycle (single authority)');
ok(ms.decision.stage==='EVIDENCE_COMPLETE','decision.stage from lifecycle');
ok(ms.decision.evidenceScore===88.5,'confidence score carried');
ok(ms.decision.publishable===false,'NOT publishable until stage reaches ALERT (no self-promote)');
ok(ms.research&&ms.research.oneStep.status==='PENDING_SHADOW','one-step shadow CARRIED separately from the decision');
ok(Object.isFrozen(ms),'MarketState is frozen (immutable)');
/* the point: a renderer needs ONLY ms.decision + ms.technical — no direction logic */
ok(ms.decision.direction!=='BUY'&&ms.decision.direction!=='SELL','decision.direction is a neutral direction (UP/DOWN/RANGE), never BUY/SELL — renderers add the label, not the engine');

console.log('PASS: session-engine + market-state — DST-safe first-completed-candle engine (US 13:30 EST / 12:30 EDT, Tokyo 00:00 UTC, no all-year hardcode), locked opening-range zone + reaction, and ONE frozen MarketState/v1 that renders from the single-authority lifecycle (decision + technical only, no recomputation, one-step shadow separated).',pass,'assertions');
