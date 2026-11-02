'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {loadLedger,saveLedger,upsertJob}=require('../lib/telegram-delivery-ledger');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'telegram-ledger-'));
try {
 const file=path.join(dir,'state.json');
 assert.deepEqual(loadLedger(file),{version:1,jobs:[]});
 let state=upsertJob(loadLedger(file),{key:'a',status:'pending-approval'});
 saveLedger(file,state);
 assert.equal(loadLedger(file).jobs.length,1);
 state=upsertJob(loadLedger(file),{key:'a',status:'approved'});
 saveLedger(file,state);
 assert.equal(loadLedger(file).jobs.length,1);
 assert.equal(loadLedger(file).jobs[0].status,'approved');
 assert.throws(()=>saveLedger(file,{version:0,jobs:[]}));
 fs.writeFileSync(file,'{bad json');
 assert.throws(()=>loadLedger(file),SyntaxError);
 console.log('Telegram atomic ledger checks passed');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
