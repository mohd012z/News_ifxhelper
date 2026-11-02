'use strict';
const assert=require('node:assert/strict');
const {run}=require('../telegram-channel-send-test');
const calls=[];
const fetchImpl=async(url,opts)=>{
 const method=url.split('/').pop();
 calls.push(method);
 if(method==='sendMessage')assert.equal(JSON.parse(opts.body).disable_notification,false,'push test must not be silent');
 const result=method==='getMe'?{id:77,username:'news_ifxhelperbot'}:method==='getChat'?{type:'channel',username:'ifxhelper2'}:method==='getChatMember'?{status:'administrator',can_post_messages:true}:{message_id:321,chat:{username:'ifxhelper2'}};
 return {ok:true,json:async()=>({ok:true,result})};
};
(async()=>{
 const env={TELEGRAM_BOT_TOKEN:'123:fake',TELEGRAM_CHANNEL_ID:'@ifxhelper2',TELEGRAM_SEND_APPROVED:'YES'};
 const result=await run({env,fetchImpl,log:()=>{}});
 assert.equal(result.messageId,321);
 assert.deepEqual(calls,['getMe','getChat','getChatMember','sendMessage']);
 calls.length=0;
 await assert.rejects(run({env:{...env,TELEGRAM_SEND_APPROVED:'NO'},fetchImpl}),/approval/);
 assert.equal(calls.length,0);
 await assert.rejects(run({env:{...env,TELEGRAM_CHANNEL_ID:'@wrong'},fetchImpl}),/channel/);
 const wrongReceipt=async(url)=>({ok:true,json:async()=>({ok:true,result:url.endsWith('getMe')?{id:77,username:'news_ifxhelperbot'}:url.endsWith('getChat')?{type:'channel',username:'ifxhelper2'}:url.endsWith('getChatMember')?{status:'administrator',can_post_messages:true}:{message_id:1,chat:{username:'other'}}})});
 await assert.rejects(run({env,fetchImpl:wrongReceipt,log:()=>{}}),/destination mismatch/);
 console.log('Telegram controlled send mock tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
