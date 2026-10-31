'use strict';
/* Build read-only broker XAU/USD spot data. No secret in client-side output. */
const fs=require('node:fs'),path=require('node:path');
const O=require('./lib/oanda-spot-adapter');
const TF=Object.keys(O.GRANULARITY),OUTPUT=path.join(__dirname,'spot-mtf.js');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function unavailable(reason,environment,now){
 const tfs=Object.fromEntries(TF.map(tf=>[tf,{
   tf,state:'UNAVAILABLE',reason,atr:null,asOf:null,instrument:O.DISPLAY,
   sourceInterval:O.GRANULARITY[tf],source:'oanda:'+environment+':'+O.SYMBOL
 }]));
 return {schemaVersion:1,generatedAt:new Date(now).toISOString(),instrument:O.DISPLAY,
   source:'oanda:'+environment+':'+O.SYMBOL,provider:'OANDA_V20',
   environment,market:'BROKER_OTC_XAU_USD',isBrokerSpot:true,notFutures:true,
   state:'UNCONFIGURED',quote:{state:'UNAVAILABLE',reason},timeframes:tfs,
   readyCount:0,total:9};
}
async function collect({env=process.env,now=Date.now(),clientFactory=O.createClient}={}){
 const environment=env.OANDA_ENV||'practice';
 if(!['practice','live'].includes(environment))throw Error('INVALID_OANDA_ENV');
 if(!env.OANDA_API_TOKEN||!env.OANDA_ACCOUNT_ID)
   return unavailable('BROKER_CREDENTIALS_NOT_CONFIGURED',environment,now);
 const client=clientFactory({
   token:env.OANDA_API_TOKEN,accountId:env.OANDA_ACCOUNT_ID,environment
 });
 const errors={},candles={};let pricing=null;
 try{pricing=await client.pricing();}
 catch(e){errors.pricing=O.errorCode(e);}
 for(const tf of TF){
   try{candles[tf]=await client.candles(tf);}
   catch(e){errors[tf]=O.errorCode(e);}
   await sleep(150);
 }
 return O.analyzeBroker({quotePayload:pricing,candlePayloads:candles,environment,now,errors});
}
function persist(result,file=OUTPUT){
 const text='/* Read-only broker XAU/USD snapshot. No bearer token or account ID stored. */\n'
   +'window.SPOT_MTF = '+JSON.stringify(result,null,2)+';\n';
 const tmp=file+'.tmp';fs.writeFileSync(tmp,text,'utf8');fs.renameSync(tmp,file);
 return file;
}
async function main(){
 const result=await collect();persist(result);
 console.log('BROKER XAU/USD',result.state,'ready',result.readyCount+'/9',
   'quote',result.quote.state,result.quote.reason||'');
 for(const row of Object.values(result.timeframes))
   console.log(row.tf,row.state,row.reason||'',row.asOf||'');
}
if(require.main===module)main().catch(e=>{console.error('BROKER_REFRESH_FAILED',O.errorCode(e));process.exitCode=1;});
module.exports={collect,persist,unavailable};
