'use strict';
function group(rows,keyFn){const m={};for(const r of rows||[]){const k=keyFn(r);if(!k)continue;(m[k]||(m[k]=[])).push(r);}return m;}
function stats(rows){
 const reactions=[];let conflict=0,aligned=0,mixed=0;
 for(const r of rows||[]){if(Number.isFinite(+r.realizedPct))reactions.push(+r.realizedPct);const s=r.state||r.reactionState;if(s==='CONFLICT')conflict++;else if(s==='ALIGNED')aligned++;else if(s==='MIXED')mixed++;}
 const avg=reactions.length?reactions.reduce((a,b)=>a+b,0)/reactions.length:null;
 return {count:(rows||[]).length,reactionCount:reactions.length,avgReactionPct:avg==null?null:+avg.toFixed(4),conflict,aligned,mixed};
}
function weekly(rows){const g=group(rows,r=>r.timestamp&&r.timestamp.weekUtc);return Object.fromEntries(Object.entries(g).map(([k,v])=>[k,stats(v)]));}
function monthly(rows){const g=group(rows,r=>r.timestamp&&r.timestamp.monthUtc);return Object.fromEntries(Object.entries(g).map(([k,v])=>[k,stats(v)]));}
module.exports={group,stats,weekly,monthly};
