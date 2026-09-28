'use strict';
/* CrossAssetBrain — relative-strength context from other series.
 *
 * Optional. Takes compact current states for related series (DXY, US10Y,
 * crypto proxy) and produces a cross-asset read that can SUPPORT or CONTRADICT
 * the gold direction. Does not predict on its own.
 */
function read(cross){
  cross=cross||{};
  var notes=[];var bias=0;
  /* gold is inversely correlated with DXY and real yields (illustrative) */
  if(cross.DXY&&cross.DXY.direction==='UP'){bias-=1;notes.push('DXY up (USD strength, headwind for gold)');}
  if(cross.DXY&&cross.DXY.direction==='DOWN'){bias+=1;notes.push('DXY down (USD weakness, support for gold)');}
  if(cross.US10Y&&cross.US10Y.direction==='UP'){bias-=1;notes.push('US10Y up (real yield pressure)');}
  if(cross.US10Y&&cross.US10Y.direction==='DOWN'){bias+=1;notes.push('US10Y down (support for gold)');}
  if(cross.crypto&&cross.crypto.direction==='UP'){notes.push('risk appetite rising (mixed for gold)');}
  var dir=bias>0?'UP':bias<0?'DOWN':null;
  return {direction:dir,bias:bias,notes:notes,available:Object.keys(cross).length>0};
}
function UMD(root,mod){if(typeof module!=='undefined'&&module.exports){module.exports=mod();}else{root.BBMAcrossAsset=mod();}}
UMD(typeof self!=='undefined'?self:this,function(){return {read:read};});
