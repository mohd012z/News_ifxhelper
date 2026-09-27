'use strict';
const FIELDS=['symbol','timeframe','dayOfWeek','weekOfMonth','newsMode','eventCategory','bbLocation','bbmaPattern','atrRegime','squeezeState','mtfState','crossAssetState'];
function move(a,b){if(!a||!b||!Number.isFinite(+a.price)||!Number.isFinite(+b.price)||+a.price===0)return null;const delta=+b.price-+a.price,pct=+(delta/+a.price*100).toFixed(6);return {from:a.stage,to:b.stage,delta:+delta.toFixed(6),pct,direction:delta>0?'UP':delta<0?'DOWN':'FLAT'};}
function buildChain(points){const by=Object.fromEntries((points||[]).map(x=>[x.stage,x])),a=by.THU_OPEN,b=by.THU_CLOSE,c=by.FRI_OPEN,d=by.FRI_CLOSE||by.W1_CLOSE;const moves={thuOpenToClose:move(a,b),thuCloseToFriOpen:move(b,c),friOpenToClose:move(c,d),thuOpenToW1Close:move(a,d)};return {state:Object.values(moves).every(Boolean)?'COMPLETE':'PARTIAL',points:by,moves};}
function token(field,value){return `${field}:${String(value)}`;}
function buildIndex(rows){const map=new Map();for(const row of rows||[]){for(const f of FIELDS){if(row[f]==null)continue;const k=token(f,row[f]);if(!map.has(k))map.set(k,new Set());map.get(k).add(row);} }return {rows:rows||[],map};}
function match(index,query){if(!index||!Array.isArray(index.rows))return [];const sets=[];for(const f of FIELDS){if(query[f]==null)continue;sets.push(index.map.get(token(f,query[f]))||new Set());}if(!sets.length)return index.rows.slice();sets.sort((a,b)=>a.size-b.size);return [...sets[0]].filter(row=>sets.every(s=>s.has(row)));}
function summarize(rows,{minGood=20}={}){const outcomes={};for(const r of rows||[])if(r.outcome)outcomes[r.outcome]=(outcomes[r.outcome]||0)+1;const n=(rows||[]).length;return {sampleSize:n,quality:n>=minGood?'GOOD':n>0?'THIN':'NONE',outcomes};}
module.exports={FIELDS,move,buildChain,buildIndex,match,summarize};
