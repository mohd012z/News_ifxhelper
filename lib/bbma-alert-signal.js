'use strict';
const ORDER=['M5','M15','M30','H1','H4','D1','W1','MN1'];
function dir(s){s=String(s||'').toUpperCase();if(/UP|BUY/.test(s))return 1;if(/DOWN|SELL/.test(s))return -1;return 0;}
function build(input={}){const mtf=input.mtf||{},ev=input.event||null,alerts=[],evidence=[];let up=0,down=0,valid=0,stale=[];
ORDER.forEach(tf=>{const x=mtf[tf];if(!x)return;if(x.fresh===false)stale.push(tf);const d=dir(x.state);if(d>0)up++;if(d<0)down++;valid++;evidence.push(tf+': '+(x.state||'UNKNOWN')+' @ '+(x.location||'UNKNOWN'));});
const high=ev&&String(ev.impact||'').toUpperCase()==='HIGH',mins=ev&&Number.isFinite(+ev.minutesTo)?+ev.minutesTo:null;
let newsWindow='NONE';if(mins!==null)newsWindow=mins>=0?'PRE_EVENT':'POST_EVENT';
if(stale.length)alerts.push({code:'STALE_BBMA',level:'BLOCK',text:'Stale BBMA: '+stale.join(', ')});
if(high&&mins!==null&&mins>=0&&mins<=30){const extreme=ORDER.some(tf=>{const x=mtf[tf]||{};return /UPPER|LOWER/.test(String(x.location||'').toUpperCase())||/EXTREME/.test(String(x.state||'').toUpperCase());});if(extreme)alerts.push({code:'NEWS_NEAR_BB_EXTREME',level:'HIGH',text:(ev.name||'High-impact news')+' approaching while price is at/near a BBMA extreme'});else alerts.push({code:'HIGH_IMPACT_NEAR',level:'HIGH',text:(ev.name||'High-impact news')+' within 30 minutes'});}
if(ev&&mins!==null&&mins<0&&ev.actual!=null){const surprise=ev.forecast!=null?(+ev.actual-(+ev.forecast)):null;alerts.push({code:'NEWS_RELEASED',level:'HIGH',text:(ev.name||'News')+' released'+(surprise===null?'':'; actual-forecast '+surprise.toFixed(3))});}
let signal='MIXED';if(valid&&up>=Math.max(3,down*2))signal='BULLISH_ALIGNMENT';else if(valid&&down>=Math.max(3,up*2))signal='BEARISH_ALIGNMENT';
const blocked=stale.length>0;
return {symbol:input.symbol||'',signal,blocked,newsWindow,alignment:{bullish:up,bearish:down,total:valid},alerts,evidence,event:ev};}
module.exports={build};
