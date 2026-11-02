'use strict';
// WhatsApp Channels do not expose a generally available official publishing API.
// Produce a human-reviewable draft; NEVER attempt Channel network publishing.
const {normalizeImpact,selectEvents,eventKey}=require('./whatsapp-notify');
function channelDraft(event,{source='ForexFactory',timezone='Asia/Kuala_Lumpur'}={}) {
 if(!event||typeof event!=='object') throw new TypeError('Event required');
 const impact=normalizeImpact(event.importance||event.impact);
 if(!['low','medium','high'].includes(impact)) throw Error('Unsupported impact');
 const title=String(event.event||event.title||'').trim();
 if(!title||title.length>200) throw Error('Invalid event title');
 const currency=String(event.currency||'').trim().toUpperCase();
 if(currency&&!/^[A-Z]{3}$/.test(currency)) throw Error('Invalid currency');
 const time=String(event.timeMyt||event.timeUtc||'').trim();
 if(!time||time.length>80) throw Error('Missing event time');
 const clean=x=>String(x).replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 return {key:eventKey(event,'channel'),requiresManualPublication:true,networkPublishSupported:false,timezone,text:[`Economic calendar • ${impact.toUpperCase()} impact`,clean(title),currency?`Currency: ${currency}`:null,`Scheduled time: ${clean(time)} (${timezone})`,`Source: ${clean(source)}`].filter(Boolean).join('\n')};
}
function buildChannelDrafts(events,options={}) {
 return selectEvents(events,options.impacts||['low','medium','high']).map(e=>channelDraft(e,options));
}
module.exports={channelDraft,buildChannelDrafts};
