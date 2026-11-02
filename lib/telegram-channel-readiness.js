'use strict';
// Pure authorization and destination validation; no API calls.
const CHANNEL='@ifxhelper2';
const BOT='@news_ifxhelperbot';
function validateChannelReadiness({botUsername,channelUsername,botIsAdministrator=false,canPostMessages=false,credentialsConfigured=false}={}) {
 const checks={
  botIdentity:String(botUsername||'').toLowerCase()===BOT,
  channelIdentity:String(channelUsername||'').toLowerCase()===CHANNEL,
  administrator:botIsAdministrator===true,
  postingPermission:canPostMessages===true,
  credentials:credentialsConfigured===true
 };
 return {ready:Object.values(checks).every(Boolean),checks,bot:BOT,channel:CHANNEL};
}
function makeChannelReviewJobs(drafts,{sentKeys=[]}={}) {
 if(!Array.isArray(drafts)) throw TypeError('Drafts must be an array');
 const {fanoutDrafts}=require('./telegram-multi-destination');
 return fanoutDrafts(drafts,[{type:'channel',chatId:CHANNEL}],{sentKeys});
}
module.exports={CHANNEL,BOT,validateChannelReadiness,makeChannelReviewJobs};
