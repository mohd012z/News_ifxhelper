'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {verify}=require('../tools/verify-offline-chart.js');
const name='lightweight-charts.standalone.production.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-chart-negative-'));
const source=path.join(root,'vendor/lightweight-charts/5.2.0'),web=path.join(root,'www/vendor/lightweight-charts/5.2.0');
function hash(x){return crypto.createHash('sha256').update(x).digest('hex');}
function seed(){
 fs.rmSync(root,{recursive:true,force:true});
 for(const d of [source,web]){
  fs.mkdirSync(d,{recursive:true});
  const bytes=Buffer.alloc(12000,65);
  fs.writeFileSync(path.join(d,name),bytes);
  fs.writeFileSync(path.join(d,'LICENSE'),'Apache License Version 2.0');
  fs.writeFileSync(path.join(d,'NOTICE'),'TradingView attribution notice');
  fs.writeFileSync(path.join(d,'integrity.json'),JSON.stringify({name:'lightweight-charts',version:'5.2.0',license:'Apache-2.0',bytes:bytes.length,sha256:hash(bytes)}));
 }
 fs.writeFileSync(path.join(root,'www/index.html'),'<a href="https://www.tradingview.com/">TradingView</a><script src="vendor/lightweight-charts/5.2.0/'+name+'"></script>');
}
function rejects(label,mutate){
 seed();mutate();
 assert.throws(()=>verify(root),undefined,label);
}
try{
 seed();assert.equal(verify(root),true);
 rejects('missing vendor',()=>fs.rmSync(source,{recursive:true,force:true}));
 rejects('missing Android asset',()=>fs.rmSync(path.join(web,name)));
 rejects('tampered vendor',()=>fs.appendFileSync(path.join(source,name),'x'));
 rejects('tampered Android asset',()=>fs.appendFileSync(path.join(web,name),'x'));
 rejects('forged vendor digest',()=>{for(const d of [source,web]){const p=path.join(d,'integrity.json'),m=JSON.parse(fs.readFileSync(p));m.sha256='0'.repeat(64);fs.writeFileSync(p,JSON.stringify(m));}});
 rejects('missing NOTICE',()=>fs.rmSync(path.join(web,'NOTICE')));
 rejects('missing license',()=>fs.rmSync(path.join(source,'LICENSE')));
 rejects('missing attribution',()=>fs.writeFileSync(path.join(root,'www/index.html'),'<script src="vendor/lightweight-charts/5.2.0/'+name+'"></script>'));
 console.log('Offline chart negative cases: 8/8 passed; fixtures are synthetic, not authenticated vendor assets');
}finally{fs.rmSync(root,{recursive:true,force:true});}
