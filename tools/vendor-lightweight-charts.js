'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const file=path.join(root,'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js');
const out=path.join(root,'vendor/lightweight-charts/5.2.0');
function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}
function vendor(){
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'node_modules/lightweight-charts/package.json'),'utf8'));
 if(pkg.name!=='lightweight-charts'||pkg.version!=='5.2.0'||pkg.license!=='Apache-2.0')throw Error('UNVERIFIED_LIGHTWEIGHT_CHARTS_PACKAGE');
 const bytes=fs.readFileSync(file);if(bytes.length<10000)throw Error('INVALID_VENDOR_ASSET');
 const notice=fs.readFileSync(path.join(root,'node_modules/lightweight-charts/NOTICE'),'utf8');
 const license=fs.readFileSync(path.join(root,'node_modules/lightweight-charts/LICENSE'),'utf8');
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'lightweight-charts.standalone.production.js'),bytes);
 fs.writeFileSync(path.join(out,'NOTICE'),notice);
 fs.writeFileSync(path.join(out,'LICENSE'),license);
 const manifest={name:pkg.name,version:pkg.version,license:pkg.license,sha256:sha(bytes),bytes:bytes.length};
 fs.writeFileSync(path.join(out,'integrity.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
if(require.main===module){try{console.log(JSON.stringify(vendor()));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={sha,vendor};
