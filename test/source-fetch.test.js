'use strict';
const assert=require('node:assert/strict');
const {fetchBody}=require('../lib/source-fetch');
async function main(){
  const ok=await fetchBody('https://example.org/rss',{
    timeoutMs:100,headers:{'User-Agent':'read-only-test'},
    fetchImpl:async(url,opts)=>{
      assert.equal(opts.headers['User-Agent'],'read-only-test');
      assert.equal(opts.signal.aborted,false);
      return {ok:true,text:async()=>'<rss />'};
    }
  });
  assert.equal(ok,'<rss />');
  const json=await fetchBody('https://example.org/api',{kind:'json',timeoutMs:100,
    fetchImpl:async()=>({ok:true,json:async()=>({price:10})})});
  assert.equal(json.price,10);
  await assert.rejects(()=>fetchBody('https://example.org/403',{timeoutMs:100,
    fetchImpl:async()=>({ok:false,status:403})}),/HTTP 403/);
  // Permanent header stall: AbortController must abort and return an error.
  await assert.rejects(()=>fetchBody('https://example.org/headers',{timeoutMs:20,
    fetchImpl:async(_,opts)=>new Promise((resolve,reject)=>{
      opts.signal.addEventListener('abort',()=>reject(Error('aborted header request')),{once:true});
    })}),/UPSTREAM_TIMEOUT 20ms/);
  // Permanent body stall: the deadline must remain active until body read ends.
  await assert.rejects(()=>fetchBody('https://example.org/body',{timeoutMs:20,
    fetchImpl:async(_,opts)=>({ok:true,text:()=>new Promise((resolve,reject)=>{
      opts.signal.addEventListener('abort',()=>reject(Error('aborted body request')),{once:true});
    })})}),/UPSTREAM_TIMEOUT 20ms/);
  await assert.rejects(()=>fetchBody('https://example.org/network',{timeoutMs:100,
    fetchImpl:async()=>{throw Error('DNS_FAILED')}}),/DNS_FAILED/);
  await assert.rejects(()=>fetchBody('https://example.org',{timeoutMs:0}),/INVALID_TIMEOUT/);
  await assert.rejects(()=>fetchBody('https://example.org',{kind:'binary'}),/INVALID_BODY_KIND/);
  console.log('source-fetch timeout and recovery tests passed');
}
main().catch(err=>{console.error(err);process.exitCode=1;});
