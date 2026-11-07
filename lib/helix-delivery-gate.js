'use strict';
/** Offline delivery planner: no network calls, no Telegram API, no Worker entrypoint. */
const crypto=require('node:crypto');
const DEST='@ifxhelper2';
const STATES=Object.freeze({DRAFT:'DRAFT',AWAITING_APPROVAL:'AWAITING_APPROVAL',APPROVED:'APPROVED',LEASED:'LEASED',DELIVERED:'DELIVERED',RETRY_WAIT:'RETRY_WAIT',UNCERTAIN:'UNCERTAIN',REJECTED:'REJECTED',EXPIRED:'EXPIRED'});
const canonical=x=>JSON.stringify(x,Object.keys(x).sort());
function fingerprint(preview){
 if(!preview||preview.mode!=='PREVIEW_ONLY'||preview.destination!==DEST||preview.parse_mode!=='HTML'||typeof preview.text!=='string'||!preview.text.trim()||preview.text.length>4096)throw new TypeError('invalid preview');
 return crypto.createHash('sha256').update(JSON.stringify([DEST,preview.parse_mode,preview.text])).digest('hex');
}
function validateEvidence(report,now=Date.now()){
 if(!report||report.kind!=='RESEARCH_ONLY'||!report.timeframes||!Number.isFinite(Date.parse(report.asOf)))throw new TypeError('invalid report');
 const age=now-Date.parse(report.asOf);
 if(age<0||age>24*3600*1000)throw new RangeError('report stale or future dated');
 for(const tf of ['H4','H1','M15','M5']){
  const f=report.timeframes[tf];
  if(!f||f.state!=='READY'||!Number.isInteger(f.closedCandles)||f.closedCandles<50||!f.bbma||f.bbma.state!=='READY'||!Number.isFinite(Date.parse(f.latestClosedOpen)))throw new TypeError('missing verified timeframe: '+tf);
  if(Date.parse(f.latestClosedOpen)>Date.parse(report.asOf))throw new RangeError('future candle: '+tf);
  if(!Array.isArray(f.zones))throw new TypeError('invalid zones: '+tf);
  for(const z of f.zones){
   if(!['RBR','DBD','DBR','RBD'].includes(z.type)||!['FRESH','TESTED','MITIGATED','INVALIDATED'].includes(z.status)||!Number.isFinite(z.proximal)||!Number.isFinite(z.distal)||!Number.isFinite(Date.parse(z.confirmedAt))||Date.parse(z.confirmedAt)>Date.parse(report.asOf))throw new TypeError('invalid zone evidence: '+tf);
  }
 }
 return true;
}
function prepare(report,preview,now=Date.now()){
 validateEvidence(report,now);
 const hash=fingerprint(preview);
 return {id:hash,destination:DEST,reportHash:hash,status:STATES.AWAITING_APPROVAL,createdAt:new Date(now).toISOString(),approvedAt:null,approvalExpiresAt:null,attempts:0};
}
function approve(record,{reportHash,actor,expiresAt},now=Date.now()){
 if(!record||record.status!==STATES.AWAITING_APPROVAL||record.destination!==DEST||record.reportHash!==reportHash||typeof actor!=='string'||!actor.trim())throw new Error('approval denied');
 const expiry=Date.parse(expiresAt);
 if(!Number.isFinite(expiry)||expiry<=now||expiry>now+3600000)throw new Error('invalid approval expiry');
 return {...record,status:STATES.APPROVED,approvedBy:actor,approvedAt:new Date(now).toISOString(),approvalExpiresAt:new Date(expiry).toISOString()};
}
function plan(record,{deliveryEnabled=false,now=Date.now()}={}){
 if(!deliveryEnabled)return {action:'BLOCK',reason:'DELIVERY_DISABLED'};
 if(!record||record.destination!==DEST||record.status!==STATES.APPROVED)return {action:'BLOCK',reason:'NOT_APPROVED'};
 if(!record.approvedBy||!Number.isFinite(Date.parse(record.approvalExpiresAt))||Date.parse(record.approvalExpiresAt)<=now)return {action:'BLOCK',reason:'APPROVAL_EXPIRED'};
 return {action:'ELIGIBLE_FOR_ATOMIC_LEASE',id:record.id};
}
function classifyAttempt(outcome){
 if(outcome==='CONFIRMED_SUCCESS')return STATES.DELIVERED;
 if(outcome==='CONFIRMED_NOT_SENT')return STATES.RETRY_WAIT;
 if(outcome==='UNKNOWN'||outcome==='TIMEOUT'||outcome==='CONNECTION_LOST')return STATES.UNCERTAIN;
 throw new TypeError('unknown delivery outcome');
}
module.exports={DEST,STATES,fingerprint,validateEvidence,prepare,approve,plan,classifyAttempt};
