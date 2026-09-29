'use strict';
/* DEMO / INITIALIZING data — STRICTLY segregated from the production evidence
 * path (spec: "Keep synthetic/bootstrap data strictly in DEMO/INITIALIZING
 * mode, never inside the production evidence path").
 *
 * These are the explicit SyntheticDataProvider / DemoBBMASignals /
 * DemoNewsProvider. The production runtime NEVER imports this file; it is only
 * loaded by an explicit demo/preview entry (e.g. a --preview box, a demo page)
 * and is tagged demo:true on every object so any consumer (dashboard,
 * publisher, evidence gate) can refuse it. The publisher's existing
 * "never broadcast a demo/placeholder box" guard keys off rt.demo === true.
 *
 * The basePrice/sine values live HERE and NOWHERE ELSE in the production path.
 */
function syntheticCandles(n,basePrice,seedMs,stepMs){
  n=n||120;basePrice=basePrice||2658.50;stepMs=stepMs||60000;
  /* Deterministic seed (no Date.now): a fixed recent-looking epoch so the demo
     series is stable across calls — demo data must never depend on the wall
     clock of the demo host. */
  seedMs=(seedMs!=null?seedMs:Date.UTC(2026,8,28,4,0,0))-n*stepMs;
  var out=[];
  for(var i=0;i<n;i++){
    var t=seedMs+i*stepMs;
    var dev=(Math.sin(i*0.35)+Math.cos(i*0.18))*3.5;
    var c=basePrice+dev,o=basePrice+dev*0.6;
    out.push({time:new Date(t).toISOString(),open:o,high:Math.max(o,c)+0.4,low:Math.min(o,c)-0.4,close:c,source:'SYNTHETIC',demo:true});
  }
  return out;
}
function demoBBMASignals(){
  return [
    {id:'demo-bbma-1',symbol:'XAU/USD',timeframe:'H4',pattern:'MHV',level:'HIGH',type:'SETUP',demo:true,source:'DEMO'},
    {id:'demo-bbma-2',symbol:'XAU/USD',timeframe:'M15',pattern:'RE-ENTRY',level:'HIGH',type:'CONFIRMED',demo:true,source:'DEMO'},
    {id:'demo-bbma-3',symbol:'XAU/USD',timeframe:'M5',pattern:'EXTREME',level:'MEDIUM',type:'WATCH',demo:true,source:'DEMO'}
  ];
}
function demoNews(){
  return {name:'Demo Event (layout only)',event:'Demo Event (layout only)',state:'NO_EVENT',demo:true,source:'DEMO'};
}
function demoSnapshot(n){
  var candles=syntheticCandles(n);
  return {demo:true,mode:'DEMO',source:'SYNTHETIC',candles:candles,alerts:demoBBMASignals(),event:demoNews(),note:'DEMO/INITIALIZING only — never part of the production evidence path.'};
}
/* UMD */
(function(root,mod){
  if(typeof module!=='undefined'&&module.exports){module.exports=mod();}
  else{root.BBMADemo=mod();}
})(typeof self!=='undefined'?self:this,function(){
  return {syntheticCandles:syntheticCandles,demoBBMASignals:demoBBMASignals,demoNews:demoNews,demoSnapshot:demoSnapshot};
});
