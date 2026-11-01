'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {classifyTelegramOutcome:c}=require('../telegram/delivery-outcomes.js');
test('confirmed ack is sent',()=>{assert.deepEqual(c(200,true),{ok:true});assert.deepEqual(c(201,true),{ok:true});});
test('network exception or unreadable 2xx receipt is uncertain',()=>{assert.equal(c(0,false,true).uncertain,true);assert.equal(c(200,false).uncertain,true);});
test('5xx status is uncertain',()=>{for(const n of [500,502,503,504])assert.equal(c(n,false).uncertain,true);});
test('429 is rate-limited and retryable',()=>{assert.deepEqual(c(429,false),{ok:false,rateLimited:true});});
test('400/403 are definite reject statuses',()=>{assert.deepEqual(c(400,false),{ok:false});assert.deepEqual(c(403,false),{ok:false});});
test('uncertain deliveries are not stored as confirmed',()=>{const src=fs.readFileSync('telegram-notify.js','utf8');assert.match(src,/state\.uncertainKeys = Array\.from\(uncertain\)/);assert.match(src,/if \(seen\.has\(key\) \|\| uncertain\.has\(key\)\) return/);assert.match(src,/UNCERTAIN photo acceptance; no immediate text fallback/);});
