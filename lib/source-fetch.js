'use strict';
/**
 * Bounded network reads for public news, calendar and quote collectors.
 * A timeout covers BOTH response headers and response body consumption.
 * Node 20 native fetch + AbortController only; no paid APIs/dependencies.
 */
async function fetchBody(url,{
  kind='text',headers={},timeoutMs=8500,fetchImpl=global.fetch
}={}){
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>60000)
    throw Error('INVALID_TIMEOUT');
  if(!['text','json'].includes(kind))throw Error('INVALID_BODY_KIND');
  if(typeof fetchImpl!=='function')throw Error('FETCH_NOT_AVAILABLE');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetchImpl(url,{headers,signal:controller.signal});
    if(!response||typeof response.ok!=='boolean')throw Error('INVALID_RESPONSE');
    if(!response.ok)throw Error('HTTP '+response.status+' '+url);
    return kind==='json'?await response.json():await response.text();
  }catch(err){
    if(controller.signal.aborted)throw Error('UPSTREAM_TIMEOUT '+timeoutMs+'ms');
    throw err;
  }finally{
    clearTimeout(timer);
  }
}
module.exports={fetchBody};
