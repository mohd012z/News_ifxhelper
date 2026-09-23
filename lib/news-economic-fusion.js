'use strict';
const Econ=require('./economic-expectation-engine');
function toneText(items){
 const text=(items||[]).map(x=>[x.title,x.summary,x.text,x.quote].filter(Boolean).join(' ')).join(' ').toLowerCase();
 const hawk=(text.match(/\b(hawkish|inflation risk|inflation pressure|higher for longer|tightening|rate hike|raise rates|restrictive)\b/g)||[]).length;
 const dove=(text.match(/\b(dovish|disinflation|rate cut|cut rates|easing|slowing growth|labor weakness|labour weakness)\b/g)||[]).length;
 return {state:hawk>dove?'HAWKISH':dove>hawk?'DOVISH':hawk||dove?'MIXED':'NEUTRAL',hawk,dove};
}
function confidence(parts){let c=0;if(parts.economic.flags.hasForecast&&parts.economic.flags.hasPrior)c+=20;if(parts.economic.flags.hasActual)c+=30;if(parts.newsCount)c+=Math.min(20,parts.newsCount*5);if(parts.speech.state!=='NEUTRAL')c+=15;if(parts.officialCount)c+=15;return Math.min(100,c);}
function fuse(event,news,speeches){
 const economic=Econ.analyze(event||{}),speech=toneText(speeches),related=(news||[]).filter(Boolean),officialCount=related.concat(speeches||[]).filter(x=>/official|central bank|government|bureau|department|ministry/i.test(String(x.sourceClass||x.source||''))).length;
 const out={economic,speech,newsCount:related.length,officialCount};out.confidence=confidence(out);
 out.phase=economic.flags.hasActual?'POST_RELEASE':'PRE_RELEASE';
 out.summary=out.phase==='PRE_RELEASE'?`Consensus trend: ${economic.preRelease.direction} (${economic.preRelease.strength}). Await actual release.`:`Release: ${economic.postRelease.direction} (${economic.postRelease.strength}); speech tone ${speech.state}.`;
 return out;
}
module.exports={toneText,fuse};
