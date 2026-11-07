// Public-source OHLC adapters. Research only; no order execution or live trading.
const ALLOWED=new Set(['BTCUSD','XAUUSD','EURUSD','GBPUSD','USDJPY','WTI','BRENT']);
export function normalizeProviderBars(rows,{provider,symbol,timeframe,now=Date.now()}){
 if(!ALLOWED.has(symbol)||!['M1','M5','M15','H1','H4','D1'].includes(timeframe)||!Array.isArray(rows)||rows.length>5000)throw Error('Invalid OHLC request');
 const duration={M1:60000,M5:300000,M15:900000,H1:3600000,H4:14400000,D1:86400000}[timeframe];
 const normalized=[];
 for(const r of rows){
  const t=typeof r.time==='number'?r.time:typeof r.timestamp==='number'?r.timestamp:Date.parse(r.time??r.timestamp??'');
  const openTime=t<1e11?t*1000:t;
  const open=Number(r.open??r.o),high=Number(r.high??r.h),low=Number(r.low??r.l),close=Number(r.close??r.c);
  if(!Number.isSafeInteger(openTime)||![open,high,low,close].every(Number.isFinite)||high<Math.max(open,close)||low>Math.min(open,close))continue;
  if(openTime+duration>now)continue; // discard unfinished candles
  normalized.push({provider,symbol,timeframe,openTime,closeTime:openTime+duration,open,high,low,close});
 }
 normalized.sort((a,b)=>a.openTime-b.openTime);
 return normalized.filter((b,i)=>i===0||b.openTime!==normalized[i-1].openTime);
}
export async function fetchKrakenBTC({interval=1,now=Date.now(),fetchImpl=fetch}={}){
 if(![1,5,15,60,240,1440].includes(interval))throw Error('Unsupported Kraken interval');
 const url='https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval='+interval;
 const response=await fetchImpl(url,{signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Kraken HTTP '+response.status);
 const payload=await response.json();
 if(!Array.isArray(payload.error)||payload.error.length)throw Error('Kraken upstream error');
 const key=Object.keys(payload.result||{}).find(k=>k!=='last');
 if(!key||!Array.isArray(payload.result[key]))throw Error('Invalid Kraken OHLC payload');
 const tf={1:'M1',5:'M5',15:'M15',60:'H1',240:'H4',1440:'D1'}[interval];
 return normalizeProviderBars(payload.result[key].map(v=>({time:v[0],open:v[1],high:v[2],low:v[3],close:v[4]})),{provider:'kraken',symbol:'BTCUSD',timeframe:tf,now});
}
