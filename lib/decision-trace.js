'use strict';
/* Structured decision trace (spec §12). One append-only, hash-chained log of a
 * single decision so /codeview can reconstruct the WHOLE path:
 *   INGEST -> VALIDATE -> BBMA -> NEWS -> FAST_THINK -> RECALL -> IN_AI ->
 *   FALSIFY -> KERNEL -> PREDICT -> OBSERVE -> SETTLE -> LEARN -> CORRECT
 * Each line: { seq, traceId, stage, ts, inputHash, output, latencyMs,
 *   source, quality, generation, error, prevHash, hash }.
 * The trace is the audit spine: it proves which stage produced what, from
 * which input hash, at what quality — replacing "AI thinks gold may rise".
 */
var fs=(typeof require!=='undefined')?require('fs'):null;
var crypto=(typeof require!=='undefined')?require('crypto'):null;
var STAGES=['INGEST','VALIDATE','BBMA','NEWS','FAST_THINK','RECALL','IN_AI','FALSIFY','KERNEL','PREDICT','OBSERVE','SETTLE','LEARN','CORRECT'];
function canon(v){if(v&&typeof v==='object'){if(Array.isArray(v))return '['+v.map(canon).join(',')+']';return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+canon(v[k]);}).join(',')+'}';}return JSON.stringify(v);}
function hash(s){return crypto?crypto.createHash('sha256').update(s).digest('hex'):'0'.repeat(64);}
function lineHash(prevHash,stage,payload){return hash(prevHash+'|'+stage+'|'+canon(payload));}
function Trace(traceId,generation){this.traceId=traceId;this.generation=generation||null;this.lines=[];}
Trace.prototype._prev=function(){return this.lines.length?this.lines[this.lines.length-1].hash:'GENESIS';};
Trace.prototype.append=function(stage,payload){
  if(STAGES.indexOf(stage)<0)throw new Error('unknown trace stage: '+stage);
  var seq=this.lines.length+1,prev=this._prev();
  var p=payload||{};
  var line={seq:seq,traceId:this.traceId,stage:stage,ts:new Date().toISOString(),
    inputHash:p.inputHash||null,output:(p.output!==undefined)?p.output:null,
    latencyMs:(p.latencyMs!=null)?p.latencyMs:null,source:p.source||null,
    quality:p.quality||null,generation:p.generation||this.generation,error:p.error||null,
    payload:p,prevHash:prev,hash:lineHash(prev,stage,p)};
  this.lines.push(line);return line;
};
Trace.prototype.stages=function(){return this.lines.map(function(l){return l.stage;});};
Trace.prototype.at=function(stage){for(var i=0;i<this.lines.length;i++)if(this.lines[i].stage===stage)return this.lines[i];return null;};
Trace.prototype.verify=function(){
  var prev='GENESIS';
  for(var i=0;i<this.lines.length;i++){var l=this.lines[i];
    if(l.prevHash!==prev)return {ok:false,brokenAt:l.seq,stage:l.stage,reason:'prevHash mismatch'};
    if(!l.payload)return {ok:false,brokenAt:l.seq,stage:l.stage,reason:'payload missing'};
    if(lineHash(prev,l.stage,l.payload)!==l.hash)return {ok:false,brokenAt:l.seq,stage:l.stage,reason:'hash mismatch'};
    prev=l.hash;}
  return {ok:true,lines:this.lines.length};
};
Trace.prototype.serialize=function(){return this.lines.map(function(l){return JSON.stringify(l);}).join('\n')+'\n';};
Trace.prototype.reconstruct=function(){ /* /codeview: human-readable path */
  return this.lines.map(function(l){
    var o=(l.output!==undefined&&l.output!==null)?(typeof l.output==='object'?canon(l.output).slice(0,80):String(l.output)):'—';
    return 'SEQ '+l.seq+' ['+l.stage+'] '+(l.quality||'')+(l.source?(' src='+l.source):'')+(l.error?(' ERROR='+l.error):'')+' -> '+o;
  }).join('\n');
};
function load(file){
  var t=null;
  if(fs&&file&&fs.existsSync(file)){
    fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).forEach(function(l){try{var o=JSON.parse(l);t=t||new Trace(o.traceId,o.generation);t.lines.push(o);}catch(e){}});
    if(t)t.file=file;
  }
  return t;
}
function appendToFile(file,traceId,stage,payload){
  var t=load(file)||new Trace(traceId);
  if(t.file==null)t.file=file;
  var line=t.append(stage,payload);
  if(fs&&file)fs.appendFileSync(file,JSON.stringify(line)+'\n');
  return line;
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMATrace=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {STAGES:STAGES,Trace:Trace,load:load,appendToFile:appendToFile,lineHash:lineHash,canon:canon};});
