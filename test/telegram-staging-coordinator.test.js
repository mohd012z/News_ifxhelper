'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {stageDraft,transition}=require('../lib/telegram-staging-coordinator');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'telegram-stage-'));
const file=path.join(dir,'ledger.json');
try {
 const now=Date.parse('2026-11-03T12:00:00Z');
 const draft={key:'event:1',text:'Verified event review'};
 assert.equal(stageDraft(file,draft).status,'pending-approval');
 assert.equal(stageDraft(file,draft).status,'pending-approval');
 assert.throws(()=>transition(file,draft.key,'reserve',{attemptId:'1',nowMs:now}));
 assert.equal(transition(file,draft.key,'approve',{reviewer:'operator',nowMs:now}).status,'approved');
 assert.equal(transition(file,draft.key,'reserve',{attemptId:'1',nowMs:now}).status,'in-flight');
 assert.equal(transition(file,draft.key,'recover').status,'uncertain');
 assert.throws(()=>transition(file,draft.key,'reserve',{attemptId:'2',nowMs:now}));
 assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).jobs.length,1);
 console.log('Telegram staging coordinator checks passed');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
