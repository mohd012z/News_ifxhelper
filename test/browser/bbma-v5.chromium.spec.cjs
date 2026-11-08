const {test,expect}=require('@playwright/test');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const {mkdirSync}=require('node:fs');
let server,origin;
test.beforeAll(async()=>{
 server=http.createServer((req,res)=>{
  const files={'/lightweight.js':path.join(root,'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'),
   '/adapter.js':path.join(root,'bbma-lightweight-v5.js'),'/dashboard.js':path.join(root,'bbma-dashboard-ui.js')};
  if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#071522}#chart{width:100%;height:380px;position:relative}</style><div id="chart"></div><script src="/lightweight.js"></script><script src="/adapter.js"></script>');return;}
  if(!files[req.url]){res.writeHead(404);res.end();return;}
  try{res.writeHead(200,{'Content-Type':'application/javascript'});fs.createReadStream(files[req.url]).pipe(res);}catch{res.writeHead(500);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 origin='http://127.0.0.1:'+server.address().port;
});
test.afterAll(async()=>{if(server)await new Promise(resolve=>server.close(resolve));});
test('real Chromium renders closed-bar BBMA, S&D zones, pan/zoom and mobile resize',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:780});
 await page.goto(origin);
 const result=await page.evaluate(()=>{
  const base=Date.parse('2026-11-08T00:00:00Z'),rows=Array.from({length:90},(_,i)=>({time:new Date(base+i*60000).toISOString(),open:100+i*.1,high:101+i*.1,low:99+i*.1,close:100.5+i*.1}));
  const chart=window.BBMALightweightV5.mount(document.querySelector('#chart'));
  if(!chart)throw Error('MOUNT_FAILED');
  const data=chart.setData(rows,{asOf:new Date(base+90*60000).toISOString(),minutes:1,zones:[{pattern:'DBR',confirmedAt:rows[15].time,low:100,high:104},{pattern:'RBD',confirmedAt:rows[35].time,low:106,high:110}],markers:[{time:rows[60].time,text:'EXT'}]});
  window.smokeChart=chart;
  return data;
 });
 expect(result).toEqual({count:90,zones:2});
 expect(await page.locator('#chart canvas').count()).toBeGreaterThanOrEqual(2);
 const before=await page.locator('#chart canvas').last().evaluate(el=>({w:el.width,h:el.height}));
 const initial=await page.evaluate(()=>({range:window.smokeChart.getVisibleRange(),rects:window.smokeChart.getZoneRects()}));
 expect(initial.range).not.toBeNull();
 expect(initial.rects).toHaveLength(2);
 for(const rect of initial.rects){expect(rect.x2).toBeGreaterThan(rect.x1);expect(rect.y2).toBeGreaterThan(rect.y1);for(const v of [rect.x1,rect.x2,rect.y1,rect.y2])expect(Number.isFinite(v)).toBe(true);}
 expect(before.w).toBeGreaterThan(0);
 await page.mouse.move(200,180);await page.mouse.down();await page.mouse.move(110,180,{steps:8});await page.mouse.up();
 const dragged=await page.evaluate(()=>window.smokeChart.getVisibleRange());
 expect(dragged).not.toEqual(initial.range);
 await page.mouse.wheel(0,-350);
 await page.waitForTimeout(100);
 const zoomed=await page.evaluate(()=>window.smokeChart.getVisibleRange());
 expect(zoomed.to-zoomed.from).not.toBeCloseTo(dragged.to-dragged.from,3);
 await page.setViewportSize({width:800,height:600});
 await page.waitForTimeout(250);
 const after=await page.locator('#chart canvas').last().evaluate(el=>({w:el.width,h:el.height}));
 expect(after.w).toBeGreaterThan(before.w);
 const resized=await page.evaluate(()=>window.smokeChart.getZoneRects());
 expect(resized).toHaveLength(2);
 for(const rect of resized){expect(rect.x2).toBeGreaterThan(rect.x1);expect(rect.y2).toBeGreaterThan(rect.y1);}
 await page.evaluate(()=>window.smokeChart.paint());
 expect(errors).toEqual([]);
 mkdirSync('test-results/helix-chromium',{recursive:true});
 await page.screenshot({path:'test-results/helix-chromium/chart.png',fullPage:true});
 await page.evaluate(()=>window.smokeChart.destroy());
});
test('fallback when chart library is unavailable',async({page})=>{
 await page.goto(origin);
 const fallback=await page.evaluate(()=>window.BBMALightweightV5.mount(document.querySelector('#chart'),{library:{}}));
 expect(fallback).toBeNull();
});

test('mobile touch gesture does not crash overlay lifecycle',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:780},hasTouch:true,isMobile:true});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);
 await page.evaluate(()=>{const base=Date.parse('2026-11-08T00:00:00Z');const rows=Array.from({length:80},(_,i)=>({time:new Date(base+i*60000).toISOString(),open:100+i*.1,high:101+i*.1,low:99+i*.1,close:100.5+i*.1}));window.touchChart=window.BBMALightweightV5.mount(document.querySelector('#chart'));window.touchChart.setData(rows,{asOf:new Date(base+80*60000).toISOString(),minutes:1,zones:[{pattern:'DBR',confirmedAt:rows[10].time,low:100,high:103}]});});
 const client=await context.newCDPSession(page);
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:280,y:160}]});
 for(let x=260;x>=140;x-=20)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:160}]});
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.evaluate(()=>window.touchChart.paint());
 expect(await page.evaluate(()=>window.touchChart.getZoneRects().length)).toBe(1);
 expect(errors).toEqual([]);
 await context.close();
});

test('full dashboard retains SVG when TradingView is missing',async({page})=>{
 await page.goto(origin);
 await page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<main class="main"><div></div></main><nav id="bottomnav"><button>Home</button></nav>');window.BBMA_RUNTIME={ohlc:{M15:Array.from({length:60},(_,i)=>({time:i,open:100+i,high:102+i,low:99+i,close:101+i}))},mtf:{M15:{}}};window.__bbmaV5Enabled=true;delete window.LightweightCharts;});
 await page.addScriptTag({url:origin+'/dashboard.js'});
 await page.waitForFunction(()=>!!document.getElementById('bbma-chart'));
 await page.evaluate(()=>window.BBMADashboardUI.render());
 await expect(page.locator('#bbma-chart svg')).toHaveCount(1);
 expect(await page.locator('#bbma-chart').getAttribute('data-v5-error')).toBeNull();
});
