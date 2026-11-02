'use strict';
// Evidence gates for research alerts. Never label an asset price move as verified without price evidence.
const {triageStory}=require('./global-event-triage');
const {classifyEvent}=require('./asset-news-relevance');
function buildResearchAlert(story) {
 const triage=triageStory(story);
 const matches=classifyEvent({event:story.title||story.event,description:story.summary,importance:story.importance||'medium',currency:story.currency||''});
 const confirmed=triage.publishableAsConfirmed;
 const headline=String(story.title||story.event||'').replace(/[\r\n\t]/g,' ').slice(0,180);
 const evidence=Array.isArray(story.evidenceUrls)?story.evidenceUrls.filter(x=>typeof x==='string'&&/^https:\/\//.test(x)).slice(0,3):[];
 const tags=matches.map(m=>m.asset);
 const lines=[confirmed?'VERIFIED EVENT':'UNVERIFIED RESEARCH LEAD',headline,'Topic: '+triage.topic,'Potentially relevant: '+(tags.join(', ')||'No specific market established'),'Physical impact: '+(triage.physicalImpactConfirmed?'reported confirmed':'not established'),'Market reaction: '+triage.marketEffect,'Macro tone: '+triage.tone,'Research only; no BUY/SELL inference.'];
 return {confirmed,sendAsConfirmed:confirmed,assets:tags,topic:triage.topic,marketEffect:triage.marketEffect,evidenceUrls:evidence,text:lines.join('\n')};
}
module.exports={buildResearchAlert};
