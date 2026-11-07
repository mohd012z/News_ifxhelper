// Research-only, closed-candle BBMA + supply/demand confluence classifier.
// Input is independently sourced, completed OHLC bars sorted oldest to newest.
// No order execution, predictions, or fabricated market data.
const TF=['MN1','W1','D1','H4','H1','M15'];
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
function ema(values,n){let e=mean(values.slice(0,n));for(let i=n;i<values.length;i++)e=(values[i]-e)*2/(n+1)+e;return e;}
function lwma(values,n){let sum=0,den=n*(n+1)/2;for(let i=0;i<n;i++)sum+=values[values.length-n+i]*(i+1);return sum/den;}
export function analyzeClosedBars(bars,{now=Date.now(),timeframe='H1'}={}){
 if(!TF.includes(timeframe))throw Error('Unsupported timeframe');
 if(!Array.isArray(bars)||bars.length<55||bars.length>5000)throw Error('Insufficient or excessive bars');
 let prev=-Infinity;
 for(const b of bars){
  if(!b||!Number.isSafeInteger(b.openTime)||!Number.isSafeInteger(b.closeTime)||b.openTime<=prev||b.closeTime<=b.openTime||b.closeTime>now||![b.open,b.high,b.low,b.close].every(Number.isFinite)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))throw Error('Invalid or unfinished OHLC');
  prev=b.openTime;
 }
 const close=bars.map(b=>b.close),high=bars.map(b=>b.high),low=bars.map(b=>b.low);
 const last=bars.at(-1),mid=mean(close.slice(-20)),variance=mean(close.slice(-20).map(v=>(v-mid)**2)),sd=Math.sqrt(variance);
 const upper=mid+2*sd,lower=mid-2*sd,ema50=ema(close,50);
 const lw5h=lwma(high,5),lw10h=lwma(high,10),lw5l=lwma(low,5),lw10l=lwma(low,10);
 const bias=last.close>ema50&&last.close>mid?'bullish':last.close<ema50&&last.close<mid?'bearish':'mixed';
 const recent=bars.slice(-31,-1); // zone origin must predate last closed candle
 const zones=[];
 for(let i=2;i<recent.length-2;i++){
  const b=recent[i],before=recent.slice(i-2,i),after=recent.slice(i+1,i+3);
  const baseRange=b.high-b.low;
  if(baseRange<=0)continue;
  const avg=mean(before.map(x=>x.high-x.low));
  if(baseRange>avg*0.75)continue;
  const demand=after.some(x=>x.close>b.high+baseRange),supply=after.some(x=>x.close<b.low-baseRange);
  if(demand&&!supply)zones.push({type:'demand',low:b.low,high:b.high,origin:b.openTime});
  if(supply&&!demand)zones.push({type:'supply',low:b.low,high:b.high,origin:b.openTime});
 }
 const active=zones.filter(z=>z.type==='demand'?last.low>=z.low:last.high<=z.high);
 const touching=active.filter(z=>last.low<=z.high&&last.high>=z.low);
 const confluence=touching.some(z=>(z.type==='demand'&&bias==='bullish')||(z.type==='supply'&&bias==='bearish'));
 return {timeframe,barClose:last.closeTime,bias,bbma:{ema50,midBB:mid,upperBB:upper,lowerBB:lower,lwma5High:lw5h,lwma10High:lw10h,lwma5Low:lw5l,lwma10Low:lw10l},zones:active.slice(-10),touching:touching.slice(-3),confluence,signal:'research_only'};
}
export function multiTimeframeSummary(series,{now=Date.now()}={}){
 if(!series||typeof series!=='object')throw Error('Missing timeframe series');
 const out={};
 for(const tf of TF){if(series[tf])out[tf]=analyzeClosedBars(series[tf],{now,timeframe:tf});}
 const higher=['MN1','W1','D1','H4'].filter(tf=>out[tf]);
 const bullish=higher.filter(tf=>out[tf].bias==='bullish').length,bearish=higher.filter(tf=>out[tf].bias==='bearish').length;
 return {timeframes:out,higherTimeframeBias:bullish>bearish?'bullish':bearish>bullish?'bearish':'mixed',confluenceTimeframes:Object.keys(out).filter(tf=>out[tf].confluence),limitations:['zones are heuristic, not verified institutional orders','no live feed or backtest implied','news can invalidate technical structure']};
}
