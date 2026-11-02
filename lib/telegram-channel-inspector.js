'use strict';
// Safe Telegram Bot API inspection: never prints or returns the token.
const {assessChannelProbe}=require('./telegram-channel-probe');
async function inspectConfiguredChannel({token,chatId='@ifxhelper2',fetchImpl=globalThis.fetch}={}) {
 if(typeof token!=='string'||!token.includes(':'))return {ready:false,reason:'missing-token'};
 if(chatId!=='@ifxhelper2')return {ready:false,reason:'unexpected-channel'};
 if(typeof fetchImpl!=='function')return {ready:false,reason:'missing-fetch'};
 async function call(method,params) {
  try {
   const response=await fetchImpl('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)});
   const body=await response.json();
   return {ok:response.ok&&body.ok===true,result:body.result||null};
  } catch {return {ok:false,result:null};}
 }
 const getMe=await call('getMe',{});
 if(!getMe.ok)return {ready:false,reason:'getMe-failed'};
 const getChat=await call('getChat',{chat_id:chatId});
 if(!getChat.ok)return {ready:false,reason:'getChat-failed'};
 const getChatMember=await call('getChatMember',{chat_id:chatId,user_id:getMe.result?.id});
 return assessChannelProbe({getMe,getChat,getChatMember});
}
module.exports={inspectConfiguredChannel};
