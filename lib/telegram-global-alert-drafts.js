'use strict';
const {planNotifications}=require('./whatsapp-reminder-planner');
const {evaluateEvidence,dedupeStories}=require('./global-evidence-review');
const {buildResearchAlert}=require('./global-event-alerts');
function planTelegramDrafts(events,nowMs,{sentKeys=[],maxBreakingAgeMs=900000}={}) {
 if(!Array.isArray(events)||!Number.isFinite(nowMs)) throw TypeError('Invalid inputs');
 const seen=new Set(sentKeys);
 const drafts=[];
 for(const story of dedupeStories(events)) {
  const evidence=evaluateEvidence(story,{nowMs});
  if(!evidence.confirmed) continue;
  const alert=buildResearchAlert(story);
  if(!alert.confirmed) continue;
  for(const reminder of planNotifications([story],nowMs,{impacts:['medium','high'],sentKeys})) {
   const key='telegram:reminder:'+reminder.key;
   if(!seen.has(key)){seen.add(key);drafts.push({key,kind:'reminder',stage:reminder.stage,text:'EVENT T-'+reminder.stage+' minutes\n'+alert.text,requiresApproval:true});}
  }
  const age=nowMs-Date.parse(story.publishedAt||'');
  if(story.breaking===true&&String(story.importance).toLowerCase()==='high'&&age>=0&&age<=maxBreakingAgeMs) {
   const key='telegram:breaking:'+String(story.provider||'')+':'+String(story.publishedAt||'')+':'+String(story.title||story.event||'');
   if(!seen.has(key)){seen.add(key);drafts.push({key,kind:'breaking',stage:null,text:'HIGH-IMPACT BREAKING NEWS\n'+alert.text,requiresApproval:true});}
  }
 }
 return drafts;
}
module.exports={planTelegramDrafts};
