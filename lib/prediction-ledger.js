'use strict';
/* Prediction ledger (spec §6) — IMMUTABLE, hash-chained.
 *
 * Every forecast gets an append-only record. Immutability is enforced by a
 * CONTENT-HASH CHAIN: each line carries the sha256 of (previous line's hash +
 * canonical payload). Any retro-edit of an earlier line breaks the chain and
 * is detected by verify(). Outcomes are APPENDED as SETTLEMENT records that
 * reference the prediction id — the original prediction is never rewritten.
 *
 *   {seq, ts, type, id, prevHash, hash, payload}
 *
 * This is the replay/falsification substrate: you can always re-derive what the
 * system predicted, when, under which state, and what actually happened.
 */
var fs=(typeof require!=='undefined')?require('fs'):null;
var path=(typeof require!=='undefined')?require('path'):null;
var crypto=(typeof require!=='undefined')?require('crypto'):null;
function canon(v){if(v&&typeof v==='object'){if(Array.isArray(v))return '['+v.map(canon).join(',')+']';return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+canon(v[k]);}).join(',')+'}';}return JSON.stringify(v);}
function hash(s){return crypto?crypto.createHash('sha256').update(s).digest('hex'):'0'.repeat(64);}
function lineHash(prevHash,payload){return hash(prevHash+'|'+canon(payload));}
/** In-memory ledger. */
function Ledger(){this.lines=[];this.byType={};}
Ledger.prototype._prev=function(){return this.lines.length?this.lines[this.lines.length-1].hash:'GENESIS';};
Ledger.prototype.append=function(type,payload){
  var seq=this.lines.length+1;
  var prev=this._prev();
  var h=lineHash(prev,payload);
  var line={seq:seq,ts:new Date().toISOString(),type:type,id:payload&&payload.id||('id'+seq),prevHash:prev,hash:h,payload:payload};
  this.lines.push(line);
  (this.byType[type]=this.byType[type]||[]).push(line);
  return line;
};
Ledger.prototype.get=function(id){for(var i=0;i<this.lines.length;i++)if(this.lines[i].id===id)return this.lines[i];return null;};
Ledger.prototype.by=function(type){return (this.byType[type]||[]).slice();};
Ledger.prototype.last=function(){return this.lines[this.lines.length-1]||null;};
Ledger.prototype.verify=function(){
  var prev='GENESIS';
  for(var i=0;i<this.lines.length;i++){
    var l=this.lines[i];
    if(l.prevHash!==prev)return {ok:false,brokenAt:l.seq,reason:'prevHash mismatch'};
    if(lineHash(prev,l.payload)!==l.hash)return {ok:false,brokenAt:l.seq,reason:'hash mismatch'};
    prev=l.hash;
  }
  return {ok:true,lines:this.lines.length};
};
Ledger.prototype.serialize=function(){return this.lines.map(function(l){return JSON.stringify(l);}).join('\n')+'\n';};
Ledger.prototype.size=function(){return this.lines.length;};
/** Persist to a JSONL file (append-only on disk). */
function load(file){
  var L=new Ledger();
  if(fs&&file&&fs.existsSync(file)){
    fs.readFileSync(file,'utf8').split(/\r?\n/).forEach(function(line){
      if(!line.trim())return;
      try{var o=JSON.parse(line);L.lines.push(o);(L.byType[o.type]=L.byType[o.type]||[]).push(o);}catch(e){}
    });
  }
  L.file=file||null;
  return L;
}
function save(file){
  var L=load(file);
  return L;
}
function appendToFile(file,type,payload){
  var L=load(file);
  var line=L.append(type,payload);
  if(fs&&file)fs.appendFileSync(file,JSON.stringify(line)+'\n');
  return line;
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMALedger=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {Ledger:Ledger,load:load,appendToFile:appendToFile,lineHash:lineHash,canon:canon};});
