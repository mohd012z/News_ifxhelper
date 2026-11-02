'use strict';
// Read-only Cloudflare Worker staging API. No Telegram sends, trades or paid AI.
function summarize(event) {
 if(!event||typeof event!=='object')return {status:'invalid'};
 const title=String(event.title||event.event||'').slice(0,180);
 const evidence=Array.isArray(event.evidenceUrls)?event.evidenceUrls.filter(x=>typeof x==='string'&&x.startsWith('https://')).slice(0,5):[];
 const verified=event.verified===true&&evidence.length>0;
 return {status:verified?'requires-source-review':'unverified',title,publishedAt:event.publishedAt||null,sourceUrls:evidence,marketImpact:'not-established',prediction:'not-calibrated',researchOnly:true};
}
export default {
 async fetch(request) {
  const url=new URL(request.url);
  if(url.pathname==='/health')return Response.json({ok:true,service:'global-news-research',mode:'staging',publishing:false});
  if(url.pathname!=='/research'||request.method!=='POST')return new Response('Not found',{status:404});
  if(Number(request.headers.get('content-length')||0)>16384)return new Response('Payload too large',{status:413});
  let data;try{data=await request.json();}catch{return new Response('Invalid JSON',{status:400});}
  if(!Array.isArray(data.events)||data.events.length>20)return new Response('Invalid events',{status:400});
  return Response.json({results:data.events.map(summarize),mode:'staging',publishing:false});
 }
};
