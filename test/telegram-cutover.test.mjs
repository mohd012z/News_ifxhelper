import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {registerMenu,validateConfig} from '../telegram/register-menu.mjs';
const target='https://gentle-violet-4a79.ifxhelper.workers.dev/api/telegram/webhook';
const env={TELEGRAM_BOT_TOKEN:'fake',TELEGRAM_WEBHOOK_SECRET:'abcdefghijklmnop_12345',TELEGRAM_ALLOWED_CHAT_IDS:'123,-100456',TELEGRAM_WEBHOOK_URL:target};
function mock(opts={}){
 const calls=[];let updated=false;
 const reply=result=>new Response(JSON.stringify({ok:true,result}),{status:200});
 const fetcher=async (url,o={})=>{
  const s=String(url);
  if(s===target){calls.push('preflight_'+o.method);return new Response('',{status:o.method==='GET'?(opts.getCode??405):(opts.postCode??403)});}
  const method=s.split('/').at(-1);calls.push(method);
  if(method==='getMe')return reply({username:opts.wrongBot?'anotherbot':'news_ifxhelperbot'});
  if(method==='getWebhookInfo')return reply({url:updated?(opts.mismatch?'https://wrong.example/api/telegram/webhook':target):(opts.oldWebhook||'')});
  if(method==='setWebhook'){updated=true;return reply(true);}
  if(method==='setMyCommands')return reply(true);
  if(method==='getMyCommands')return reply((opts.badCommands?[]:['start','menu','news','calendar','bbma','alerts','health','help']).map(command=>({command})));
  throw Error('unexpected '+method);
 };
 return{calls,fetcher};
}
test('without --apply, no network or secrets required',()=>{
 const e={...process.env};for(const k of Object.keys(env))delete e[k];
 const p=spawnSync(process.execPath,['telegram/register-menu.mjs'],{env:e,encoding:'utf8'});
 assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/DRY RUN/);
});
test('invalid host and chat allowlist rejected',()=>{
 assert.throws(()=>validateConfig({...env,TELEGRAM_WEBHOOK_URL:'https://evil.example/api/telegram/webhook'}),/Unapproved/);
 assert.throws(()=>validateConfig({...env,TELEGRAM_ALLOWED_CHAT_IDS:'nonsense'}),/Invalid chat/);
});
test('success: preflight before setWebhook, readback before setMyCommands',async()=>{
 const m=mock();const r=await registerMenu({env,fetcher:m.fetcher});
 assert.equal(r.commandsVerified,true);
 assert.deepEqual(m.calls,['getMe','getWebhookInfo','preflight_GET','preflight_POST','setWebhook','getWebhookInfo','setMyCommands','getMyCommands']);
});
test('wrong bot identity makes zero modifications',async()=>{
 const m=mock({wrongBot:true});
 await assert.rejects(registerMenu({env,fetcher:m.fetcher}),/identity mismatch/);
 assert.deepEqual(m.calls,['getMe']);
});
test('competing webhook refuses cutover before changes',async()=>{
 const m=mock({oldWebhook:'https://another.example/api/telegram/webhook'});
 await assert.rejects(registerMenu({env,fetcher:m.fetcher}),/owner conflict/);
 assert(!m.calls.includes('setWebhook'));
});
test('old Worker route refusing GET preflight never sets commands',async()=>{
 const m=mock({getCode:200});
 await assert.rejects(registerMenu({env,fetcher:m.fetcher}),/GET preflight/);
 assert(!m.calls.includes('setWebhook'));
});
test('Worker without credentials returns 503, preventing cutover',async()=>{
 const m=mock({postCode:503});
 await assert.rejects(registerMenu({env,fetcher:m.fetcher}),/secrets not configured/);
 assert(!m.calls.includes('setWebhook'));
});
test('wrong webhook read-back cannot install broken commands',async()=>{
 const m=mock({mismatch:true});
 await assert.rejects(registerMenu({env,fetcher:m.fetcher}),/read-back mismatch/);
 assert(m.calls.includes('setWebhook'));assert(!m.calls.includes('setMyCommands'));
});
test('command read-back must match all eight registered commands',async()=>{
 const m=mock({badCommands:true});
 await assert.rejects(registerMenu({env,fetcher:m.fetcher}),/Commands read-back mismatch/);
});
