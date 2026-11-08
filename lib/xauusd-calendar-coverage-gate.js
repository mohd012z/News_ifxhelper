'use strict';
const {startOf,endOf}=require('./xauusd-min-candle-policy');
const MINUTE=60000;
function validateCoverageManifest({rangeStart,rangeEnd,segments}){
 if(!Number.isSafeInteger(rangeStart)||!Number.isSafeInteger(rangeEnd)||rangeStart<0||rangeStart%MINUTE||rangeEnd%MINUTE||rangeEnd<=rangeStart||!Array.isArray(segments))throw Error('invalid coverage range');
 let cursor=rangeStart;
 for(const s of segments){
  if(!s||!Number.isSafeInteger(s.start)||!Number.isSafeInteger(s.end)||s.start!==cursor||s.end<=s.start||s.end>rangeEnd||s.end%MINUTE||!['verified_schedule','provisional_schedule','unknown'].includes(s.status))throw Error('calendar coverage gap or overlap');
  cursor=s.end;
 }
 if(cursor!==rangeEnd)throw Error('calendar coverage gap or overlap');
 return {rangeStart,rangeEnd,complete:true,verified:segments.every(s=>s.status==='verified_schedule')};
}
function boundaryGate({timeframe,barStart,asOf,manifest}){
 if(!['W1','MN1'].includes(timeframe))throw Error('boundary gate only W1/MN1');
 if(!Number.isSafeInteger(barStart)||startOf(barStart,timeframe)!==barStart||!Number.isSafeInteger(asOf))throw Error('invalid bar boundary');
 const end=endOf(barStart,timeframe);
 if(end>asOf)return {eligible:false,reason:'open_bar'};
 if(!manifest||manifest.rangeStart>barStart||manifest.rangeEnd<end)return {eligible:false,reason:'calendar_range_incomplete'};
 try{
  const x=validateCoverageManifest(manifest);
  return x.verified?{eligible:true,reason:'verified_calendar_coverage'}:{eligible:false,reason:'calendar_unverified'};
 }catch{return {eligible:false,reason:'calendar_range_incomplete'}}
}
module.exports={validateCoverageManifest,boundaryGate};
