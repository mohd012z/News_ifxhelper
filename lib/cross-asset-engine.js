'use strict';
function sign(v,deadband=0){return !Number.isFinite(+v)||Math.abs(+v)<=deadband?0:+v>0?1:-1;}
function evaluate(x){
 const parts=[
  {name:'instrument',s:sign(x.instrumentPct)},
  {name:'dxy',s:-sign(x.dxyPct)},
  {name:'yield',s:-sign(x.yieldPct)}
 ].filter(p=>p.s);
 if(!parts.length)return {state:'INSUFFICIENT_DATA',score:0,parts};
 const score=parts.reduce((a,p)=>a+p.s,0);
 return {state:Math.abs(score)===parts.length?'ALIGNED':score===0?'CONFLICT':'MIXED',score,parts};
}
module.exports={evaluate};
