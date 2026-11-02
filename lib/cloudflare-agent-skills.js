'use strict';
const SKILLS=Object.freeze({
 macro:{sources:['central-bank','statistics-agency'],output:'economic-surprise-and-policy-context'},
 energy:{sources:['eia','iea','opec'],output:'energy-supply-demand-evidence'},
 disaster:{sources:['usgs','noaa','government'],output:'hazard-location-and-economic-exposure'},
 crypto:{sources:['regulator','exchange-disclosure'],output:'crypto-event-facts'},
 market:{sources:['licensed-market-data'],output:'timestamp-aligned-price-reaction'},
 critic:{sources:['independent-evidence'],output:'contradictions-and-invalidation'}
});
function eligibleMemory(item) {
 return !!(item&&SKILLS[item.skill]&&typeof item.sourceUrl==='string'&&/^https:\/\//.test(item.sourceUrl)&&typeof item.summary==='string'&&item.summary.trim().length>=20&&item.evidenceStatus==='confirmed'&&item.outcomeStatus!=='rejected');
}
function decisionBrief(records) {
 const confirmed=Array.isArray(records)?records.filter(eligibleMemory):[];
 const bySkill=Object.fromEntries(Object.keys(SKILLS).map(k=>[k,confirmed.filter(r=>r.skill===k).length]));
 return {eligibleCount:confirmed.length,bySkill,decision:'human-review-required',predictiveConfidence:'not-calibrated',learningMode:'evidence-and-outcome-review'};
}
module.exports={SKILLS,eligibleMemory,decisionBrief};
