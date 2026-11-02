'use strict';
// Read-only diagnostic: prints no token and sends no messages.
const {inspectConfiguredChannel}=require('./lib/telegram-channel-inspector');
(async()=>{
 const token=process.env.TELEGRAM_BOT_TOKEN;
 const channel=process.env.TELEGRAM_CHANNEL_ID;
 const chat=process.env.TELEGRAM_CHAT_ID;
 const chatMismatch=Boolean(chat&&channel&&chat!==channel);
 const presence={botTokenConfigured:Boolean(token),channelConfigured:Boolean(channel),channelMatchesExpected:channel==='@ifxhelper2',chatDestinationConfigured:Boolean(chat),chatDestinationMatchesChannel:!chatMismatch};
 console.log('Telegram configuration:',JSON.stringify(presence));
 if(!presence.botTokenConfigured||!presence.channelMatchesExpected||chatMismatch){process.exitCode=1;return;}
 const result=await inspectConfiguredChannel({token,chatId:channel});
 console.log('Telegram API readiness:',JSON.stringify({ready:result.ready,apiCallsSuccessful:result.apiCallsSuccessful,checks:result.checks,channel:result.channel,bot:result.bot}));
 if(!result.ready)process.exitCode=1;
})().catch(()=>{console.error('Telegram API inspection failed (credentials not printed)');process.exitCode=1});
