'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {stageVerifiedAlerts}=require('../lib/telegram-review-queue');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'telegram-review-'));
try {
 const file=path.join(dir,'ledger.json');
 assert.deepEqual(stageVerifiedAlerts(file,[],Date.parse('2026-11-03T12:00:00Z')),[]);
 assert.equal(fs.existsSync(file),false);
 assert.throws(()=>stageVerifiedAlerts(file,null,0),TypeError);
 console.log('Telegram review queue empty and invalid-input checks passed');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
