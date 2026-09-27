'use strict';
function age(now,t){const a=new Date(now).getTime(),b=new Date(t).getTime();return Number.isFinite(a)&&Number.isFinite(b)?(a-b)/60000:Infinity;}
function fresh(now,x,max){return !!(x&&x.sourceAt)&&age(now,x.sourceAt)<=max;}
function syncState(authoritative,consumer,now,maxAge=30){if(!consumer||!consumer.sourceAt)return 'OFFLINE';if(!authoritative||consumer.snapshotId!==authoritative.snapshotId)return 'STALE';return fresh(now,consumer,maxAge)?'LIVE':'STALE';}
function build(x={}){const now=x.now||new Date().toISOString();const marketFresh=fresh(now,x.market,15),newsFresh=fresh(now,x.news,30),learningFresh=fresh(now,x.learning,1440);const sync={web:syncState(x.market,x.web,now,30),apk:syncState(x.market,x.apk,now,30)};let health=!marketFresh||!newsFresh?'RED':'GREEN';if(health==='GREEN'&&(!learningFresh||sync.web!=='LIVE'||sync.apk!=='LIVE'))health='YELLOW';return {generatedAt:now,health,freshness:{market:marketFresh,news:newsFresh,learning:learningFresh},sync};}
function acquire(locks={},resource,owner){if(locks[resource]&&locks[resource]!==owner)throw new Error(`LOCK_OWNER_MISMATCH:${resource}:${locks[resource]}:${owner}`);return {...locks,[resource]:owner};}
module.exports={age,fresh,syncState,build,acquire};
