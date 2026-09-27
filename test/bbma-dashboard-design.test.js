'use strict';
const fs=require('fs'),assert=require('assert');const s=fs.readFileSync('bbma-dashboard-ui.js','utf8');
['bbma-market','bbma-chart','bbma-matrix','bbma-proximity','bbma-indicators','bbma-quick-alerts','bbma-guide','BBMA × NEWS','EVENT TIMELINE','MYT (UTC+8)','M5','MN1','RE-ENTRY','CSA','MHV','EXTREME'].forEach(x=>assert(s.includes(x),'missing '+x));
assert(s.includes('data-tf=')||s.includes('data-tf="'),'timeframe interaction missing');
assert(s.includes("addEventListener('click'"),'click interaction missing');
console.log('BBMA visual command dashboard contract passed');
