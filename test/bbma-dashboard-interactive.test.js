'use strict';
const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('bbma-dashboard-ui.js','utf8');
['bbma-filter','bbma-news','bbma-patterns','bbma-timeline','bbma-detail','data-tf','data-pattern','MYT','REENTRY','CSA','MHV','EXTREME'].forEach(x=>assert(s.includes(x),'missing '+x));
assert(s.includes("addEventListener('click'"),'interactive click handling missing');
console.log('interactive BBMA dashboard contract passed');
