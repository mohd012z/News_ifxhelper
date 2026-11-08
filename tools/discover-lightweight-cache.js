'use strict';
/* Read-only recovery inventory. Never promotes unverified cached bytes to trusted vendor assets. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const file='lightweight-charts.standalone.production.js';
function sha256(b){return crypto.createHash('sha256').update(b).digest('hex');}
function inspect(candidate){
 try{
  const real=fs.realpathSync(candidate);
  const st=fs.statSync(real);
  if(!st.isFile()||st.size<10000||st.size>5000000)return null;
  const b=fs.readFileSync(real);
  return {path:real,bytes:b.length,sha256:sha256(b),status:'UNTRUSTED_CANDIDATE'};
 }catch{return null;}
}
function discover(root=path.resolve(__dirname,'..'),home=os.homedir()){
 const paths=[
  path.join(root,'node_modules/lightweight-charts/dist',file),
  path.join(root,'vendor/lightweight-charts/5.2.0',file),
  path.join(root,'www/vendor/lightweight-charts/5.2.0',file),
  path.join(home,'.npm/_cacache'),
  path.join(home,'.cache/yarn'),
  path.join(home,'.local/share/pnpm/store'),
 ];
 const results=[];
 for(const p of paths){
  if(p.endsWith(file)){const hit=inspect(p);if(hit)results.push(hit);}
  else if(fs.existsSync(p))results.push({path:p,status:'CACHE_DIRECTORY_PRESENT_REQUIRES_PACKAGE_INTEGRITY_LOOKUP'});
 }
 return results;
}
if(require.main===module){
 const results=discover();
 console.log(JSON.stringify({package:'lightweight-charts',version:'5.2.0',verified:false,results},null,2));
 if(!results.length)console.error('No direct candidate or known cache directory found; no asset recovered');
}
module.exports={discover,inspect};
