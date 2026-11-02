'use strict';
const {prioritizeEvents}=require('./asset-news-relevance');
const {channelDraft}=require('./whatsapp-channel-drafts');
const {makeJob}=require('./whatsapp-staging-queue');
function buildAssetNotifications(events,{assets=['XAUUSD','OIL','BTCUSD'],impacts=['low','medium','high'],destination='channel-draft',destinationId='staging',stage='new'}={}) {
 const prioritized=prioritizeEvents(events,{assets,impacts});
 return prioritized.map(({event,matches,priority})=>{
  const assetSummary=matches.map(m=>m.asset+' ('+m.reasons.join('; ')+')').join(', ');
  const base=channelDraft(event);
  const text=base.text+'\nRelevant markets: '+assetSummary+'\nResearch only; relevance is not a directional forecast.';
  return {job:makeJob(event,{destination,destinationId,stage}),priority,assets:matches.map(m=>m.asset),text,requiresManualPublication:destination==='channel-draft'};
 });
}
module.exports={buildAssetNotifications};
