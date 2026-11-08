'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const dir=path.join(root,'vendor/lightweight-charts/5.2.0');
const web=path.join(root,'www/vendor/lightweight-charts/5.2.0');
const name='lightweight-charts.standalone.production.js';
function fail(message){console.error('OFFLINE_CHART_NOT_READY: '+message);process.exitCode=1;}
try{
 for(const base of [dir,web]){
  const meta=JSON.parse(fs.readFileSync(path.join(base,'integrity.json'),'utf8'));
  const bytes=fs.readFileSync(path.join(base,name));
  assert.equal(meta.name,'lightweight-charts');
  assert.equal(meta.version,'5.2.0');
  assert.equal(meta.license,'Apache-2.0');
  assert(bytes.length>10000);
  assert.equal(meta.bytes,bytes.length);
  assert.equal(meta.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
  assert(fs.readFileSync(path.join(base,'LICENSE'),'utf8').includes('Apache License'));
  assert(fs.readFileSync(path.join(base,'NOTICE'),'utf8').includes('TradingView'));
 }
 const a=fs.readFileSync(path.join(dir,name));
 const b=fs.readFileSync(path.join(web,name));
 assert(a.equals(b),'Android asset differs from vendor asset');
 const html=fs.readFileSync(path.join(root,'www/index.html'),'utf8');
 assert(html.includes('vendor/lightweight-charts/5.2.0/'+name));
 assert(html.includes('https://www.tradingview.com/'));
 console.log('OFFLINE_CHART_READY: vendor, attribution, integrity and Android www asset verified');
}catch(e){fail(e.message);}
