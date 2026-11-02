'use strict';
// Read-only diagnostic: prints no token and sends no messages.
const {inspectConfiguredChannel}=require('./lib/telegram-channel-inspector');
(async()=>{
 const token=process.env.TELEGRAM_BOT_TOKEN;
 const channel=process.env.TELEGRAM_CHANNEL_ID;
 const presence={botTokenConfigured:Boolean(token),channelConfigured:Boolean(channel),channelMatchesExpected:channel==='@ifxhelper2'};
 console.log('Telegram configuration:',JSON.stringify(presence));
 if(!presence.botTokenConfigured||!presence.channelMatchesExpected){process.exitCode=1;return;}
 const result=await inspectConfiguredChannel({token,chatId:channel});
 console.log('Telegram API readiness:',JSON.stringify(result));
 if(!result.ready)process.exitCode=1;
})().catch(()=>{console.error('Telegram API inspection failed (credentials not printed)');process.exitCode=1});
