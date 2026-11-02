'use strict';
// Evidence-first research triage; never equate event relevance with observed market effect.
const {classifyEvent}=require('./asset-news-relevance');
const OFFICIAL=new Set(['usgs','noaa','federal-reserve','fomc','eia','iea','opec','sec','cftc','central-bank','government']);
const SOCIAL=new Set(['x','twitter','instagram']);
function classifyMacroTone(input) {
 const s=String(input||'').toLowerCase();
 const hawk=[/inflation (?:remains |is )?(?:elevated|persistent|sticky)/,/(?:raise|hike|increase) (?:the )?(?:policy |interest )?rates?/,/further tightening/,/higher for longer/].filter(r=>r.test(s)).length;
 const dove=[/inflation (?:has )?(?:eased|declined|cooled)/,/\b(?:cut|lower|reduce) (?:the )?(?:policy |interest )?rates?/,/policy easing/,/downside risks? to (?:employment|growth)/].filter(r=>r.test(s)).length;
 return {tone:hawk>dove?'hawkish':dove>hawk?'dovish':'inconclusive',hawkishCues:hawk,dovishCues:dove,requiresContext:true};
}
function triageStory(story) {
 if(!story||typeof story!=='object') throw TypeError('story required');
 const provider=String(story.provider||'').trim().toLowerCase();
 const verified=story.verified===true && (OFFICIAL.has(provider)||story.independentSources>=2);
 const social=SOCIAL.has(provider);
 const title=String(story.title||story.event||'').slice(0,500);
 const summary=String(story.summary||'').slice(0,1000);
 const topic=/\b(earthquake|tsunami|volcano|flood|hurricane|wildfire)\b/i.test(title+' '+summary)?'natural-disaster':/\b(war|conflict|sanctions|missile|shipping|hormuz|blockade)\b/i.test(title+' '+summary)?'geopolitical':/\b(bitcoin|btc|crypto|etf|blockchain)\b/i.test(title+' '+summary)?'crypto':/\b(fed|fomc|central bank|interest rate|inflation)\b/i.test(title+' '+summary)?'monetary-policy':'other';
 const physicalEvidence=story.infrastructureImpactConfirmed===true;
 const marketEvidence=story.marketReactionVerified===true;
 const affected=classifyEvent({event:title,description:summary,importance:story.importance||'medium',currency:story.currency||''});
 return {topic,sourceClass:social?'social-lead':OFFICIAL.has(provider)?'official':'news',verification:verified?'verified':'unverified',physicalImpactConfirmed:physicalEvidence,marketEffect:marketEvidence?'observed':'not-established',affectedAssets:affected.map(x=>x.asset),tone:topic==='monetary-policy'?classifyMacroTone(title+' '+summary).tone:'not-applicable',publishableAsConfirmed:verified && (!social || story.independentSources>=2)};
}
module.exports={classifyMacroTone,triageStory};
