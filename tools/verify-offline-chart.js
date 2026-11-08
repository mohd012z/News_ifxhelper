'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),name='lightweight-charts.standalone.production.js';
function verify(rootDir=root){
 const dir=path.join(rootDir,'vendor/lightweight-charts/5.2.0');
 const web=path.join(rootDir,'www/vendor/lightweight-charts/5.2.0');
 const expected=fs.readFileSync(path.join(rootDir,'vendor/lightweight-charts/5.2.0/integrity.json'),'utf8');
 const trusted=JSON.parse(expected);
 assert.match(trusted.sha256,/^[a-f0-9]{64}$/,'missing trusted SHA-256');
 for(const base of [dir,web]){
  const meta=JSON.parse(fs.readFileSync(path.join(base,'integrity.json'),'utf8'));
  const bytes=fs.readFileSync(path.join(base,name));
  assert.equal(meta.name,'lightweight-charts');
  assert.equal(meta.version,'5.2.0');
  assert.equal(meta.license,'Apache-2.0');
  assert(bytes.length>10000);
  assert.equal(meta.bytes,bytes.length);
  assert.equal(meta.sha256,trusted.sha256,'vendor manifest digest mismatch');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),trusted.sha256,'vendor asset digest mismatch');
  assert(fs.readFileSync(path.join(base,'LICENSE'),'utf8').includes('Apache License'));
  assert(fs.readFileSync(path.join(base,'NOTICE'),'utf8').includes('TradingView'));
 }
 assert(fs.readFileSync(path.join(dir,name)).equals(fs.readFileSync(path.join(web,name))),'Android asset differs from vendor asset');
 const html=fs.readFileSync(path.join(rootDir,'www/index.html'),'utf8');
 assert(html.includes('vendor/lightweight-charts/5.2.0/'+name));
 assert(html.includes('https://www.tradingview.com/'));
 assert(html.includes('TradingView'),'visible creator attribution missing');
 return true;
}
if(require.main===module){try{verify();console.log('OFFLINE_CHART_READY: vendor, attribution, integrity and Android www asset verified');}catch(e){console.error('OFFLINE_CHART_NOT_READY: '+e.message);process.exitCode=1;}}
module.exports={verify};
