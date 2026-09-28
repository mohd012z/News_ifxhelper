'use strict';
/* NewsBrain — "what changed externally?" (P2).
 *
 * Wraps the existing event lifecycle (news-proximity state) and adds surprise
 * normalization + news strength. Spec §19: predict the REACTION, not the
 * headline direction. Output strength: NEWS_EFFECT_NONE | LOW | MODERATE |
 * HIGH | REGIME_CHANGE.
 */
/* surprise from actual vs forecast (numeric where possible) */
function surprise(ev){
  if(!ev)return {type:'UNKNOWN',dir:0,known:false};
  var a=ev.actual,f=ev.forecast;
  var na=Number(a),nf=Number(f);
  if(!isFinite(na))return {type:'UNKNOWN',dir:0,known:false};
  if(!isFinite(nf))return {type:'REVISED',dir:0,known:false};
  var d=na-nf;
  if(Math.abs(d)<1e-9)return {type:'IN_LINE',dir:0,known:true};
  var rel=Math.abs(d)/Math.max(1e-9,Math.abs(nf));
  return {type:rel>0.25?'BIG':rel>0.05?'MODERATE':'SMALL',dir:Math.sign(d),known:true};
}
function strength(news,surp){
  var imp=String((news&&news.event&&news.event.impact)||'UNKNOWN').toUpperCase();
  var state=String((news&&news.state)||'NO_EVENT').toUpperCase();
  if(state==='NO_EVENT')return 'NEWS_EFFECT_NONE';
  var base={CRITICAL:4,HIGH:3,MEDIUM:2,LOW:1,MODERATE:2,UNKNOWN:1}[imp]||1;
  var mult=1;
  if(state==='NEWS_RELEASE')mult=1.5;
  if(surp&&surp.known&&surp.type==='BIG')mult=1.5;
  if(surp&&surp.known&&surp.type==='MODERATE')mult=1.2;
  var score=base*mult;
  if(score>=4.5)return 'REGIME_CHANGE';
  if(score>=3)return 'HIGH';
  if(score>=2)return 'MODERATE';
  return 'LOW';
}
function analyze(news){
  news=news||{state:'NO_EVENT'};
  var s=surprise(news.event);
  var st=strength(news,s);
  var pass=st==='NEWS_EFFECT_NONE'||st==='LOW'; /* publishable-when-clear */
  return {state:news.state,event:news.event||null,minutes:news.minutes!=null?news.minutes:null,surprise:s,strength:st,pass:pass,note:st==='REGIME_CHANGE'?'news may redefine the regime — do not extrapolate pre-news behavior':'standard news context'};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMANewsBrain=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {analyze:analyze,surprise:surprise,strength:strength};});
