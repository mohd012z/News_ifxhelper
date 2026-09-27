'use strict';
/** Empirical BB/EMA50 event-reaction history. No invented probability: rates come only from stored observations. */
const HORIZONS=['M1','M5','M15','M30','H1','H4'];
function n(v){return Number.isFinite(+v)?+v:null;}
function bucket(v,step){v=n(v);if(v==null)return 'NA';return String(Math.round(v/step)*step);}
function signature(x){
 const e=x.event||{}, t=x.technical||{};
 return [
  e.category||'UNKNOWN',e.importance||'UNKNOWN',e.surpriseDirection||'UNKNOWN',
  x.zone||'UNKNOWN',x.behavior||'UNKNOWN',x.mtfAlignment||'UNKNOWN',
  x.volatility||'UNKNOWN',bucket(t.atrPct,.1),bucket(t.bbWidthPct,.2)
 ].map(v=>String(v).toUpperCase()).join('|');
}
function outcome(basePrice,checkpoint){
 const b=n(basePrice),p=n(checkpoint&&checkpoint.price);if(!b||p==null)return null;
 const pct=(p-b)/b*100;return {pct:+pct.toFixed(4),direction:pct>0?'UP':pct<0?'DOWN':'FLAT'};
}
function record(input){
 const reactions={};for(const h of HORIZONS) reactions[h]=outcome(input.basePrice,input.checkpoints&&input.checkpoints[h]);
 return {schemaVersion:1,eventId:input.eventId||null,eventAt:input.eventAt||null,signature:signature(input),zone:input.zone||'UNKNOWN',behavior:input.behavior||'UNKNOWN',basePrice:n(input.basePrice),reactions,quality:input.quality||'UNKNOWN',createdAt:new Date().toISOString()};
}
function comparable(rows,current,{minQuality=['EXACT','NEAR']}={}){
 const sig=signature(current);return (rows||[]).filter(r=>r.signature===sig&&minQuality.includes(String(r.quality||'').toUpperCase()));
}
function stats(rows){
 const out={sampleSize:(rows||[]).length,horizons:{}};
 for(const h of HORIZONS){const vals=(rows||[]).map(r=>r.reactions&&r.reactions[h]).filter(Boolean);const up=vals.filter(v=>v.direction==='UP').length,down=vals.filter(v=>v.direction==='DOWN').length,flat=vals.length-up-down;const avg=vals.length?vals.reduce((a,v)=>a+v.pct,0)/vals.length:null;out.horizons[h]={n:vals.length,upRate:vals.length?+(up/vals.length*100).toFixed(1):null,downRate:vals.length?+(down/vals.length*100).toFixed(1):null,flatRate:vals.length?+(flat/vals.length*100).toFixed(1):null,avgPct:avg==null?null:+avg.toFixed(4)};}
 return out;
}
function reversalStats(rows,currentDirection){
 const s=stats(rows),dir=String(currentDirection||'').toUpperCase();
 for(const h of HORIZONS){const x=s.horizons[h];x.reversalRate=x.n?(dir==='UP'?x.downRate:dir==='DOWN'?x.upRate:null):null;}
 return s;
}
module.exports={HORIZONS,signature,outcome,record,comparable,stats,reversalStats};
