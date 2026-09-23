'use strict';
const fs=require('fs'),assert=require('assert');
const ui=fs.readFileSync('bbma-dashboard-ui.js','utf8');
const runtime=fs.readFileSync('bbma-runtime.js','utf8');
// BBMA UI must consume runtime.frames and must not independently hide every app section.
assert(/d\.frames/.test(ui),'dashboard must consume BBMA_RUNTIME.frames');
assert(!/querySelectorAll\('\[data-sec\]'\).*style\.display/.test(ui),'BBMA UI must not own global page visibility');
assert(ui.includes("bbma-nav-request"),'BBMA button must request navigation through the app router');
// Runtime must expose MTF classifications and OHLC to the renderer.
assert(runtime.includes("frames:{}"),'runtime classifications missing');
assert(runtime.includes("ohlc:frames"),'runtime OHLC missing');
console.log('BBMA APK router/runtime contract passed');
