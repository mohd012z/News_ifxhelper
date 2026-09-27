'use strict';
/**
 * Classifies what price does around BB upper/lower/mid and EMA50 during an event window.
 * Descriptive research output only: band/EMA touches are not assumed to be reversals.
 */
function n(v){return Number.isFinite(+v)?+v:null;}
function distPct(price,level){price=n(price);level=n(level);return price!=null&&level?((price-level)/level)*100:null;}
function near(price,level,tolerancePct){const d=distPct(price,level);return d!=null&&Math.abs(d)<=tolerancePct;}
function side(price,level){price=n(price);level=n(level);return price==null||level==null?'UNKNOWN':price>level?'ABOVE':price<level?'BELOW':'AT';}
function classify(input){
 const p=n(input.price), prev=n(input.prevClose), upper=n(input.upper), lower=n(input.lower), mid=n(input.mid), ema50=n(input.ema50), atr=n(input.atr);
 const tol=Math.max(0.03,Math.min(0.30,Number.isFinite(+input.tolerancePct)?+input.tolerancePct:(p&&atr?atr/p*100*0.15:0.08)));
 if([p,upper,lower,mid,ema50].some(x=>x==null))return {state:'INSUFFICIENT_DATA',tolerancePct:tol};
 const atUpper=near(p,upper,tol), atLower=near(p,lower,tol), atEma50=near(p,ema50,tol), atMid=near(p,mid,tol);
 const outsideUpper=p>upper, outsideLower=p<lower;
 const prevUpper=prev!=null?side(prev,upper):'UNKNOWN', prevLower=prev!=null?side(prev,lower):'UNKNOWN';
 let zone=atUpper?'UPPER_BAND':atLower?'LOWER_BAND':atEma50?'EMA50':atMid?'MID_BAND':outsideUpper?'ABOVE_UPPER':outsideLower?'BELOW_LOWER':'INSIDE_BANDS';
 let behavior='OBSERVE';
 // A rejection requires evidence of moving back from the level, not merely touching it.
 if(atUpper&&prev!=null&&p<prev)behavior='UPPER_REJECTION';
 else if(atLower&&prev!=null&&p>prev)behavior='LOWER_REJECTION';
 else if(atEma50&&prev!=null&&((prev<ema50&&p>=ema50)||(prev>ema50&&p<=ema50)))behavior='EMA50_TEST';
 else if(outsideUpper)behavior='UPPER_BREAKOUT_OR_EXPANSION';
 else if(outsideLower)behavior='LOWER_BREAKOUT_OR_EXPANSION';
 return {state:'READY',zone,behavior,tolerancePct:+tol.toFixed(4),distance:{upperPct:distPct(p,upper),lowerPct:distPct(p,lower),midPct:distPct(p,mid),ema50Pct:distPct(p,ema50)},context:{prevUpper,prevLower}};
}
function eventReaction(input){
 const x=classify(input);
 if(x.state!=='READY')return x;
 const news=input.news||{};
 const volatility=String(input.volatility||'UNKNOWN').toUpperCase();
 const mtf=String(input.mtfAlignment||'UNKNOWN').toUpperCase();
 let reversalEvidence='LOW';
 const rejection=/REJECTION|EMA50_TEST/.test(x.behavior);
 const conflict=String(news.state||'').toUpperCase()==='CONFLICT'||mtf==='MIXED';
 if(rejection&&conflict)reversalEvidence='MODERATE';
 if(rejection&&conflict&&volatility==='EXPANDING')reversalEvidence='ELEVATED_BUT_UNCONFIRMED';
 return {...x,reversalEvidence,explanation:'Level contact is context only. Require closed-candle rejection/acceptance, multi-timeframe structure, event surprise, volatility and subsequent price reaction before classifying reversal versus continuation.'};
}
module.exports={distPct,near,side,classify,eventReaction};
