'use strict';
// Controlled manual notification. Never log the token or the Bot API URL.
const {inspectConfiguredChannel}=require('./lib/telegram-channel-inspector');
async function run({env=process.env,fetchImpl=globalThis.fetch,log=console.log}={}) {
 const token=env.TELEGRAM_BOT_TOKEN;
 const channel=env.TELEGRAM_CHANNEL_ID;
 if(!token||channel!=='@ifxhelper2')throw Error('Missing credentials or unexpected channel');
 if(env.TELEGRAM_SEND_APPROVED!=='YES')throw Error('Explicit send approval required');
 const inspection=await inspectConfiguredChannel({token,chatId:channel,fetchImpl});
 if(!inspection.ready)throw Error('Telegram identity/channel/posting permission check failed');
 const message='News_ifxhelper channel connectivity test. Research notifications only. No trading instructions.';
 const response=await fetchImpl('https://api.telegram.org/bot'+token+'/sendMessage',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({chat_id:channel,text:message,disable_notification:false})
 });
 const body=await response.json();
 if(!response.ok||body.ok!==true||!Number.isInteger(body.result?.message_id))throw Error('Telegram did not confirm message delivery');
 if(String(body.result?.chat?.username||'').toLowerCase()!=='ifxhelper2')throw Error('Telegram response destination mismatch');
 log(JSON.stringify({delivered:true,channel,messageId:body.result.message_id}));
 return {delivered:true,messageId:body.result.message_id};
}
if(require.main===module)run().catch(e=>{console.error('Channel test failed:',e.message);process.exitCode=1});
module.exports={run};
