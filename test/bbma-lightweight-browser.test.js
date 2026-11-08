'use strict';
const assert=require('node:assert/strict');
const C=require('../bbma-lightweight-v5.js');
const base=Date.parse('2026-11-08T00:00:00Z');
const rows=Array.from({length:70},(_,i)=>({time:new Date(base+i*60000).toISOString(),open:100+i,high:102+i,low:99+i,close:101+i}));
const asOf=new Date(base+70*60000).toISOString();
let created=0,removed=0,resizes=0,markers=[],rangeHandler,observed,disconnected=0;
const series=[];
const library={CandlestickSeries:{},LineSeries:{},createChart:function(el,opts){
 assert.equal(opts.autoSize,true);created++;
 return {addSeries:function(){const s={points:[],setData(v){this.points=v;},priceToCoordinate(v){return 400-v;}};series.push(s);return s;},
 timeScale(){return {timeToCoordinate(t){return (t-base/1000)/60*8;},subscribeVisibleLogicalRangeChange(fn){rangeHandler=fn;},unsubscribeVisibleLogicalRangeChange(fn){assert.equal(fn,rangeHandler);},fitContent(){},};},
 remove(){removed++;}};},createSeriesMarkers(_s,v){markers=v;return {setMarkers(v){markers=v;}};}};
const canvas={width:0,height:0,setAttribute(){},style:{},remove(){},getContext(){return {scale(){},fillRect(){},strokeRect(){},fillText(){}};}};
global.document={createElement(){return canvas;}};
global.window={devicePixelRatio:2};
global.ResizeObserver=class{constructor(fn){this.fn=fn;}observe(el){observed=el;}disconnect(){disconnected++;}};
const el={clientWidth:500,clientHeight:300,appendChild(node){assert.equal(node,canvas);}};
const chart=C.mount(el,{library});assert(chart);assert.equal(created,1);assert.equal(observed,el);
const z=[{pattern:'DBR',confirmedAt:rows[10].time,low:105,high:110},{pattern:'RBD',confirmedAt:rows[40].time,invalidatedAt:rows[55].time,low:135,high:140}];
assert.deepEqual(chart.setData(rows,{asOf,minutes:1,zones:z,markers:[{time:rows[20].time,text:'EXT'}]}),{count:70,zones:2});
assert.equal(series.length,9);assert.equal(series[0].points.length,70);assert.equal(series[1].points.length,21);
assert.equal(markers.length,1);assert.equal(canvas.width,1000);
rangeHandler();assert.equal(canvas.height,600);
const expectedEMA=rows.slice(0,50).reduce((a,x)=>a+x.close,0)/50;
assert(Math.abs(series[1].points[0].value-expectedEMA)<1e-9,'EMA50 independent arithmetic seed');
const expectedMid=rows.slice(0,20).reduce((a,x)=>a+x.close,0)/20;
assert(Math.abs(series[2].points[0].value-expectedMid)<1e-9,'BB20 independent SMA');
const expectedLWMA5=rows.slice(0,5).reduce((a,x,i)=>a+x.high*(i+1),0)/15;
assert(Math.abs(series[5].points[0].value-expectedLWMA5)<1e-9,'LWMA5 High independent weighted sum');
assert.equal(C.zones(z,C.closed(rows,asOf,1),new Date(base+20*60000).toISOString()).length,1,'future zone invisible');
assert.equal(C.zones([{...z[0],invalidatedAt:rows[12].time}],C.closed(rows,asOf,1),asOf)[0].end,base/1000+12*60,'invalidated zone ends');
chart.destroy();assert.equal(removed,1);assert.equal(disconnected,1);
console.log('BBMA browser API simulation, WebView resize/scroll, indicator parity and S&D lifecycle passed');
