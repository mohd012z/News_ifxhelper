'use strict';
const B=require('./bbma-engine');
function pct(a,b){return Number.isFinite(+a)&&Number.isFinite(+b)&&+b!==0?((+a-+b)/Math.abs(+b))*100:null;}
function location(candles){
 const x=B.classify(candles);if(x.state!=='READY')return x;
 const v=x.values,last=candles.at(-1),tol=Math.max((v.bb.upper-v.bb.lower)*0.03,Math.abs(v.close)*0.00015);
 const near=(a,b)=>Math.abs(a-b)<=tol;
 let zone='INSIDE_BB';
 if(last.close>v.bb.upper)zone='ABOVE_TOP_BB'; else if(last.close<v.bb.lower)zone='BELOW_LOW_BB';
 else if(near(last.high,v.bb.upper)||near(last.close,v.bb.upper))zone='TOP_BB';
 else if(near(last.low,v.bb.lower)||near(last.close,v.bb.lower))zone='LOW_BB';
 else if(near(last.close,v.bb.mid)||last.low<=v.bb.mid&&last.high>=v.bb.mid)zone='MID_BB';
 else if(near(last.close,v.ema50)||last.low<=v.ema50&&last.high>=v.ema50)zone='EMA50';
 const body=Math.abs(last.close-last.open),range=Math.max(1e-12,last.high-last.low),bodyRatio=body/range;
 return {...x,zone,tolerance:tol,candle:{direction:last.close>last.open?'UP':last.close<last.open?'DOWN':'FLAT',bodyRatio:+bodyRatio.toFixed(3),upperWick:+((last.high-Math.max(last.open,last.close))/range).toFixed(3),lowerWick:+((Math.min(last.open,last.close)-last.low)/range).toFixed(3)},distance:{topPct:pct(v.bb.upper,v.close),midPct:pct(v.bb.mid,v.close),lowPct:pct(v.bb.lower,v.close),ema50Pct:pct(v.ema50,v.close)}};
}
function squeezeHistory(candles,lookback=20){
 if(!candles||candles.length<50+lookback)return {state:'INSUFFICIENT_DATA'};
 const widths=[];for(let i=candles.length-lookback;i<candles.length;i++){const b=B.bands(candles.slice(0,i+1));if(b&&Number.isFinite(b.widthPct))widths.push(b.widthPct);}
 const current=widths.at(-1),sorted=[...widths].sort((a,b)=>a-b),rank=sorted.length?sorted.filter(v=>v<=current).length/sorted.length:null;
 return {state:'READY',widthPct:+current.toFixed(4),percentile:rank==null?null:+(rank*100).toFixed(1),squeeze:rank!=null&&rank<=.2?'SQUEEZE':rank!=null&&rank<=.4?'TIGHT':'NORMAL',expanding:widths.length>1&&current>widths.at(-2)};
}
function oneStepAhead(candles){
 const l=location(candles),sq=squeezeHistory(candles);if(l.state!=='READY')return {state:'INSUFFICIENT_DATA'};
 let up=0,down=0,range=0;const reasons=[];
 if(l.trend==='UP'){up+=2;reasons.push('trend_up');}else if(l.trend==='DOWN'){down+=2;reasons.push('trend_down');}else range++;
 if(l.momentum==='MOMENTUM_UP'){up+=2;reasons.push('bb_momentum_up');}if(l.momentum==='MOMENTUM_DOWN'){down+=2;reasons.push('bb_momentum_down');}
 if(l.reentry==='REENTRY_UP_ZONE'){up+=1;reasons.push('reentry_up');}if(l.reentry==='REENTRY_DOWN_ZONE'){down+=1;reasons.push('reentry_down');}
 if(l.zone==='TOP_BB'&&l.candle.upperWick>.45){down+=1;reasons.push('top_rejection_candidate');}
 if(l.zone==='LOW_BB'&&l.candle.lowerWick>.45){up+=1;reasons.push('low_rejection_candidate');}
 if(sq.squeeze==='SQUEEZE'){range+=2;reasons.push('squeeze_pre_breakout');}
 const total=up+down+range||1,max=Math.max(up,down,range),state=max===range?'RANGE_OR_BREAKOUT_WATCH':up===down?'MIXED':up>down?'UP_BIAS':'DOWN_BIAS';
 return {state,confidence:Math.round(max/total*100),scores:{up,down,range},reasons,location:l.zone,squeeze:sq.squeeze,dataNote:'Research bias only; validate on next closed candle and historical samples.'};
}
module.exports={location,squeezeHistory,oneStepAhead};
