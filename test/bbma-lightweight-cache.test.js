'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {discover,inspect}=require('../tools/discover-lightweight-cache.js');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-lwc-discovery-'));
try{
 const p=path.join(root,'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js');
 fs.mkdirSync(path.dirname(p),{recursive:true});
 fs.writeFileSync(p,Buffer.alloc(12000,65));
 const found=discover(root,path.join(root,'empty-home'));
 assert.equal(found.length,1);
 assert.equal(found[0].status,'UNTRUSTED_CANDIDATE');
 assert.equal(found[0].sha256,crypto.createHash('sha256').update(Buffer.alloc(12000,65)).digest('hex'));
 fs.writeFileSync(p,'invalid');assert.equal(inspect(p),null);
 fs.rmSync(p);assert.equal(discover(root,path.join(root,'empty-home')).length,0);
 console.log('Read-only cache discovery: valid candidate, rejected short file, missing file PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
