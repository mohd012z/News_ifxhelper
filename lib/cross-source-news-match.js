'use strict';
// Cross-provider event identity; does not scrape sites or imply licensed access.
const SOURCES=new Set(['forexfactory','investing','tradingview']);
function keyOf(e){
 if(!e||typeof e!=='object')return null;
 const currency=String(e.currency||'').trim().toUpperCase();
 const title=String(e.event||e.title||'').toLowerCase().normalize('NFKC').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
 const at=Date.parse(e.scheduledAt||'');
 if(!/^[A-Z]{3}$/.test(currency)||title.length<6||!Number.isFinite(at))return null;
 // Exact minute avoids conflating different releases; timestamps must include offsets.
 if(!/(Z|[+-]\d\d:\d\d)$/.test(String(e.scheduledAt)))return null;
 return currency+'|'+new Date(at).toISOString().slice(0,16)+'|'+title;
}
function sourceOf(e){return String(e.provider||e.source||'').toLowerCase().replace(/[^a-z]/g,'');}
function matchEvents(events,{minimumSources=2}={}){
 const groups=new Map();
 for(const e of Array.isArray(events)?events:[]){
  const key=keyOf(e),provider=sourceOf(e);
  if(!key||!SOURCES.has(provider))continue;
  const group=groups.get(key)||new Map();
  if(!group.has(provider))group.set(provider,e);
  groups.set(key,group);
 }
 return [...groups].map(([key,sources])=>({
  key,providers:[...sources.keys()].sort(),matched:sources.size>=minimumSources,
  event:[...sources.values()][0],
  urls:[...sources.values()].map(e=>e.url).filter(u=>{try{return new URL(u).protocol==='https:';}catch{return false;}}),
  verification:'event-identity-only; actual/forecast values and publication content not verified'
 })).filter(x=>x.matched);
}
function draftMatchedAlert(group){
 if(!group?.matched||group.providers.length<2)return null;
 const e=group.event;
 return {key:'telegram:matched:'+group.key,requiresApproval:true,send:false,
  text:'MULTI-SOURCE ECONOMIC EVENT (RESEARCH ONLY)\n'+String(e.currency)+' — '+String(e.event||e.title)+'\nScheduled: '+String(e.scheduledAt)+'\nSources: '+group.providers.join(', ')+'\nEvent match only; figures and impact unverified. No trade recommendation.'};
}
module.exports={keyOf,matchEvents,draftMatchedAlert};
