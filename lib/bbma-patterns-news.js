'use strict';
const ORDER=['MN1','W1','D1','H4','H1','M30','M15','M5'];
function analyze(input={}){const mtf=input.mtf||{},event=input.event||null,patterns=[],alerts=[];
for(const tf of ORDER){const x=mtf[tf];if(!x)continue;const re=String(x.reentry||''),csa=String(x.csa||x.csak||''),ex=String(x.extreme||''),mom=String(x.momentum||'');
if(/REENTRY/.test(re))patterns.push({tf,type:'REENTRY',side:/UP|BUY/.test(re)?'BUY':'SELL',state:re});
if(/CSA/.test(csa))patterns.push({tf,type:'CSA',side:/UP|BUY/.test(csa)?'BUY':'SELL',state:csa});
if(/EXTREME/.test(ex)&&!/NONE/.test(ex))patterns.push({tf,type:'EXTREME',side:/HIGH/.test(ex)?'SELL_CONTEXT':'BUY_CONTEXT',state:ex});
/* MHV context: momentum conflicts with the prevailing frame trend/extreme. Descriptive only. */
if((x.trend==='DOWN'&&mom==='MOMENTUM_UP')||(x.trend==='UP'&&mom==='MOMENTUM_DOWN')||(ex==='EXTREME_HIGH'&&mom==='MOMENTUM_DOWN')||(ex==='EXTREME_LOW'&&mom==='MOMENTUM_UP'))patterns.push({tf,type:'MHV',side:/UP/.test(mom)?'BUY_CONTEXT':'SELL_CONTEXT',state:'MOMENTUM_VS_STRUCTURE'});
}
const mins=event&&Number.isFinite(+event.minutesTo)?+event.minutesTo:null,high=event&&String(event.impact||'').toUpperCase()==='HIGH';const newsWindow=mins==null?'NONE':mins>=0?'PRE_EVENT':'POST_EVENT';
if(high&&mins!==null&&Math.abs(mins)<=30&&patterns.length)alerts.push({code:'NEWS_BBMA_SETUP',level:'HIGH',text:(event.name||'High-impact news')+' intersects '+patterns.map(p=>p.tf+' '+p.type).join(', ')});
const grouped={REENTRY:[],CSA:[],MHV:[],EXTREME:[]};for(const p of patterns)grouped[p.type].push(p);
return {patterns,grouped,alerts,newsWindow,event};}
module.exports={analyze};
