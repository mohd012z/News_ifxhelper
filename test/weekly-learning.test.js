'use strict';
const assert=require('assert'),W=require('../lib/weekly-learning');
const chain=W.buildChain([
 {stage:'THU_OPEN',time:'2026-09-17T00:00:00Z',price:100},
 {stage:'THU_CLOSE',time:'2026-09-17T23:00:00Z',price:105},
 {stage:'FRI_OPEN',time:'2026-09-18T00:00:00Z',price:104},
 {stage:'FRI_CLOSE',time:'2026-09-18T23:00:00Z',price:108}
]);
assert.equal(chain.state,'COMPLETE');assert.equal(chain.moves.thuOpenToClose.pct,5);assert.equal(chain.moves.thuCloseToFriOpen.direction,'DOWN');assert.equal(chain.moves.friOpenToClose.direction,'UP');assert.equal(chain.moves.thuOpenToW1Close.pct,8);
const history=[];for(let i=0;i<30;i++)history.push({id:'x'+i,symbol:'XAUUSD',timeframe:'M30',dayOfWeek:'THURSDAY',weekOfMonth:i<15?3:1,newsMode:'POST_NEWS',eventCategory:'CPI',bbLocation:'TOP_BB',bbmaPattern:'EXTREME_HIGH',atrRegime:'HIGH',squeezeState:'EXPANDING',mtfState:'MIXED',crossAssetState:'CONFLICT',outcome:i%3===0?'EXTEND':'RETRACE',time:`2026-${String(1+(i%9)).padStart(2,'0')}-17T00:00:00Z`});
const idx=W.buildIndex(history);const q={symbol:'XAUUSD',timeframe:'M30',dayOfWeek:'THURSDAY',weekOfMonth:3,newsMode:'POST_NEWS',bbLocation:'TOP_BB',bbmaPattern:'EXTREME_HIGH',atrRegime:'HIGH'};
const found=W.match(idx,q);assert.equal(found.length,15);const s=W.summarize(found);assert.equal(s.sampleSize,15);assert.equal(s.quality,'THIN');assert(s.outcomes.EXTEND>0);assert(s.outcomes.RETRACE>0);
const enough=W.summarize(history);assert.equal(enough.quality,'GOOD');assert.equal(enough.sampleSize,30);
console.log('weekly learning tests passed');
