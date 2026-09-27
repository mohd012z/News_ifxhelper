(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.EvidenceEngine=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const RANK={OFFICIAL_RELEASE:100,OFFICIAL_SPEECH:90,OFFICIAL_CALENDAR:90,NEWS_REPORT:60,MARKET_ANALYSIS:40,SPECULATION:15,UNKNOWN:10};
 function sourceWeight(c){return (RANK[c]||RANK.UNKNOWN)/100;}
 function freshness(ts,maxMinutes,now){
  if(!ts)return {state:'UNKNOWN',ageMinutes:null};
  const age=((now||Date.now())-new Date(ts).getTime())/60000;
  return {state:age<=maxMinutes?'CURRENT':'STALE',ageMinutes:Math.max(0,Math.round(age))};
 }
 function combine(parts){
  const valid=(parts||[]).filter(p=>p&&p.direction&&p.direction!=='NEUTRAL'&&Number.isFinite(+p.confidence));
  if(!valid.length)return {state:'INSUFFICIENT_DATA',direction:'NEUTRAL',confidence:0,reasons:[]};
  let up=0,down=0,total=0;
  valid.forEach(p=>{const w=(+p.confidence/100)*sourceWeight(p.sourceClass);total+=w;if(p.direction==='UP'||p.direction==='BUY')up+=w;else if(p.direction==='DOWN'||p.direction==='SELL')down+=w;});
  if(!total)return {state:'INSUFFICIENT_DATA',direction:'NEUTRAL',confidence:0,reasons:[]};
  const gap=Math.abs(up-down)/total, conflict=Math.min(up,down)/Math.max(up,down,0.0001);
  const state=conflict>=0.65?'CONFLICT':gap<0.25?'MIXED':'ALIGNED';
  const direction=state==='ALIGNED'?(up>down?'UP':'DOWN'):'NEUTRAL';
  return {state,direction,confidence:Math.round(Math.min(95,gap*100)),up:+up.toFixed(3),down:+down.toFixed(3),reasons:valid.map(p=>p.reason).filter(Boolean)};
 }
 return {sourceWeight,freshness,combine};
});
