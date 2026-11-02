'use strict';
// Versioned, evidence-only interchange contract between News_ifxhelper and HELIX.
const VERSION='research-evidence/v1';
function validUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!!u.hostname;}catch{return false;}}
function validateEnvelope(payload){
 const errors=[];
 if(!payload||typeof payload!=='object'||payload.schemaVersion!==VERSION)errors.push('schemaVersion');
 if(!payload||typeof payload.eventId!=='string'||!/^[-a-zA-Z0-9:_]{6,120}$/.test(payload.eventId))errors.push('eventId');
 if(!payload||typeof payload.summary!=='string'||payload.summary.length<20||payload.summary.length>4000)errors.push('summary');
 if(!payload||!['unverified','reviewed','confirmed','rejected'].includes(payload.evidenceStatus))errors.push('evidenceStatus');
 if(!payload||!Array.isArray(payload.sources)||payload.sources.length<1||payload.sources.length>8||payload.sources.some(s=>!s||!validUrl(s.url)||!Number.isFinite(Date.parse(s.publishedAt))))errors.push('sources');
 if(!payload||!Number.isFinite(Date.parse(payload.observedAt)))errors.push('observedAt');
 if(payload&&(payload.prediction!==undefined||payload.tradeAction!==undefined||payload.telegramSend!==undefined))errors.push('prohibited-actions');
 return {valid:errors.length===0,errors};
}
function safeEnvelope(payload){
 const validation=validateEnvelope(payload);
 if(!validation.valid)return {ok:false,errors:validation.errors};
 return {ok:true,value:{schemaVersion:VERSION,eventId:payload.eventId,summary:payload.summary,evidenceStatus:'unverified',sources:payload.sources.map(s=>({url:s.url,publishedAt:s.publishedAt})),observedAt:payload.observedAt,marketImpact:'not-established',prediction:'not-calibrated',publish:false}};
}
module.exports={VERSION,validateEnvelope,safeEnvelope};
