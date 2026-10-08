'use strict';

const fs=require('fs');
const path=require('path');
const {mergeSnapshot}=require('./lib/calendar-heartbeat');

const ROOT=__dirname;
const FILE=path.join(ROOT,'news-auto.js');
const URL='https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const UA={'User-Agent':'Mozilla/5.0 XAU-Desk-CalendarHeartbeat/1.0'};

function parseNewsFile(text){
  const marker='window.NEWS_AUTO = ';
  const start=text.indexOf(marker);
  if(start<0) throw new Error('NEWS_AUTO assignment missing');
  const jsonStart=start+marker.length;
  const suffixAt=text.indexOf('\n\n/* Merges',jsonStart);
  if(suffixAt<0) throw new Error('NEWS_AUTO suffix marker missing');
  const raw=text.slice(jsonStart,suffixAt).trim().replace(/;\s*$/,'');
  return {snapshot:JSON.parse(raw),prefix:text.slice(0,jsonStart),suffix:text.slice(suffixAt)};
}
async function main(){
  const current=fs.readFileSync(FILE,'utf8');
  const parsed=parseNewsFile(current);
  const r=await fetch(URL,{headers:UA,cache:'no-store'});
  if(!r.ok) throw new Error('calendar heartbeat HTTP '+r.status);
  const events=await r.json();
  if(!Array.isArray(events)||!events.length) throw new Error('calendar heartbeat returned no events');
  const now=new Date().toISOString();
  const result=mergeSnapshot(parsed.snapshot,events,now);
  if(!result.changed){
    console.log('calendar heartbeat: no provider changes; snapshot unchanged; rows='+result.week.length);
    return;
  }
  const output=parsed.prefix+JSON.stringify(result.snapshot,null,2)+';'+parsed.suffix;
  fs.writeFileSync(FILE,output,'utf8');
  console.log('calendar heartbeat: updated news-auto.js rows='+result.week.length+' at '+now);
}
if(require.main===module) main().catch(e=>{console.error('calendar heartbeat failed:',e);process.exit(1);});
module.exports={parseNewsFile};
