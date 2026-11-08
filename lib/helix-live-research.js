'use strict';
const {resample,buildFrames}=require('./ohlc-resampler');
const crypto=require('node:crypto');
const ALLOWED=new Set(['XAUUSD','BTCUSD','OIL']);
function timestamp(x,label){const t=new Date(x).getTime();if(!Number.isFinite(t))throw Error('INVALID_'+label);return t;}
function normalize(payload,{asOf,provider,symbol,timeframeMinutes=1,maxAgeMinutes=10}={}){
 if(!ALLOWED.has(symbol))throw Error('UNSUPPORTED_SYMBOL');
 if(!provider||!/^[-\w.]{2,80}$/.test(provider))throw Error('INVALID_PROVIDER');
 if(!Number.isInteger(timeframeMinutes)||timeframeMinutes<1)throw Error('INVALID_TIMEFRAME');
 const cutoff=timestamp(asOf,'ASOF');
 if(!Array.isArray(payload)||payload.length>50000)throw Error('INVALID_ROWS');
 const rows=payload.map(x=>{const t=timestamp(x.time,'TIME'),r=timestamp(x.receivedAt,'RECEIPT');
  const values=['open','high','low','close'].map(k=>Number(x[k]));
  if(values.some(v=>!Number.isFinite(v)||v<=0))throw Error('INVALID_OHLC');
  const [open,high,low,close]=values;
  if(high<Math.max(open,close)||low>Math.min(open,close)||low>high)throw Error('INVALID_RANGE');
  if(r<t+timeframeMinutes*60000)throw Error('RECEIPT_BEFORE_CLOSE');
  if(r>cutoff)throw Error('FUTURE_RECEIPT');
  if(t+timeframeMinutes*60000>cutoff)throw Error('FORMING_BAR');
  return {time:new Date(t).toISOString(),receivedAt:new Date(r).toISOString(),open,high,low,close,volume:x.volume==null?null:Number(x.volume)};
 });
 rows.sort((a,b)=>a.time.localeCompare(b.time));
 for(let i=1;i<rows.length;i++)if(rows[i].time===rows[i-1].time)throw Error('DUPLICATE_CANDLE');
 if(rows.length&&cutoff-(timestamp(rows.at(-1).time,'TIME')+timeframeMinutes*60000)>maxAgeMinutes*60000)throw Error('STALE_FEED');
 return {provider,symbol,timeframeMinutes,asOf:new Date(cutoff).toISOString(),rows};
}
function researchSnapshot(normalized,{sessionDates=null}={}){
 const {rows,asOf,provider,symbol,timeframeMinutes}=normalized;
 if(timeframeMinutes!==1)throw Error('M1_REQUIRED_FOR_MTF');
 const frames=buildFrames(rows,{asOf,sessionDates});
 const latest=frames.M1.at(-1)||null;
 const id=crypto.createHash('sha256').update(JSON.stringify({provider,symbol,asOf,latest:latest?.time||null})).digest('hex');
 return {id,provider,symbol,asOf,quality:latest?'VALIDATED':'INSUFFICIENT_DATA',frameCounts:Object.fromEntries(Object.entries(frames).map(([k,v])=>[k,v.length])),latestClosedBar:latest,deliveryEnabled:false};
}
function renderPreview(s){return ['HELIX RESEARCH PREVIEW','Symbol: '+s.symbol,'Provider: '+s.provider,'As of: '+s.asOf,'Data quality: '+s.quality,'Last closed M1: '+(s.latestClosedBar?.time||'none'),'MTF counts: '+JSON.stringify(s.frameCounts),'Research only; no trade instruction.'].join('\n');}
module.exports={normalize,researchSnapshot,renderPreview};
