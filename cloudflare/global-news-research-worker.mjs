'use strict';
const SKILLS=new Set(['macro','energy','disaster','crypto','market','critic']);
const MAX=20;
function validateRecord(r){
 if(!r||typeof r!=='object'||!SKILLS.has(r.skill))return false;
 if(typeof r.id!=='string'||!/^[a-zA-Z0-9:_-]{8,120}$/.test(r.id))return false;
 if(typeof r.eventKey!=='string'||r.eventKey.length>200||!r.eventKey)return false;
 if(typeof r.summary!=='string'||r.summary.length<20||r.summary.length>4000)return false;
 if(typeof r.sourceUrl!=='string')return false;
 try {const u=new URL(r.sourceUrl);if(u.protocol!=='https:'||u.username||u.password)return false;}catch{return false;}
 return ['unverified','reviewed','confirmed','rejected'].includes(r.evidenceStatus);
}
function safeRecord(r){return {id:r.id,agent:String(r.agent||r.skill).slice(0,80),skill:r.skill,event_key:r.eventKey,source_url:r.sourceUrl,source_published_at:r.sourcePublishedAt,observed_at:r.observedAt,summary:r.summary,evidence_status:'unverified',outcome_status:'pending',confidence:Number.isFinite(r.confidence)?Math.max(0,Math.min(1,r.confidence)):null};}
export default {
 async fetch(request,env) {
  const url=new URL(request.url);
  if(url.pathname==='/health')return Response.json({ok:true,service:'global-news-research',mode:'staging',publishing:false});
  if(!env.DB||!env.RESEARCH_API_KEY)return new Response('Service not configured',{status:503});
  const token=request.headers.get('authorization');
  if(token!==`Bearer ${env.RESEARCH_API_KEY}`)return new Response('Unauthorized',{status:401});
  if(url.pathname==='/memory'&&request.method==='GET'){
   const skill=url.searchParams.get('skill');
   if(skill&&!SKILLS.has(skill))return new Response('Invalid skill',{status:400});
   const query=skill?'SELECT id,skill,event_key,source_url,summary,evidence_status,outcome_status,created_at FROM research_memory WHERE skill=? AND evidence_status=? ORDER BY created_at DESC LIMIT 20':'SELECT id,skill,event_key,source_url,summary,evidence_status,outcome_status,created_at FROM research_memory WHERE evidence_status=? ORDER BY created_at DESC LIMIT 20';
   const rows=await (skill?env.DB.prepare(query).bind(skill,'confirmed'):env.DB.prepare(query).bind('confirmed')).all();
   return Response.json({records:rows.results||[],researchOnly:true});
  }
  if(url.pathname!=='/research'||request.method!=='POST')return new Response('Not found',{status:404});
  const length=Number(request.headers.get('content-length')||0);
  if(length>16384)return new Response('Payload too large',{status:413});
  const raw=await request.text();
  if(raw.length>16384)return new Response('Payload too large',{status:413});
  let data;try{data=JSON.parse(raw);}catch{return new Response('Invalid JSON',{status:400});}
  if(!data||!Array.isArray(data.records)||data.records.length>MAX||!data.records.every(validateRecord))return new Response('Invalid records',{status:400});
  const statements=[];
  for(const record of data.records){
   if(!Number.isFinite(Date.parse(record.sourcePublishedAt))||!Number.isFinite(Date.parse(record.observedAt)))return new Response('Invalid timestamps',{status:400});
   const r=safeRecord(record);
   statements.push(env.DB.prepare('INSERT OR IGNORE INTO research_memory (id,agent,skill,event_key,source_url,source_published_at,observed_at,summary,evidence_status,outcome_status,confidence) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(r.id,r.agent,r.skill,r.event_key,r.source_url,r.source_published_at,r.observed_at,r.summary,r.evidence_status,r.outcome_status,r.confidence));
  }
  if(statements.length)await env.DB.batch(statements);
  return Response.json({accepted:data.records.length,mode:'staging',publishing:false,verification:'all submitted records quarantined as unverified; independent review required'});
 }
};
