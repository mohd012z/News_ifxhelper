'use strict';
/* Regression: APK remote sync froze on bundled snapshot after 2026-10-01 (5c97f4b).
 * Root cause: build-data-manifest.js writes schemaVersion 3, but the checkRemote
 * validator in app.js required exactly 1 -> every sync threw "Invalid data manifest"
 * -> news never updated on the installed APK. This test pins the validator rule
 * (static, app.js is a browser IIFE) AND validates it against the LIVE manifest on
 * main, so a future schema bump that outpaces the client fails here, not on a phone. */
const assert = require('assert'), fs = require('fs');

const src = fs.readFileSync(__dirname + '/../app.js', 'utf8');

// The old exact-pin is gone.
assert(!/schemaVersion\s*!==\s*1/.test(src), 'app.js still pins schemaVersion === 1 (frozen-APK bug)');
// The forward-compatible guard is present: lower + upper bound on a numeric version.
const guard = src.match(/manifest\.schemaVersion\s*<\s*(\d+)[\s\S]{0,80}?manifest\.schemaVersion\s*>\s*(\d+)/);
assert(guard, 'app.js has no bounded manifest.schemaVersion guard');
const MIN = Number(guard[1]), MAX = Number(guard[2]);
assert(MIN === 1, 'lower bound must stay 1 (old manifests remain valid)');
assert(MAX >= 3, 'upper bound must accept the schema the bot writes (>= 3)');
function accepted(v) { return typeof v === 'number' && v >= MIN && v <= MAX; }
assert(accepted(1) && accepted(2) && accepted(3), 'versions 1..3 must all be accepted');
assert(!accepted(MAX + 1) && !accepted('3') && !accepted(undefined), 'out-of-range / non-numeric must be rejected');

// LIVE PRODUCTION ARTIFACT: main's data-manifest.json must pass the client guard.
const live = JSON.parse(fs.readFileSync(__dirname + '/../.tmp-live-manifest.json', 'utf8'));
assert(live.generatedAt, 'live manifest has no generatedAt');
assert(accepted(live.schemaVersion), 'LIVE main manifest schemaVersion ' + live.schemaVersion + ' rejected by client guard — APK would freeze again');

console.log('apk remote sync schema test passed (live schemaVersion ' + live.schemaVersion + ' accepted)');
