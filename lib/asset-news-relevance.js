'use strict';
// Research-only, deterministic relevance classification; NOT a price-direction model.
const ASSETS=['XAUUSD','OIL','BTCUSD'];
const IMPACTS=new Set(['low','medium','high']);
const IMPACT_SCORE={low:1,medium:2,high:3};
const RULES={
 XAUUSD:[[/\b(gold|xau|bullion)\b/i,6,'Gold-specific'],[/\b(fed|fomc|powell|interest rates?|rate decision|cpi|pce|inflation|nonfarm|nfp|payrolls|employment|jobs|treasury|yields?|usd|dollar)\b/i,4,'USD / US monetary macro'],[/\b(geopolitic|safe haven|war|sanctions)\b/i,2,'Risk sentiment']],
 OIL:[[/\b(wti|brent|crude|oil|petroleum|opec|eia|api inventory|oil inventories|oil stocks|refiner|rig count)\b/i,6,'Oil supply / demand'],[/\b(china|industrial production|manufacturing pmi|global demand)\b/i,3,'Energy demand'],[/\b(fed|fomc|cpi|usd|dollar|inflation)\b/i,2,'USD / macro']],
 BTCUSD:[[/\b(bitcoin|btc|crypto|spot etf|bitcoin etf|hashrate|halving)\b/i,6,'Bitcoin-specific'],[/\b(sec|crypto regulation|digital asset|stablecoin)\b/i,4,'Digital asset regulation'],[/\b(fed|fomc|cpi|pce|nonfarm|nfp|interest rates?|liquidity|usd|dollar)\b/i,3,'USD / liquidity macro']]
};
function classifyEvent(event,{assets=ASSETS,minScore=2}={}) {
 if(!event||typeof event!=='object') throw TypeError('Event required');
 const title=String(event.event||event.title||'').slice(0,500);
 const currency=String(event.currency||'').toUpperCase();
 const rawImpact=String(event.importance||event.impact||'').toLowerCase().trim();
 const impact=rawImpact==='med'||rawImpact==='moderate'?'medium':rawImpact;
 const text=[title,String(event.category||''),String(event.description||'')].join(' ').slice(0,1500);
 const findings=[];
 for(const asset of assets) {
  if(!RULES[asset]) throw Error('Unsupported asset: '+asset);
  let score=0;const reasons=[];
  for(const [pattern,points,reason] of RULES[asset]) if(pattern.test(text)){score+=points;reasons.push(reason);}
  if(currency==='USD' && (asset==='XAUUSD'||asset==='BTCUSD')){score+=1;reasons.push('USD-denominated market');}
  if(score>=minScore) findings.push({asset,score,reasons,impact:IMPACTS.has(impact)?impact:'unknown',impactScore:IMPACT_SCORE[impact]||0});
 }
 return findings.sort((a,b)=>b.score-a.score||ASSETS.indexOf(a.asset)-ASSETS.indexOf(b.asset));
}
function prioritizeEvents(events,{assets=ASSETS,impacts=['low','medium','high'],minScore=2}={}) {
 const allowed=new Set(impacts);
 return (Array.isArray(events)?events:[]).flatMap(event=>{
  const matches=classifyEvent(event,{assets,minScore}).filter(m=>allowed.has(m.impact));
  return matches.length?[{event,matches,priority:Math.max(...matches.map(m=>m.score+m.impactScore))}]:[];
 }).sort((a,b)=>b.priority-a.priority);
}
module.exports={ASSETS,classifyEvent,prioritizeEvents};
