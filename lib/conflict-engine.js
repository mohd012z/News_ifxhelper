'use strict';
function evaluate(parts){
 const valid=(parts||[]).filter(x=>x&&['UP','DOWN'].includes(x.direction)&&Number.isFinite(+x.confidence));
 if(!valid.length)return {state:'INSUFFICIENT_DATA',direction:'NEUTRAL',confidence:0,reasons:[]};
 let up=0,down=0;
 for(const p of valid){
  const w=Math.max(0,Math.min(100,+p.confidence))/100;
  if(p.direction==='UP')up+=w;
  else down+=w;
 }
 const total=up+down,gap=total?Math.abs(up-down)/total:0,opp=Math.min(up,down)/Math.max(up,down,1e-9);
 const state=opp>=0.65?'CONFLICT':gap<0.25?'MIXED':'ALIGNED';
 return {state,direction:state==='ALIGNED'?(up>down?'UP':'DOWN'):'NEUTRAL',confidence:Math.round(gap*100),up:+up.toFixed(3),down:+down.toFixed(3),reasons:valid.map(x=>x.reason).filter(Boolean)};
}
module.exports={evaluate};
