'use strict';
const crypto=require('crypto');
const OWNERS={'data/current-snapshot.json':'market-intelligence','data/learning-summary.json':'background-learning','data/system-health.json':'health-coordinator'};
function ownerFor(path){return OWNERS[path]||null;}
function assertOwner(path,writer){const expected=ownerFor(path);if(expected&&expected!==writer)throw new Error(`WRITE_OWNER_MISMATCH:${path}:${expected}:${writer}`);return true;}
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));return v;}
function hash(v){return crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');}
function shouldWrite(previous,next){const previousHash=hash(previous),nextHash=hash(next);return {state:previousHash===nextHash?'SKIPPED_UNCHANGED':'CHANGED',previousHash,nextHash};}
function componentState(x,now){if(!x||!x.sourceAt)return 'GRAY';const source=new Date(x.sourceAt).getTime(),n=new Date(now).getTime();if(!Number.isFinite(source)||!Number.isFinite(n))return 'GRAY';return n-source<=Number(x.maxAgeMin||0)*60000?'GREEN':'RED';}
function health({now=new Date().toISOString(),market,news,learning,conflicts=[]}={}){const components={market:componentState(market,now),news:componentState(news,now),learning:componentState(learning,now)};const required=[components.market,components.news];let overall=required.includes('RED')?'RED':required.every(x=>x==='GREEN')?'GREEN':'YELLOW';if(Array.isArray(conflicts)&&conflicts.length&&overall==='GREEN')overall='YELLOW';return {generatedAt:now,overall,components,conflicts:[...(conflicts||[])]};}
module.exports={OWNERS,ownerFor,assertOwner,stable,hash,shouldWrite,componentState,health};
