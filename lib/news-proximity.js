'use strict';
function eventTime(e){const v=e&&[e.timestamp,e.time,e.date,e.eventAt,e.scheduledAt].find(Boolean);if(!v)return null;const t=new Date(v).getTime();return Number.isFinite(t)?t:null;}
function importance(e){return String(e&&e.impact||e&&e.importance||'UNKNOWN').toUpperCase();}
function relevant(e,currencies=['USD']){const c=String(e&&e.country||e&&e.currency||'').toUpperCase();return !currencies.length||currencies.some(x=>c.includes(String(x).toUpperCase()));}
function proximity(events,{now=Date.now(),currencies=['USD'],preMinutes=60,releaseMinutes=5,postMinutes=120}={}){
 const rows=(events||[]).filter(e=>relevant(e,currencies)).map(e=>({...e,_t:eventTime(e)})).filter(e=>e._t!=null).sort((a,b)=>Math.abs(a._t-now)-Math.abs(b._t-now));
 const e=rows[0];if(!e)return {state:'NO_EVENT',event:null,minutes:null};const mins=(e._t-now)/60000,abs=Math.abs(mins);let state='NORMAL';if(abs<=releaseMinutes)state='NEWS_RELEASE';else if(mins>0&&mins<=preMinutes)state='PRE_NEWS';else if(mins<0&&abs<=postMinutes)state='POST_NEWS';
 return {state,event:{title:e.title||e.event||'Economic event',currency:e.currency||e.country||null,impact:importance(e),actual:e.actual??null,forecast:e.forecast??null,previous:e.previous??null,time:new Date(e._t).toISOString()},minutes:+mins.toFixed(1)};
}
module.exports={eventTime,importance,relevant,proximity};
