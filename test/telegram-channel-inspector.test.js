'use strict';
const assert=require('node:assert/strict');
const {inspectConfiguredChannel}=require('../lib/telegram-channel-inspector');
const calls=[];
const fetchImpl=async(url,options)=>{
 const method=url.split('/').pop();
 calls.push(method);
 const result=method==='getMe'?{id:42,username:'news_ifxhelperbot'}:method==='getChat'?{username:'ifxhelper2',type:'channel'}:{status:'administrator',can_post_messages:true};
 return {ok:true,json:async()=>({ok:true,result})};
};
(async()=>{
 assert.equal((await inspectConfiguredChannel({token:'123:mocktoken',fetchImpl})).ready,true);
 assert.deepEqual(calls,['getMe','getChat','getChatMember']);
 assert.equal((await inspectConfiguredChannel({token:'',fetchImpl})).ready,false);
 assert.equal((await inspectConfiguredChannel({token:'123:mocktoken',chatId:'@wrong',fetchImpl})).ready,false);
 const denied=await inspectConfiguredChannel({token:'123:mocktoken',fetchImpl:async(url)=>({ok:true,json:async()=>({ok:true,result:url.endsWith('getMe')?{id:42,username:'news_ifxhelperbot'}:url.endsWith('getChat')?{type:'channel',username:'ifxhelper2'}:{status:'administrator',can_post_messages:false}})})});
 assert.equal(denied.ready,false);
 console.log('Telegram channel inspector tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
