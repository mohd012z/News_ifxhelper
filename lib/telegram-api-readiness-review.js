'use strict';
// Pure parser for responses returned by Telegram getMe/getChat/getChatMember.
function assessTelegramResponses({me,chat,member}={}) {
 const username=String(me?.username||'').toLowerCase();
 const channel=String(chat?.username||'').toLowerCase();
 const identity=username==='news_ifxhelperbot';
 const destination=chat?.type==='channel'&&channel==='ifxhelper2';
 const administrator=member?.status==='administrator'||member?.status==='creator';
 const posting=member?.status==='creator'||(administrator&&member?.can_post_messages===true);
 return {ready:identity&&destination&&administrator&&posting,identity,destination,administrator,posting};
}
module.exports={assessTelegramResponses};
