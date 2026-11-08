const {test,expect}=require('@playwright/test');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
let server,origin;
test.beforeAll(async()=>{
 server=http.createServer((req,res)=>{
  const files={'/lightweight.js':path.join(root,'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'),
   '/adapter.js':path.join(root,'bbma-lightweight-v5.js')};
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
 await expect(page.locator('#chart canvas').first()).toBeVisible({timeout:10000}).catch(()=>{});
 const result=await page.evaluate(()=>{
  const base=Date.parse('2026-11-08T00:00:00Z'),rows=Array.from({length:90},(_,i)=>({time:new Date(base+i*60000).toISOString(),open:100+i*.1,high:101+i*.1,low:99+i*.1,close:100.5+i*.1}));
  const chart=window.BBMALightweightV5.mount(document.querySelector('#chart'));
  if(!chart)throw Error('MOUNT_FAILED');
  const data=chart.setData(rows,{asOf:new Date(base+90*60000).toISOString(),minutes:1,zones:[{pattern:'DBR',confirmedAt:rows[15].time,low:100,high:104},{pattern:'RBD',confirmedAt:rows[35].time,low:106,high:110}],markers:[{time:rows[60].time,text:'EXT'}]});
  window.smokeChart=chart;
  return data;
 });
 expect(result).toEqual({count:90,zones:2});
 await expect(page.locator('#chart canvas')).toHaveCount(2);
 const before=await page.locator('#chart canvas').last().evaluate(el=>({w:el.width,h:el.height}));
 expect(before.w).toBeGreaterThan(0);
 await page.mouse.move(200,180);await page.mouse.down();await page.mouse.move(110,180,{steps:8});await page.mouse.up();
 await page.mouse.wheel(0,-350);
 await page.setViewportSize({width:800,height:600});
 await page.waitForTimeout(250);
 const after=await page.locator('#chart canvas').last().evaluate(el=>({w:el.width,h:el.height}));
 expect(after.w).toBeGreaterThan(before.w);
 await page.evaluate(()=>window.smokeChart.paint());
 expect(errors).toEqual([]);
 await page.screenshot({path:'test-results/helix-chromium/chart.png',fullPage:true});
 await page.evaluate(()=>window.smokeChart.destroy());
});
test('fallback when chart library is unavailable',async({page})=>{
 await page.goto(origin);
 const fallback=await page.evaluate(()=>window.BBMALightweightV5.mount(document.querySelector('#chart'),{library:{}}));
 expect(fallback).toBeNull();
});
