'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const P=require('../lib/helix-channel-research-preview');
const asOf='2026-11-07T00:00:00Z';
test('targets only expected channel and never emits delivery fields',()=>{
 const r=P.preview({},{asOf});
 assert.equal(r.destination,'@ifxhelper2');
 assert.equal(r.mode,'PREVIEW_ONLY');
 assert.equal(r.parse_mode,'HTML');
 assert.ok(!Object.hasOwn(r,'chat_id'));
 assert.ok(!Object.hasOwn(r,'token'));
 assert.ok(!Object.hasOwn(r,'reply_markup'));
 for(const tf of ['H4','H1','M15','M5'])assert.match(r.text,new RegExp(tf));
});
test('escapes adversarial symbol and zone text',()=>{
 const report={kind:'RESEARCH_ONLY',asOf,timeframes:{H4:{state:'READY',closedCandles:50,bbma:{trend:'UP'},zones:[{type:'RBR',side:'DEMAND',distal:99,proximal:100,status:'FRESH',confirmedAt:asOf,bbmaAtConfirmation:{state:'ALIGNED'}}]}},summary:{alignedDemand:1,alignedSupply:0,conflicts:0}};
 const r=P.format(report,{symbol:'<b>& malicious'});
 assert.ok(r.text.includes('&lt;b&gt;&amp; malicious'));
 assert.ok(!r.text.includes('<b>& malicious'));
 assert.match(r.text,/RBR/);
});
test('rejects forged non-research report',()=>{
 assert.throws(()=>P.format({kind:'LIVE',asOf,timeframes:{}}));
});
