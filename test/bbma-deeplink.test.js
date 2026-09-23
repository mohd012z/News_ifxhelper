'use strict';
const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('bbma-link.js','utf8');
['xau-desk://bbma','open','bbma','alertId','tf','symbol','myt','URLSearchParams','location'].forEach(x=>assert(s.includes(x),'missing '+x));
const prep=fs.readFileSync('tools/prepare-web.js','utf8');
assert(prep.includes("'bbma-link.js'"),'bbma-link.js missing from APK copy list');
assert(prep.includes('<script src="./bbma-link.js"></script>'),'bbma-link.js injection missing');
assert(prep.includes('<script src="./bbma-dashboard-ui.js"></script>'),'BBMA dashboard injection missing');
console.log('BBMA deep-link packaging contract passed');
