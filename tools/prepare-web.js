/* prepare-web.js - build the offline fallback bundle for Capacitor.
 * Runtime clients should prefer validated remote data, then local cache, then these bundled files.
 */
const fs=require('fs'), path=require('path');
const root=path.resolve(__dirname,'..'), out=path.join(root,'www');
const FILES=['index.html','trade-plan.html','app.js','bbma-dashboard-ui.js','bbma-link.js','trade-plan.js','live.js','shared-market-logic.js',
  'xauusd-data.js','atr.js','news-auto.js','macro-auto.js','data-manifest.json',
  'manifest.webmanifest','sw.js','pwa.js'];
const DIRS=['icons','lib'];
fs.rmSync(out,{recursive:true,force:true}); fs.mkdirSync(out,{recursive:true});
let n=0;
for(const f of FILES){const src=path.join(root,f);if(!fs.existsSync(src)){console.log('skip (missing): '+f);continue;}fs.copyFileSync(src,path.join(out,f));n++;}
function copyDir(src,dst){fs.mkdirSync(dst,{recursive:true});for(const ent of fs.readdirSync(src,{withFileTypes:true})){const s=path.join(src,ent.name),d=path.join(dst,ent.name);if(ent.isDirectory())copyDir(s,d);else{fs.copyFileSync(s,d);n++;}}}
for(const d of DIRS){const src=path.join(root,d);if(fs.existsSync(src))copyDir(src,path.join(out,d));}
/* APK-only enhancement: load dashboard first, then the query/deep-link router. */
const indexOut=path.join(out,'index.html');
if(fs.existsSync(indexOut)){
  let html=fs.readFileSync(indexOut,'utf8');
  const needle='<script src="./app.js"></script>';
  if(!html.includes(needle))throw new Error('prepare-web: app.js script marker missing');
  let extra='';
  if(!html.includes('bbma-dashboard-ui.js'))extra+='\n  <script src="./bbma-dashboard-ui.js"></script>';
  if(!html.includes('bbma-link.js'))extra+='\n  <script src="./bbma-link.js"></script>';
  html=html.replace(needle,needle+extra);
  fs.writeFileSync(indexOut,html);
}
console.log('www/ ready with '+n+' files -> '+out);
console.log('Bundled data is fallback. data-manifest.json identifies exactly what this APK contains.');
