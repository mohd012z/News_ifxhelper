'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const P=require('./lib/market-provider'),V=require('./lib/ohlc-validator'),R=require('./lib/ohlc-resampler'),W=require('./lib/bbma-candle-watch'),D=require('./lib/bbma-dashboard'),N=require('./lib/news-proximity');
const SYMBOL=process.env.BBMA_SYMBOL||'GC=F',OUT=process.env.BBMA_OUT||path.join('data','bbma-watch.json');
const CAL='https://nfs.faireconomy.media/ff_calendar_thisweek.json';
function generationId(symbol,candles,events){const last=candles.at(-1);const basis=JSON.stringify({symbol,last:last&&last.time,count:candles.length,events:(events||[]).slice(0,20).map(e=>[e.date||e.scheduledAt||e.time,e.title||e.event,e.actual,e.forecast])});return 'bbma-'+crypto.createHash('sha256').update(basis).digest('hex').slice(0,20);}
async function calendar(){try{const r=await fetch(CAL,{headers:{'User-Agent':'Mozilla/5.0 XAU-Desk-BBMA/1.0'}});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();return Array.isArray(j)?j:[];}catch(e){console.warn('calendar unavailable:',e.message);return [];}}
(async()=>{
 const [r,events]=await Promise.all([P.yahoo(SYMBOL,{interval:'1m',range:'5d',timeoutMs:12000}),calendar()]);
 const s=V.validateSeries(r.candles,{timeframeMinutes:1}),clean=s.candles.filter(x=>x.valid).map(x=>({time:x.time,open:x.open,high:x.high,low:x.low,close:x.close,volume:x.volume}));
 const frames=R.buildFrames(clean),analysis={};for(const [tf,c] of Object.entries(frames)){if(c.length<50)continue;analysis[tf]={bbma:W.location(c),squeeze:W.squeezeHistory(c),next:W.oneStepAhead(c)};}
 const news=N.proximity(events,{currencies:['USD'],preMinutes:60,releaseMinutes:5,postMinutes:120});
 for(const x of Object.values(analysis)){x.marketMode=news.state;x.next.newsState=news.state;if(news.state==='NEWS_RELEASE')x.next.confidence=Math.min(x.next.confidence,55);else if(news.state==='PRE_NEWS')x.next.confidence=Math.min(x.next.confidence,65);}
 const dash=D.build(frames,Object.fromEntries(Object.keys(frames).map(tf=>[tf,s.gaps.length?'NEAR':'EXACT']))),generatedAt=new Date().toISOString();
 const out={schemaVersion:3,generationId:generationId(SYMBOL,clean,events),generatedAt,sourceGeneratedAt:generatedAt,symbol:SYMBOL,provider:r.provider,httpMs:r.httpMs,source:{candles:r.candles.length,valid:clean.length,gaps:s.gaps.length,duplicates:s.duplicates.length},news,analysis,dashboard:dash};
 fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(out,null,2));console.log('BBMA watch',SYMBOL,news.state,out.generationId,OUT,Object.keys(analysis).join(','));
})().catch(e=>{console.error(e);process.exit(1);});
