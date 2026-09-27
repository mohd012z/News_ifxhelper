'use strict';
const PRE=[['T-24H',1440],['T-6H',360],['T-1H',60],['T-30M',30],['T-15M',15],['T-5M',5],['PRE_EVENT_FREEZE',1]];
const POST={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240};
function ms(time){const x=new Date(time).getTime();if(!Number.isFinite(x))throw new Error('Invalid event time');return x;}
function schedule(eventTime){const t=ms(eventTime);return PRE.map(([name,min])=>({name,minutesBefore:min,at:new Date(t-min*60000).toISOString()}));}
function due(eventTime,now,{completed=[]}={}){const n=ms(now),done=new Set(completed);return schedule(eventTime).filter(x=>!done.has(x.name)&&n>=ms(x.at)&&n<ms(eventTime));}
function reactionCheckpoints(eventTime){const t=ms(eventTime),out={};for(const [name,min] of Object.entries(POST))out[name]=new Date(t+min*60000).toISOString();return out;}
function exactCheckpoint(candles,target){const t=ms(target);return (candles||[]).find(x=>new Date(x.time).getTime()===t)||null;}
function captureReactions(eventTime,frames={}){const targets=reactionCheckpoints(eventTime),out={};for(const [tf,target] of Object.entries(targets))out[tf]={target,candle:exactCheckpoint(frames[tf]||frames.M1||[],target),state:'MISSING'};for(const x of Object.values(out))if(x.candle)x.state='EXACT';return out;}
module.exports={PRE,POST,schedule,due,reactionCheckpoints,exactCheckpoint,captureReactions};
