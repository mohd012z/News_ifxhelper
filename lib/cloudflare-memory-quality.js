'use strict';
function normalizeUrl(value){
 try {const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hostname==='localhost')return null;u.hash='';return u.href;}catch{return null;}
}
function assessResearch(record,{nowMs=Date.now(),maxAgeMs=86400000}={}){
 const url=normalizeUrl(record?.sourceUrl);
 const published=Date.parse(record?.sourcePublishedAt||'');
 const fresh=Number.isFinite(published)&&published<=nowMs+300000&&nowMs-published<=maxAgeMs;
 const domain=url?new URL(url).hostname.toLowerCase():null;
 const corroboration=Array.isArray(record?.corroboratingUrls)?record.corroboratingUrls.map(normalizeUrl).filter(Boolean):[];
 const independent=corroboration.some(x=>new URL(x).hostname.toLowerCase()!==domain);
 const contradictions=Array.isArray(record?.contradictions)?record.contradictions.filter(x=>typeof x==='string'&&x.trim()):[];
 return {eligible:!!url&&fresh&&independent&&contradictions.length===0&&record.evidenceStatus==='confirmed',fresh,independent,contradictions,sourceUrl:url,verification:'metadata-only; source contents not fetched'};
}
function rankMemory(records,opts={}){
 return (Array.isArray(records)?records:[]).map(record=>({record,assessment:assessResearch(record,opts)})).filter(x=>x.assessment.eligible).sort((a,b)=>Date.parse(b.record.sourcePublishedAt)-Date.parse(a.record.sourcePublishedAt));
}
module.exports={normalizeUrl,assessResearch,rankMemory};
