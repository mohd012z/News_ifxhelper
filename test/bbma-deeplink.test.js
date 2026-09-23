'use strict';
const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('bbma-link.js','utf8');
['xau-desk://bbma','open=bbma','alertId','tf','symbol','myt','URLSearchParams','location'].forEach(x=>assert(s.includes(x),'missing '+x));
const html=fs.readFileSync('index.html','utf8');assert(html.includes('bbma-link.js'),'bbma-link.js not packaged');
console.log('BBMA deep-link contract passed');
