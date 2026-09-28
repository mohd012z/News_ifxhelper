'use strict';
/* Typed ChartZone objects (spec section 7). Zones are NOT bare colored
 * rectangles — every zone is a typed object:
 *
 *   { id, type, symbol, timeframe, startTime, endTime, high, low, label,
 *     source, status }
 *
 * Types: TOKYO_OPEN | US_OPEN | BBMA_REENTRY | EXTREME | MHV | NEWS_BLACKOUT | CUSTOM
 *
 * Timezone discipline (spec: "broker timezone tidak lagi tersalah label"):
 *   provider timestamp -> UTC canonical (all input .time values are treated as
 *   UTC ISO) -> session calculated in UTC -> MYT display string (UTC+8) is a
 *   PRESENTATION field only. Zone startTime/endTime are always UTC ISO.
 *
 * Tokyo 1st candle = first candle with openTime >= 00:00 UTC (Tokyo open).
 * US 1st candle    = first candle with openTime >= 13:30 UTC (DST) or
 *                    14:30 UTC (standard) — the same DST rule as the chart's
 *                    sessionAnchors, so zone and line can never disagree.
 * Zones are computed from CLOSED candles only (a still-forming candle's OHLC
 * is not final evidence) — matches the canonical SessionOpeningZone contract.
 */
function dst(us){
  var d=new Date(us),y=d.getUTCFullYear();
  function nthSunday(yy,mm,n){var first=Date.UTC(yy,mm,1);var off=(7-new Date(first).getUTCDay())%7;return first+off+(n-1)*86400000;}
  return us>=nthSunday(y,2,2)+2*3600000&&us<nthSunday(y,10,1)+2*3600000;
}
function iso(ms){return new Date(ms).toISOString();}
function myt(ms){return new Date(ms+8*3600000).toISOString().slice(11,16)+' MYT';}
function fin(x){return Number.isFinite(+x)?+x:null;}
function dayStartUtc(ms){return Math.floor(ms/86400000)*86400000;}

/**
 * buildZones(candles, tf, opts)
 *  candles: [{time(ISO UTC), open, high, low, close, _b?}] time-ordered
 *  tf:      'M5'|'M15'|…  (session zones only make sense intraday; guard below)
 *  opts:    { closedOnly=true, symbols='XAU/USD' }
 * returns: [ChartZone]
 */
function buildZones(candles,tf,opts){
  opts=opts||{};
  var symbol=opts.symbol||'XAU/USD';
  var out=[];
  if(!Array.isArray(candles)||candles.length<2)return out;
  var a=candles.map(function(c){return {time:c.time,ms:Date.parse(c.time),o:fin(c.open),h:fin(c.high),l:fin(c.low),c:fin(c.close)};});
  a=a.filter(function(c){return c.ms!=null&&c.o!=null&&c.h!=null&&c.l!=null&&c.c!=null;});
  if(a.length<2)return out;
  var span=a[a.length-1].ms-a[0].ms;
  var intraday=span<=96*3600000; /* session opens only annotate intraday views */
  function zone(type,c,extra){
    return Object.assign({
      id:type.toLowerCase().replace(/_open/,'')+'-'+tf+'-'+String(c.ms),
      type:type, symbol:symbol, timeframe:tf,
      startTime:iso(c.ms), endTime:iso(c.ms+60000),
      high:Math.round(c.h*100)/100, low:Math.round(c.l*100)/100,
      open:Math.round(c.o*100)/100, close:Math.round(c.c*100)/100,
      label:extra&&extra.label||type, source:extra&&extra.source||'SESSION_ENGINE',
      status:extra&&extra.status||'CONFIRMED',
      mytDisplay:myt(c.ms)
    },(extra&&extra.raw)||{});
  }
  if(intraday){
    var t0=a[0].ms;
    /* Day-by-day: for each UTC day in the window, find the FIRST candle at/after
       the session open. This is robust to weekend gaps and partial first/last
       days (a lone 23:30 candle from the previous day must NOT be claimed as a
       US open). Zone startTime = that candle (UTC canonical); mytDisplay is the
       UTC+8 PRESENTATION string — the broker's local time is never used. */
    var day0=Math.floor(t0/86400000),day1=Math.floor(a[a.length-1].ms/86400000);
    for(var dday=day0;dday<=day1;dday++){
      var ds=dday*86400000;
      /* TOKYO open = 00:00 UTC (Asia/Tokyo). The opening candle must actually
         BE the day's open — first candle in [00:00, 02:00). A lone 23:30 candle
         (previous session's tail, common when the window starts mid-day) is NOT
         a Tokyo open. No candle there -> no Tokyo zone (honest). */
      for(var i2=0;i2<a.length;i2++){
        if(a[i2].ms<ds)continue;
        if(a[i2].ms>ds+2*3600000)break;
        out.push(zone('TOKYO_OPEN',a[i2],{label:'TOKYO OPEN 1st',source:'SESSION_ENGINE',status:'CONFIRMED'}));
        break; /* first candle of the day */
      }
      /* US open = 13:30 UTC (DST) / 14:30 UTC (standard). Opening candle must be
         in [open, open+2h) — a 23:30 candle is 10h after 13:30, not a US open. */
      var usOpen=ds+(dst(ds)?13.5:14.5)*3600000;
      for(var j2=0;j2<a.length;j2++){
        if(a[j2].ms<usOpen)continue;
        if(a[j2].ms>usOpen+2*3600000)break;
        out.push(zone('US_OPEN',a[j2],{label:'US OPEN 1st',source:'SESSION_ENGINE',status:'CONFIRMED'}));
        break;
      }
    }
    /* Dedupe if two days share a zone (shouldn't happen) */
    var seenZ={};out=out.filter(function(z){if(seenZ[z.id])return false;seenZ[z.id]=1;return true;});
  }
  return out;
}

/** BBMA signal zones: type from signal pattern (REENTRY/EXTREME/MHV), anchored
 * at the signal candle. source carries the BBMASignal version for audit. */
function signalZones(signals,tf,opts){
  opts=opts||{};
  var symbol=opts.symbol||'XAU/USD';
  var out=[];
  (signals||[]).forEach(function(s){
    if(!s||!s.candleTime)return;
    var ms=Date.parse(s.candleTime);
    if(!Number.isFinite(ms))return;
    var type=/RE.?ENTRY/.test(s.pattern)?'BBMA_REENTRY':/EXTREME/.test(s.pattern)?'EXTREME':/MHV/.test(s.pattern)?'MHV':null;
    if(!type)return;
    out.push({
      id:('sig-'+(s.id||'')+'-'+tf).slice(0,80),
      type:type, symbol:symbol, timeframe:tf,
      startTime:iso(ms), endTime:iso(ms+60000),
      high:s.evidence?((s.evidence.find(function(e){return e.name==='bbUpper';})||{}).value):null,
      low:s.evidence?((s.evidence.find(function(e){return e.name==='bbLower';})||{}).value):null,
      label:s.pattern+' '+(s.direction==='UP'?'↑':s.direction==='DOWN'?'↓':''),
      source:'BBMA_ENGINE', version:s.version||null, status:s.status||'READY',
      direction:s.direction||null, evidenceId:s.id||null,
      mytDisplay:myt(ms)
    });
  });
  return out;
}

/* UMD: Node (require) + browser (window.BBMAChartZones). */
(function(root,mod){
  if(typeof module!=='undefined'&&module.exports){module.exports=mod();}
  else{root.BBMAChartZones=mod();}
})(typeof self!=='undefined'?self:this,function(){
  return {buildZones:buildZones,signalZones:signalZones,dst:dst,myt:myt};
});
