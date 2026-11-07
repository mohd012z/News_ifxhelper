'use strict';
/** Pure, opt-in structural supply/demand research. No network, orders or alerts. */
const {classify}=require('./bbma-engine');
const TYPES={RBR:'DEMAND',DBR:'DEMAND',DBD:'SUPPLY',RBD:'SUPPLY'};
function validate(c){
 if(!Array.isArray(c))throw new TypeError('candles must be an array');
 let prev=-Infinity;
 return c.map((x,i)=>{
  if(!x||x.complete!==true||!['OBSERVED','VERIFIED','LIVE_TICK_DERIVED','HISTORICAL'].includes(x.source))throw new TypeError('unverified or incomplete candle at '+i);
  const t=Date.parse(x.time),o=Number(x.open),h=Number(x.high),l=Number(x.low),cl=Number(x.close);
  if(!Number.isFinite(t)||t<=prev||![o,h,l,cl].every(Number.isFinite)||l<=0||l>Math.min(o,cl)||h<Math.max(o,cl))throw new TypeError('invalid OHLC or timestamp at '+i);
  prev=t;return {time:x.time,t,open:o,high:h,low:l,close:cl};
 });
}
function atrAt(a,end,n=14){
 if(end<n)return null;
 let sum=0;
 for(let i=end-n+1;i<=end;i++)sum+=Math.max(a[i].high-a[i].low,Math.abs(a[i].high-a[i-1].close),Math.abs(a[i].low-a[i-1].close));
 return sum/n;
}
function detect(candles,opts={}){
 const a=validate(candles),baseMin=opts.baseMin??2,baseMax=opts.baseMax??4,impulse=opts.impulse??1.25,baseRatio=opts.baseRatio??0.8;
 if(!Number.isInteger(baseMin)||!Number.isInteger(baseMax)||baseMin<1||baseMax<baseMin||baseMax>10||!Number.isFinite(impulse)||impulse<=0||!Number.isFinite(baseRatio)||baseRatio<=0)throw new RangeError('invalid detector options');
 const zones=[],keys=new Set();
 for(let departure=15;departure<a.length;departure++){
  const vol=atrAt(a,departure-1);if(!(vol>0))continue;
  const d=a[departure],body=Math.abs(d.close-d.open);
  if(body<impulse*vol)continue;
  const dir=d.close>d.open?'UP':'DOWN';
  for(let len=baseMin;len<=baseMax;len++){
   const start=departure-len;if(start<1)continue;
   const base=a.slice(start,departure),rangeHigh=Math.max(...base.map(x=>x.high)),rangeLow=Math.min(...base.map(x=>x.low));
   if(rangeHigh-rangeLow>baseRatio*vol*len)continue;
   if(base.some(x=>Math.abs(x.close-x.open)>baseRatio*vol))continue;
   if(dir==='UP'&&d.close<=rangeHigh||dir==='DOWN'&&d.close>=rangeLow)continue;
   const prior=a[start-1],arrival=prior.close>base[0].open?'DOWN':prior.close<base[0].open?'UP':null;
   if(!arrival)continue;
   const type=(arrival==='UP'?'R':'D')+'B'+(dir==='UP'?'R':'D');
   if(!TYPES[type])continue;
   const key=start+':'+dir;if(keys.has(key))continue;keys.add(key);
   const proximal=dir==='UP'?Math.max(...base.map(x=>Math.max(x.open,x.close))):Math.min(...base.map(x=>Math.min(x.open,x.close)));
   const distal=dir==='UP'?rangeLow:rangeHigh;
   if(dir==='UP'&&proximal<=distal||dir==='DOWN'&&proximal>=distal)continue;
   const zone={id:a[start].time+'/'+type,type,side:TYPES[type],baseStart:a[start].time,baseEnd:a[departure-1].time,confirmedAt:d.time,proximal,distal,status:'FRESH',touches:0,invalidatedAt:null,firstTouchAt:null};
   for(let i=departure+1;i<a.length;i++){
    const x=a[i],intersects=x.low<=Math.max(proximal,distal)&&x.high>=Math.min(proximal,distal);
    const invalid=dir==='UP'?x.close<distal:x.close>distal;
    if(invalid){zone.status='INVALIDATED';zone.invalidatedAt=x.time;break;}
    if(intersects){zone.touches++;zone.firstTouchAt??=x.time;zone.status=zone.touches===1?'TESTED':'MITIGATED';}
   }
   zones.push(zone);break;
  }
 }
 return zones;
}
function confluence(zone,candles){
 if(!zone||!TYPES[zone.type]||zone.side!==TYPES[zone.type])throw new TypeError('invalid zone');
 const a=validate(candles),eligible=a.filter(x=>x.t<=Date.parse(zone.confirmedAt));
 if(eligible.length<50)return {state:'INSUFFICIENT_DATA',bbma:null};
 const b=classify(eligible.map(({time,open,high,low,close})=>({time,open,high,low,close})));
 if(b.state!=='READY')return {state:'INSUFFICIENT_DATA',bbma:null};
 const aligned=zone.side==='DEMAND'?b.trend==='UP':b.trend==='DOWN';
 return {state:aligned?'ALIGNED':'NOT_ALIGNED',bbma:{trend:b.trend,zone:b.zone,lastTime:b.lastTime},evaluatedAt:eligible.at(-1).time};
}
module.exports={detect,confluence,validate,atrAt};
