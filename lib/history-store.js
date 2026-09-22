'use strict';
/**
 * Historical evidence store.
 * Append-only JSONL by UTC month; designed as a DB-ready adapter.
 * Records observations, not trade instructions.
 */
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..');
function clean(v){return v==null?null:String(v).trim();}
function idFor(x){return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);}
function monthPath(kind, when){
 const d=new Date(when||Date.now());
 const dir=path.join(ROOT,'data','history',String(d.getUTCFullYear()),String(d.getUTCMonth()+1).padStart(2,'0'));
 fs.mkdirSync(dir,{recursive:true});
 return path.join(dir,kind+'.jsonl');
}
function append(kind, record){
 const observedAt=record.observedAt||new Date().toISOString();
 const row=Object.assign({schemaVersion:1,kind,observedAt},record);
 row.id=row.id||idFor([kind,row.source||'',row.url||'',row.publishedAt||'',row.title||row.event||'',row.observedAt]);
 fs.appendFileSync(monthPath(kind,observedAt),JSON.stringify(row)+'\n');
 return row;
}
function eventRecord(e){
 return {
  source:e.source||null,sourceClass:e.sourceClass||'UNKNOWN',url:e.url||null,
  event:e.event||null,currency:e.currency||null,importance:e.importance||null,
  scheduledAt:e.timeGmt||null,actual:clean(e.actual),forecast:clean(e.forecast),previous:clean(e.previous),
  release:e.release||null,fetchedAt:e.fetchedAt||null
 };
}
function speechRecord(s){
 return {
  source:s.source||null,sourceClass:s.sourceClass||'OFFICIAL_SPEECH',url:s.url||null,
  speaker:s.speaker||s.name||null,title:s.title||null,quote:s.quote||null,
  publishedAt:s.publishedAt||s.time||null,stance:s.signal||s.stance||null,
  confidence:Number.isFinite(+s.confidence)?+s.confidence:null
 };
}
function stanceDelta(current, previous){
 const score=x=>{const s=String(x||'').toUpperCase();return s.includes('HAWK')?1:s.includes('DOV')?-1:0;};
 const d=score(current)-score(previous);
 return {current:current||'UNKNOWN',previous:previous||'UNKNOWN',delta:d,label:d>0?'MORE_HAWKISH':d<0?'MORE_DOVISH':'UNCHANGED_OR_UNCLEAR'};
}
module.exports={append,eventRecord,speechRecord,stanceDelta,monthPath};
