// Telegram update parser; disabled by default and never calls Telegram API.
export function createWebhookHandler({secret,enabled=false,onPreview}={}){
 if(typeof secret!=='string'||secret.length<16)throw Error('WEBHOOK_SECRET_REQUIRED');
 return async function handle(request){
  if(!enabled)return new Response('Not Found',{status:404});
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const header=request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  // Compare the full token; avoid a variable-length early-exit on individual characters.
  const enc=new TextEncoder(),a=enc.encode(header||''),b=enc.encode(secret);
  let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a[i]||0)^(b[i]||0);
  if(diff!==0)return new Response('Forbidden',{status:403});
  if(Number(request.headers.get('content-length')||0)>16384)return new Response('Payload Too Large',{status:413});
  let raw;try{raw=await request.text();}catch{return new Response('Bad Request',{status:400});}
  if(raw.length>16384)return new Response('Payload Too Large',{status:413});
  let data;try{data=JSON.parse(raw);}catch{return new Response('Bad Request',{status:400});}
  if(!Number.isSafeInteger(data?.update_id)||data.update_id<0)return new Response('Bad Request',{status:400});
  const callback=data.callback_query;
  if(!callback)return Response.json({ok:true,ignored:true});
  if(!/^helix:preview(?::[a-z0-9_-]{1,32})?$/.test(callback.data||''))return Response.json({ok:true,ignored:true});
  if(typeof onPreview!=='function')return new Response('Service Unavailable',{status:503});
  try{await onPreview({updateId:data.update_id,callbackId:String(callback.id||''),userId:callback.from?.id??null,command:callback.data});}
  catch{return new Response('Service Unavailable',{status:503});}
  return Response.json({ok:true,previewOnly:true});
 };
}
