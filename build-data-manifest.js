'use strict';
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const ROOT=__dirname;
const targets=['news-auto.js','macro-auto.js','atr.js','xauusd-data.js'];
function meta(name){
 const p=path.join(ROOT,name);
 if(!fs.existsSync(p)) return {file:name,available:false};
 const b=fs.readFileSync(p);
 return {file:name,available:true,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex'),modifiedAt:fs.statSync(p).mtime.toISOString()};
}
const files=targets.map(meta);
const out={
 schemaVersion:1,
 generatedAt:new Date().toISOString(),
 files,
 freshness:{newsMaxMinutes:45,macroMaxMinutes:45,atrMaxMinutes:1560},
 fallbackOrder:['remote-current','local-cache','bundled-snapshot'],
 policy:'Remote data must validate before replacing local cache. Bundled data is fallback only.'
};
fs.writeFileSync(path.join(ROOT,'data-manifest.json'),JSON.stringify(out,null,2)+'\n');
console.log('data-manifest.json generated:',out.generatedAt);
