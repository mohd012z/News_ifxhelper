'use strict';
/* EndMovementBrain — §16: "is the impulse still running?"
 *
 * State: CONTINUING | SLOWING | EXHAUSTION_CANDIDATE | END_CONFIRMED |
 * REVERSAL_CANDIDATE. Evidence is measured from the closed-candle window
 * (momentum decay, wick rejection, ATR impulse, opposite structure) — not
 * assumed.
 */
function n(v){return Number.isFinite(+v)?+v:null;}
function bodyPct(c){var r=n(c.high)-n(c.low);return r>0?Math.abs(n(c.close)-n(c.open))/r:null;}
function wickPct(c,side){var o=n(c.open),cl=n(c.close),h=n(c.high),l=n(c.low);var range=Math.max(h-l,1e-9);return side==='upper'?(h-Math.max(o,cl))/range:(Math.min(o,cl)-l)/range;}
/**
 * assess({ candles (closed, time-asc, last = just-closed), direction,
 *          location (W.location), mtf })
 * direction: 'UP'|'DOWN'|'RANGE'
 */
function assess(inp){
  inp=inp||{};
  var c=inp.candles||[];
  var dir=inp.direction||'RANGE';
  var last=c.length?c[c.length-1]:null;
  if(!last)return {state:'UNKNOWN',evidence:[]};
  var ev=[];
  var bodies=c.slice(-5).map(bodyPct).filter(function(x){return x!=null;});
  var shrinking=bodies.length>=3&&bodies[bodies.length-1]<bodies[bodies.length-2]&&bodies[bodies.length-2]<bodies[bodies.length-3];
  var fav=(dir==='UP')?last.close>=last.open:(dir==='DOWN')?last.close<=last.open:false;
  var oppClosed=(dir==='UP')?last.close<last.open:(dir==='DOWN')?last.close>last.open:false;
  var upperWick=wickPct(last,'upper'),lowerWick=wickPct(last,'lower');
  var rejection=(dir==='UP'&&upperWick>0.4)||(dir==='DOWN'&&lowerWick>0.4);
  var loc=inp.location||{};
  var mtf=inp.mtf||{};
  var mtfAgainst=(dir==='UP'&&(mtf.H1&&mtf.H1.trend==='DOWN'))||(dir==='DOWN'&&(mtf.H1&&mtf.H1.trend==='UP'));
  if(shrinking)ev.push('momentum decay (3 shrinking bodies)');
  if(rejection)ev.push((dir==='UP'?'upper':'lower')+' wick rejection');
  if(oppClosed)ev.push('opposite closed candle');
  if(mtfAgainst)ev.push('MTF structure against');
  var score=ev.length;
  var state;
  if(oppClosed&&score>=2)state='REVERSAL_CANDIDATE';
  else if(score>=3)state='END_CONFIRMED';
  else if(score===2)state='EXHAUSTION_CANDIDATE';
  else if(score===1)state='SLOWING';
  else state=(fav?'CONTINUING':'SLOWING');
  return {state:state,evidence:ev,score:score,bbState:loc.zone||null};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAEndMovement=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {assess:assess};});
