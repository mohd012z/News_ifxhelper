'use strict';
const fs=require('fs'),assert=require('assert');
const s=fs.readFileSync('bbma-link.js','utf8');
['xau-desk://bbma','open','bbma','alertId','tf','symbol','myt','URLSearchParams','location'].forEach(x=>assert(s.includes(x),'missing '+x));
const prep=fs.readFileSync('tools/prepare-web.js','utf8');
// bbma-link.js must be in the APK copy list
assert(prep.includes("'bbma-link.js'"),'bbma-link.js missing from APK copy list');
// prepare-web builds the <script> tag dynamically per file, so assert on the
// injection array (the list feeding the forEach that appends script tags)
// rather than a literal rendered tag string.
assert(prep.includes("<script src=\"./'+f+'\"></script>"),'prepare-web dynamic <script> injection missing');
const injectionArray=(prep.match(/(\[[^\]]*\])\.forEach\(function\(f\)\{if\(!html\.includes\(f\)\)/)||[])[1]||'';
assert(injectionArray.includes("bbma-link.js"),'bbma-link.js not in prepare-web script-injection list');
assert(injectionArray.includes("bbma-dashboard-ui.js"),'bbma-dashboard-ui.js not in prepare-web script-injection list');
console.log('BBMA deep-link packaging contract passed');
