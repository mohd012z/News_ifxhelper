'use strict';
const PRE=[['T-24H',1440],['T-6H',360],['T-1H',60],['T-30M',30],['T-15M',15],['T-5M',5],['PRE_EVENT_FREEZE',1]];
const POST=[['M1',1],['M5',5],['M15',15],['M30',30],['H1',60],['H4',240]];
function time(v){const n=new Date(v).getTime();if(!Number.isFinite(n))throw new Error('INVALID_TIME');return n;}
function key(event,phase,stage){return `${event.id}:${phase}:${stage}`;}
function due(event,now,ledger={}){const e=time(event.scheduledAt),n=time(now),jobs=[];for(const [stage,min] of PRE){const at=e-min*60000,k=key(event,'PRE',stage);if(n>=at&&n<e&&!(ledger[k]&&ledger[k].status==='COMPLETE'))jobs.push({key:k,eventId:event.id,phase:'PRE',stage,dueAt:new Date(at).toISOString()});}for(const [stage,min] of POST){const at=e+min*60000,k=key(event,'POST',stage);if(n>=at&&!(ledger[k]&&ledger[k].status==='COMPLETE'))jobs.push({key:k,eventId:event.id,phase:'POST',stage,dueAt:new Date(at).toISOString()});}return {jobs};}
function claim(ledger={},job,owner,now=new Date().toISOString(),ttlMin=5){const old=ledger[job.key],n=time(now);if(old&&old.status==='COMPLETE')return {state:'COMPLETE',ledger};if(old&&old.status==='RUNNING'&&time(old.expiresAt)>n&&old.owner!==owner)return {state:'LOCKED',ledger};const rec={...(old||{}),status:'RUNNING',owner,claimedAt:now,expiresAt:new Date(n+ttlMin*60000).toISOString()};return {state:'CLAIMED',ledger:{...ledger,[job.key]:rec}};}
function complete(ledger={},job,result={}){return {...ledger,[job.key]:{...(ledger[job.key]||{}),status:'COMPLETE',completedAt:result.completedAt||new Date().toISOString(),result:{...result}}};}
function normalCronAllowed(jobName,event,now){const delta=(time(event.scheduledAt)-time(now))/60000;if(jobName==='publish'&&delta>=0&&delta<=1)return {allowed:false,reason:'EVENT_FREEZE_GUARD'};return {allowed:true,reason:null};}
module.exports={PRE,POST,key,due,claim,complete,normalCronAllowed};
