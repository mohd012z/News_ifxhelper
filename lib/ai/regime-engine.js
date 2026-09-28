'use strict';
/* RegimeEngine (§18). Classify the market CONDITION before prediction so the
 * model router can use the right logic per regime — not one formula for all.
 * Regimes: TREND / RANGE / SQUEEZE / EXPANSION / NEWS_SHOCK / POST_NEWS /
 * TRANSITION.
 */
var NEWS_PASS=['CLEAR','NO_EVENT','NO_NEWS','NORMAL'];
function classify(snap){
  snap=snap||{};
  var newsMode=String((snap.news&&snap.news.mode)||'NO_EVENT').toUpperCase();
  var squeeze=(snap.volatility&&snap.volatility.squeeze)||null;
  var expanding=!!(snap.volatility&&snap.volatility.expanding);
  var bbma=snap.bbma||{};
  var mtf=snap.mtf||{};
  var up=Object.keys(mtf).filter(function(t){return mtf[t]&&mtf[t].trend==='UP';}).length;
  var dn=Object.keys(mtf).filter(function(t){return mtf[t]&&mtf[t].trend==='DOWN';}).length;
  var aligned=up>=2&&dn===0;var alignedDn=dn>=2&&up===0;var mixed=up>0&&dn>0;
  var momentum=bbma.momentum||null;
  var reason=[];
  var regime;
  /* news regimes dominate (a shock / post-release is the defining condition) */
  if(/NEWS_RELEASE/.test(newsMode)||(snap.news&&snap.news.eventImportance==='HIGH'&&/PRE_NEWS|POST_NEWS/.test(newsMode))){
    regime=/POST_NEWS/.test(newsMode)?'POST_NEWS':'NEWS_SHOCK';reason.push('news '+newsMode);
  }else if(/SQUEEZE|TIGHT/.test(squeeze)){
    regime='SQUEEZE';reason.push('compression ('+squeeze+')');
  }else if(expanding){
    regime='EXPANSION';reason.push('volatility expanding');
  }else if(aligned){
    regime='TREND';reason.push('HTF aligned UP');
  }else if(alignedDn){
    regime='TREND';reason.push('HTF aligned DOWN');
  }else if(momentum==='MOMENTUM_UP'||momentum==='MOMENTUM_DOWN'){
    regime='TREND';reason.push('BB momentum');
  }else if(mixed){
    regime='TRANSITION';reason.push('conflicting HTF (mixed)');
  }else{
    regime='RANGE';reason.push('no HTF alignment, no squeeze, normal vol');
  }
  return {regime:regime,alignedUp:aligned,alignedDown:alignedDn,mixed:mixed,reason:reason.join('; '),
    newsPass:NEWS_PASS.indexOf(newsMode)>=0};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMARegime=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {classify:classify,NEWS_PASS:NEWS_PASS};});
