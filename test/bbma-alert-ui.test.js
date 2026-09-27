'use strict';
const fs=require('fs'),assert=require('assert');const s=fs.readFileSync('bbma-dashboard-ui.js','utf8');
['bbma-alert-hero','bbma-alert-strip','bbma-alert-evidence','bbma-alert-action','bbma-alert-history','TIME_CONFLICT','STALE','BLOCKED','PRE-EVENT','POST-EVENT','RE-ENTRY','CSA','MHV','EXTREME','MYT (UTC+8)'].forEach(x=>assert(s.includes(x),'missing '+x));
assert(s.includes("data-alert-id"),'alert drilldown id missing');
console.log('BBMA alert UI contract passed');
