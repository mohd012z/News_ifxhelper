'use strict';
// A pure fan-out plan: never sends or logs tokens/chat identifiers.
const TYPES=new Set(['private','group','channel']);
function normalizeDestinations(destinations) {
 if(!Array.isArray(destinations)) throw TypeError('Destinations must be an array');
 const seen=new Set();
 return destinations.map(d=>{
  if(!d||!TYPES.has(d.type)) throw Error('Invalid Telegram destination type');
  const chatId=String(d.chatId||'').trim();
  if(!/^-?[0-9]{5,20}$/.test(chatId)&&!/^@[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(chatId)) throw Error('Invalid Telegram chat ID');
  const key=d.type+':'+chatId;
  if(seen.has(key)) throw Error('Duplicate Telegram destination');
  seen.add(key);
  return {type:d.type,chatId};
 });
}
function fanoutDrafts(drafts,destinations,{sentKeys=[]}={}) {
 if(!Array.isArray(drafts)) throw TypeError('Invalid drafts');
 const targets=normalizeDestinations(destinations);
 const seen=new Set(sentKeys);
 const jobs=[];
 for(const draft of drafts) {
  if(!draft||typeof draft.key!=='string'||typeof draft.text!=='string') throw Error('Invalid draft');
  for(const dest of targets) {
   const key=JSON.stringify([draft.key,dest.type,dest.chatId]);
   if(seen.has(key)) continue;
   seen.add(key);
   jobs.push({key,destination:dest.type,chatId:dest.chatId,text:draft.text,kind:draft.kind,stage:draft.stage||null,status:'pending-approval',send:false});
  }
 }
 return jobs;
}
module.exports={normalizeDestinations,fanoutDrafts};
