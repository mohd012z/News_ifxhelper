// Lossless, deterministic CSV exchange format for closed OHLC candles.
// Use per-provider/per-symbol/per-timeframe files; never merge broker prices.
const HEADER='provider,symbol,timeframe,open_time_utc,close_time_utc,open,high,low,close';
const DUR={M1:60000,M5:300000,M15:900000,M30:1800000,H1:3600000,H4:14400000,D1:86400000};
const ID=/^[a-zA-Z0-9_.-]{1,48}$/;
function validate(b,now){
 if(!b||!ID.test(b.provider)||!ID.test(b.symbol)||!Object.hasOwn(DUR,b.timeframe))throw Error('Invalid candle identity');
 if(!Number.isSafeInteger(b.openTime)||!Number.isSafeInteger(b.closeTime)||b.closeTime-b.openTime!==DUR[b.timeframe]||b.closeTime>now)throw Error('Invalid or unfinished candle');
 if(![b.open,b.high,b.low,b.close].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))throw Error('Invalid candle price');
}
export function candlesToCSV(candles,{now=Date.now()}={}){
 if(!Array.isArray(candles)||candles.length>100000)throw Error('Invalid candle collection');
 const seen=new Set(),out=[HEADER];
 for(const b of candles){
  validate(b,now);
  const key=[b.provider,b.symbol,b.timeframe,b.openTime].join('|');
  if(seen.has(key))throw Error('Duplicate candle');seen.add(key);
  out.push([b.provider,b.symbol,b.timeframe,new Date(b.openTime).toISOString(),new Date(b.closeTime).toISOString(),b.open,b.high,b.low,b.close].join(','));
 }
 return out.join('\n')+'\n';
}
export function candlesFromCSV(csv,{now=Date.now()}={}){
 if(typeof csv!=='string'||csv.length>16000000)throw Error('Invalid CSV size');
 const lines=csv.trimEnd().split(/\r?\n/);
 if(lines.shift()!==HEADER||lines.length>100000)throw Error('Invalid CSV header or size');
 const candles=lines.map(line=>{
  const f=line.split(',');if(f.length!==9)throw Error('Malformed CSV row');
  const [provider,symbol,timeframe,opening,closing,...prices]=f;
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(opening)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(closing)||prices.some(v=>!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(v)))throw Error('Malformed CSV values');
  const b={provider,symbol,timeframe,openTime:Date.parse(opening),closeTime:Date.parse(closing),open:Number(prices[0]),high:Number(prices[1]),low:Number(prices[2]),close:Number(prices[3])};
  validate(b,now);return b;
 });
 const unique=new Set(candles.map(b=>[b.provider,b.symbol,b.timeframe,b.openTime].join('|')));
 if(unique.size!==candles.length)throw Error('Duplicate candle');
 return candles;
}
export function prepareBBMAFromCSV(csv,{provider,symbol,timeframe,now=Date.now()}){
 const rows=candlesFromCSV(csv,{now}).filter(b=>b.provider===provider&&b.symbol===symbol&&b.timeframe===timeframe).sort((a,b)=>a.openTime-b.openTime);
 if(rows.length<55)throw Error('Insufficient closed candles for BBMA');
 for(let i=1;i<rows.length;i++)if(rows[i].openTime-rows[i-1].openTime!==DUR[timeframe])throw Error('Candle gap: analysis withheld');
 return rows;
}
