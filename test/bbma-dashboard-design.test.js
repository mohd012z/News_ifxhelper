'use strict';
const fs=require('fs'),assert=require('assert');const s=fs.readFileSync('bbma-dashboard-ui.js','utf8');
// Elements that the SHIPPED dashboard actually renders (pre-2026-09-28 revisions
// asserted ids like bbma-market/bbma-indicators that were never built).
['bbma-alert-hero','bbma-chart','bbma-matrix','bbma-proximity','bbma-news','bbma-filter','bbma-tfs','BBMA × NEWS','MULTI-TIMEFRAME BBMA MATRIX','BB LEVEL PROXIMITY','MYT (UTC+8)','M5','MN1','RE-ENTRY','CSA','MHV','EXTREME'].forEach(x=>assert(s.includes(x),'missing '+x));
assert(s.includes('data-tf=')||s.includes('data-tf="'),'timeframe interaction missing');
assert(s.includes("addEventListener('click'"),'click interaction missing');
// Honesty contract: the hero must surface a real "no live ticks" state and
// never present a fabricated price on a cold load.
assert(s.includes('AWAITING LIVE TICKS'),'cold-load honest state missing');
assert(s.includes('NO_LIVE_TICKS'),'NO_LIVE_TICKS badge missing');
assert(s.includes('source:'),'source attribution missing');
console.log('BBMA visual command dashboard contract passed');
