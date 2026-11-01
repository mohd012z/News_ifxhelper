'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('bbma-research-dashboard.html','utf8');
test('standalone labeled BBMA dashboard requires no external CDNs',()=>{
 assert.match(html,/BBMA · Research Dashboard/);
 assert.doesNotMatch(html,/https:\/\/(?:unpkg|cdn)/);
 assert.match(html,/HISTORICAL · NO LIVE FEED/);
});
test('nine timeframes and source provenance labels are present',()=>{
 for(const tf of ['M1','M5','M15','M30','H1','H4','D1','W1','MN1'])assert.match(html,new RegExp(tf));
 for(const str of ['LWMA5 High','LWMA10 High','LWMA5 Low','LWMA10 Low','EMA50','Upper BB','Mid BB','Lower BB','sourceTime','REENTRY_DOWN_ZONE'])assert(html.includes(str),str);
});
test('OHLC imports reject synthetic baselines and incomplete bars',()=>{
 assert.match(html,/Synthetic candle rejected/);
 assert.match(html,/Duplicate candle timestamp/);
 assert.match(html,/if\(time\+dst>asOf\|\|bars.length!==expected\)continue/);
});
test('historical replay only uses completed bars',()=>{
 assert.match(html,/rows.filter\(c=>c.time\+span<=asOf\)/);
 assert.match(html,/asOf=rows\[idx\].time\+core.TF_SECONDS\[frame\]/);
});
test('browser page is syntax-parseable and mobile-safe',()=>{
 const blocks=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(Boolean);
 assert.equal(blocks.length,3);for(const b of blocks)new vm.Script(b);
 assert.match(html,/viewport-fit=cover/);assert.match(html,/safe-area-inset-top/);
 assert.match(html,/id="scanner"/);assert.match(html,/id="replay"/);assert.match(html,/id="file"/);
});
test('dashboard linked and packaged for local APK assets',()=>{
 const ui=fs.readFileSync('bbma-dashboard-ui.js','utf8');
 const prep=fs.readFileSync('tools/prepare-web.js','utf8');
 assert.match(ui,/bbma-research-dashboard.html/);
 assert.match(prep,/bbma-research-dashboard.html/);
});
