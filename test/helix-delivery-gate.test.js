'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const G=require('../lib/helix-delivery-gate');
const now=Date.parse('2026-11-07T00:00:00Z');
const preview={mode:'PREVIEW_ONLY',destination:'@ifxhelper2',parse_mode:'HTML',text:'<b>Research</b>'};
function report(){return {kind:'RESEARCH_ONLY',asOf:new Date(now-1000).toISOString(),timeframes:Object.fromEntries(['H4','H1','M15','M5'].map(tf=>[tf,{state:'READY',closedCandles:55,latestClosedOpen:new Date(now-3600000).toISOString(),bbma:{state:'READY'},zones:[]}]))};}
test('stable fingerprint deduplicates identical preview and rejects changed channel',()=>{
 assert.equal(G.fingerprint(preview),G.fingerprint({...preview}));
 assert.throws(()=>G.fingerprint({...preview,destination:'@other'}));
 assert.notEqual(G.fingerprint(preview),G.fingerprint({...preview,text:'changed'}));
});
test('missing, stale and future evidence fail closed',()=>{
 assert.equal(G.validateEvidence(report(),now),true);
 const x=report();delete x.timeframes.H4;assert.throws(()=>G.validateEvidence(x,now));
 const y=report();y.asOf='2026-01-01T00:00:00Z';assert.throws(()=>G.validateEvidence(y,now));
 const z=report();z.timeframes.M15.latestClosedOpen=new Date(now+1000).toISOString();assert.throws(()=>G.validateEvidence(z,now));
});
test('approval is bound to hash, actor and bounded expiry',()=>{
 const r=G.prepare(report(),preview,now);
 assert.equal(G.plan(r).action,'BLOCK');
 assert.throws(()=>G.approve(r,{reportHash:'wrong',actor:'reviewer',expiresAt:new Date(now+60000).toISOString()},now));
 const a=G.approve(r,{reportHash:r.reportHash,actor:'reviewer',expiresAt:new Date(now+60000).toISOString()},now);
 assert.equal(G.plan(a).action,'BLOCK');
 assert.equal(G.plan(a,{deliveryEnabled:true,now}).action,'ELIGIBLE_FOR_ATOMIC_LEASE');
 assert.equal(G.plan(a,{deliveryEnabled:true,now:now+60001}).reason,'APPROVAL_EXPIRED');
});
test('uncertain outcomes require reconciliation and never become retryable',()=>{
 for(const outcome of ['UNKNOWN','TIMEOUT','CONNECTION_LOST'])assert.equal(G.classifyAttempt(outcome),'UNCERTAIN');
 assert.equal(G.classifyAttempt('CONFIRMED_NOT_SENT'),'RETRY_WAIT');
 assert.equal(G.classifyAttempt('CONFIRMED_SUCCESS'),'DELIVERED');
 assert.throws(()=>G.classifyAttempt('anything'));
});
test('oversized or malformed Telegram preview cannot be approved',()=>{
 assert.throws(()=>G.fingerprint({...preview,text:'x'.repeat(4097)}));
 assert.throws(()=>G.fingerprint({...preview,parse_mode:'Markdown'}));
});
