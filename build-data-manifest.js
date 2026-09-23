'use strict';
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const ROOT=__dirname;
const targets=[
  'news-auto.js','macro-auto.js','atr.js','xauusd-data.js',
  'data/bbma-watch.json','data/bbma-learning.json','data/bbma-performance.json',
  'data/agent-health.json','data/intelligence-360.json',
  'data/intelligence-weekly.json','data/intelligence-monthly.json'
];
function meta(name){
 const p=path.join(ROOT,name);
 if(!fs.existsSync(p)) return {file:name,available:false};
 const b=fs.readFileSync(p);
 let lineage=null;
 if(name.endsWith('.json')){
   try{const x=JSON.parse(b.toString('utf8'));lineage={generationId:x.generationId||null,generatedAt:x.generatedAt||null,sourceGeneratedAt:x.sourceGeneratedAt||null};}catch{lineage={invalidJson:true};}
 }
 return {file:name,available:true,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex'),modifiedAt:fs.statSync(p).mtime.toISOString(),...(lineage?{lineage}:{})};
}
const files=targets.map(meta);
const out={
 schemaVersion:2,
 generatedAt:new Date().toISOString(),
 files,
 freshness:{newsMaxMinutes:45,macroMaxMinutes:45,atrMaxMinutes:1560,bbmaMaxMinutes:30,intelligenceMaxMinutes:90,healthMaxMinutes:1560},
 fallbackOrder:['remote-current','local-cache','bundled-snapshot'],
 policy:'Remote data must validate freshness and lineage before replacing local cache. Bundled data is fallback only.'
};
fs.writeFileSync(path.join(ROOT,'data-manifest.json'),JSON.stringify(out,null,2)+'\n');
console.log('data-manifest.json generated:',out.generatedAt,'targets=',files.length);
