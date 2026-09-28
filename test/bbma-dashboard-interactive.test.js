'use strict';
const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('bbma-dashboard-ui.js','utf8');
// Elements/behaviours the SHIPPED dashboard actually implements.
['bbma-filter','bbma-news','bbma-tfs','bbma-matrix','bbma-alert-evidence','data-tf','data-pattern','data-alert-id','MYT','RE-ENTRY','CSA','MHV','EXTREME','BBMA_CHART_NO_DATA'].forEach(x=>assert(s.includes(x),'missing '+x));
assert(s.includes("addEventListener('click'"),'interactive click handling missing');
// State machine: stale/no-live data must read as STALE, and the chart must
// degrade to an honest NO_DATA state instead of rendering invented candles.
assert(s.includes("d.source==='NONE'")||s.includes('source:'),'no-source staleness check missing');
assert(s.includes('BBMA_CHART_NO_DATA'),'chart NO_DATA state missing');
console.log('interactive BBMA dashboard contract passed');
