'use strict';
/* IN_AI internal debate (spec §8) + Falsifier (the Critic brain).
 *
 * Instead of IN_AI -> answer, the system runs THREE independent case-builders
 * (BULL / BEAR / RANGE), each grounded ONLY in real evidence it is handed.
 * They all survive to the Kernel — the Kernel receives all three narratives,
 * never only the winner. Then a FALSIFIER attacks each case: for every claim
 * it names a concrete piece of counter-evidence, and the case's survival
 * depends on whether that counter-evidence is material.
 *
 * This is evidence-first and replayable: the Kernel's decision is a function of
 * the three surviving cases + the falsifier findings, not a mood.
 */
var NEWS_PASS=['CLEAR','NO_EVENT','NO_NEWS','NORMAL'];
function isNews(st){return NEWS_PASS.indexOf(String(st||'').toUpperCase())<0;}
/**
 * debate(ctx)
 *  ctx: { mtf:{tf:{trend}}, zone, pattern, squeeze, news:{state,event},
 *        atr, compare:{flag,rows}, confidence, recentAccuracy:{rate},
 *        instrument }
 * returns { cases:{BULL:{claims,evidence},BEAR:{...},RANGE:{...}},
 *           falsifier:{[case]:[{claim,counterEvidence,material}]},
 *           surviving:[caseNames], synthesis:{leading,spread,verdictInput} }
 */
function debate(ctx){
  ctx=ctx||{};
  var up=Object.keys(ctx.mtf||{}).filter(function(t){return (ctx.mtf[t]||{}).trend==='UP';});
  var dn=Object.keys(ctx.mtf||{}).filter(function(t){return (ctx.mtf[t]||{}).trend==='DOWN';});
  var bull=[];var bear=[];var range=[];
  var zone=String(ctx.zone||'').toUpperCase(),pattern=String(ctx.pattern||'').toUpperCase(),squeeze=String(ctx.squeeze||'').toUpperCase();
  /* ---- BULL ---- */
  if(up.length>=2)bull.push({claim:'HTF aligned UP ('+up.length+' TF)',material:true});
  if(/REENTRY_UP|MOMENTUM_UP/.test(pattern))bull.push({claim:'bullish BBMA pattern '+pattern,material:true});
  if(/LOW_BB|BELOW_LOW_BB/.test(zone))bull.push({claim:'reclaiming from low-BB value',material:true});
  if(ctx.compare&&ctx.compare.flag==='recent improvement')bull.push({claim:'recent accuracy improving',material:true});
  /* ---- BEAR ---- */
  if(dn.length>=2)bear.push({claim:'HTF aligned DOWN ('+dn.length+' TF)',material:true});
  if(/TOP_BB|ABOVE_TOP_BB/.test(zone))bear.push({claim:'top-side liquidity / resistance at high-BB',material:true});
  if(isNews(ctx.news&&ctx.news.state))bear.push({claim:'news event '+((ctx.news&&ctx.news.event)||'')+' approaching/active',material:true});
  if(ctx.compare&&ctx.compare.flag==='recent deterioration')bear.push({claim:'recent accuracy deteriorating',material:true});
  if(ctx.recentAccuracy!=null&&ctx.recentAccuracy<40&&ctx.compare&&ctx.compare.settledSamples>=10)bear.push({claim:'recent continuation low ('+ctx.recentAccuracy+'%)',material:true});
  /* ---- RANGE ---- */
  if(/SQUEEZE|TIGHT/.test(squeeze))range.push({claim:'compression / squeeze (low directional edge)',material:true});
  if((ctx.atr==='LOW'||ctx.atr==='NORMAL')&&up.length<2&&dn.length<2)range.push({claim:'no HTF alignment + low ATR',material:true});
  if(up.length&&dn.length)range.push({claim:'conflicting HTF (mixed)',material:true});
  if(!bull.length&&!bear.length)range.push({claim:'no directional edge evidenced',material:true});
  var cases={
    BULL:{claims:bull,evidence:{up:up,down:dn,zone:zone,pattern:pattern}},
    BEAR:{claims:bear,evidence:{up:up,down:dn,zone:zone,news:ctx.news&&ctx.news.state}},
    RANGE:{claims:range,evidence:{squeeze:squeeze,atr:ctx.atr,up:up,down:dn}}
  };
  /* ---- FALSIFIER: attack each case with specific counter-evidence ---- */
  var F={};
  F.BULL=falsify('BULL',cases,ctx);
  F.BEAR=falsify('BEAR',cases,ctx);
  F.RANGE=falsify('RANGE',cases,ctx);
  /* a case SURVIVES if it has a material claim AND no material counter-evidence
     that fully defeats it (>=2 material counters defeating it => dead). */
  var surviving=Object.keys(cases).filter(function(c){
    var mat=cases[c].claims.filter(function(x){return x.material;});
    var defeats=(F[c]||[]).filter(function(f){return f.material&&f.defeats;}).length;
    return mat.length>0&&defeats<mat.length;
  });
  var strength={};Object.keys(cases).forEach(function(c){strength[c]=cases[c].claims.filter(function(x){return x.material;}).length;});
  var leading=null,max=-1;Object.keys(strength).forEach(function(c){if(strength[c]>max){max=strength[c];leading=c;}});
  return {cases:cases,falsifier:F,surviving:surviving,strength:strength,
    synthesis:{leading:leading,spread:max,verdictInput:surviving.join(',')||'NONE',note:'Kernel receives ALL surviving cases + falsifier findings (not only the winner)'}};
}
function falsify(name,cases,ctx){
  var out=[];
  if(name==='BULL'){
    if((ctx.mtf&&Object.keys(ctx.mtf).filter(function(t){return (ctx.mtf[t]||{}).trend==='DOWN';}).length)>=2)out.push({claim:'HTF aligned UP',counterEvidence:'at least two HTF are DOWN',material:true,defeats:true});
    if(isNews(ctx.news&&ctx.news.state))out.push({claim:'continuation',counterEvidence:'news event active/approaching',material:true,defeats:false});
    if(ctx.compare&&ctx.compare.flag==='recent deterioration')out.push({claim:'setup works',counterEvidence:'recent accuracy deteriorating',material:true,defeats:true});
  }
  if(name==='BEAR'){
    if((ctx.mtf&&Object.keys(ctx.mtf).filter(function(t){return (ctx.mtf[t]||{}).trend==='UP';}).length)>=2)out.push({claim:'HTF aligned DOWN',counterEvidence:'at least two HTF are UP',material:true,defeats:true});
    if(/REENTRY_UP|MOMENTUM_UP/.test(String(ctx.pattern||'')))out.push({claim:'sell',counterEvidence:'bullish BBMA pattern present',material:true,defeats:false});
  }
  if(name==='RANGE'){
    if(/REENTRY|MOMENTUM/.test(String(ctx.pattern||''))&&(ctx.mtf&&Object.keys(ctx.mtf).length>=3))out.push({claim:'no edge',counterEvidence:'a directional BBMA pattern + full MTF set is present',material:true,defeats:false});
  }
  if(!out.length)out.push({claim:'(no material counter-evidence)',counterEvidence:'none found',material:false,defeats:false});
  return out;
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMADebate=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {debate:debate,falsify:falsify,NEWS_PASS:NEWS_PASS};});
