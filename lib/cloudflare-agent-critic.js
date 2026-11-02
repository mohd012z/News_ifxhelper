'use strict';
// Deterministic critic review. Agent outputs are proposals, never automatic decisions.
const {rankMemory}=require('./cloudflare-memory-quality');
function reviewAgents(proposals,memory,{nowMs=Date.now()}={}){
 const eligible=rankMemory(memory,{nowMs});
 const sourceSet=new Set(eligible.map(x=>x.record.sourceUrl));
 const reviewed=(Array.isArray(proposals)?proposals:[]).slice(0,12).map(p=>{
  const refs=Array.isArray(p?.sourceUrls)?p.sourceUrls:[];
  const supported=refs.length>0&&refs.every(url=>sourceSet.has(url));
  const claims=Array.isArray(p?.claims)?p.claims.filter(x=>typeof x==='string').slice(0,8):[];
  return {agent:String(p?.agent||'unknown').slice(0,80),claims,supported,decision:supported?'review-required':'reject-unsupported'};
 });
 return {proposals:reviewed,approvedForPublishing:false,automaticTradeExecution:false,verifiedMemoryCount:eligible.length};
}
module.exports={reviewAgents};
