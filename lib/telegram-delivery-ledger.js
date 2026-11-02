'use strict';
const fs=require('node:fs');
const path=require('node:path');
// Atomic single-writer JSON ledger. Caller must serialize concurrent writers externally.
function loadLedger(filename) {
 try {
  const data=JSON.parse(fs.readFileSync(filename,'utf8'));
  if(!data||data.version!==1||!Array.isArray(data.jobs))throw Error('Invalid ledger schema');
  return data;
 } catch(e) {if(e.code==='ENOENT')return {version:1,jobs:[]};throw e;}
}
function saveLedger(filename,ledger) {
 if(!ledger||ledger.version!==1||!Array.isArray(ledger.jobs))throw Error('Invalid ledger schema');
 const dir=path.dirname(filename);
 fs.mkdirSync(dir,{recursive:true});
 const temp=path.join(dir,'.'+path.basename(filename)+'.'+process.pid+'.tmp');
 try {
  const fd=fs.openSync(temp,'wx',0o600);
  try {fs.writeFileSync(fd,JSON.stringify(ledger,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,filename);
  const dirFd=fs.openSync(dir,'r');try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
 } catch(e){try{fs.unlinkSync(temp);}catch{}throw e;}
}
function upsertJob(ledger,job) {
 if(!job||typeof job.key!=='string'||!job.key)throw Error('Job key required');
 const jobs=ledger.jobs.filter(x=>x.key!==job.key);
 return {version:1,jobs:[...jobs,job]};
}
module.exports={loadLedger,saveLedger,upsertJob};
