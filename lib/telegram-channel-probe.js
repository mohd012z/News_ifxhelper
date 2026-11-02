'use strict';
// Pure verification workflow. Callers supply Telegram Bot API response data.
const {assessTelegramResponses}=require('./telegram-api-readiness-review');
function assessChannelProbe(responses) {
 if(!responses||typeof responses!=='object')throw TypeError('Probe responses required');
 const checks=assessTelegramResponses({me:responses.getMe?.result,chat:responses.getChat?.result,member:responses.getChatMember?.result});
 const successful=['getMe','getChat','getChatMember'].every(key=>responses[key]?.ok===true);
 return {ready:successful&&checks.ready,apiCallsSuccessful:successful,checks,channel:'@ifxhelper2',bot:'@news_ifxhelperbot'};
}
module.exports={assessChannelProbe};
