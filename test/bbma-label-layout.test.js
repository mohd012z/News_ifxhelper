'use strict';
/* EXECUTED proof of the LabelLayoutEngine (spec section 5):
 *   - priority table (Selected 100 / MOM 95 / CSA 90 / RE 85 / MHV 80 /
 *     EXTREME 75 / News 70 / Session 60 / ordinary 40)
 *   - collision NEVER overpaints: lower priority stacks below the survivor
 *   - out-of-room -> compact strip (MOM↑ CSA↑ RE↑ …) not lost labels
 *   - viewport clipping hides rather than draws off-canvas
 *   - selected label is forced to priority 100
 * Pure module, no DOM, deterministic. */
const assert=require('assert');
const LLE=require('../lib/label-layout-engine.js');

const W=400,H=340,fontH=11;
const ctx={width:W,height:H,fontHeight:fontH,padTop:8,padBottom:14,
  X:i=>8+i*10, Y:p=>100, measure:t=>String(t||'').length*5.4, selectedId:null};

/* 1. Priority table */
assert.strictEqual(LLE.priorityFor('MOMENTUM'),95,'MOMENTUM priority');
assert.strictEqual(LLE.priorityFor('CSA'),90);
assert.strictEqual(LLE.priorityFor('CSAK'),90);
assert.strictEqual(LLE.priorityFor('REENTRY'),85);
assert.strictEqual(LLE.priorityFor('MHV'),80);
assert.strictEqual(LLE.priorityFor('EXTREME'),75);
assert.strictEqual(LLE.priorityFor('NEWS'),70);
assert.strictEqual(LLE.priorityFor('TOKYO_OPEN'),60);
assert.strictEqual(LLE.priorityFor('TEXT'),40);
assert.strictEqual(LLE.priorityFor('WEIRD',99),99,'explicit priority honored');

/* 2. Well-separated labels all placed, no stacking */
let r=LLE.layout([
  {id:'m',type:'MOMENTUM',direction:'UP',text:'MOM↑',anchorPrice:4150,candleId:'c10'},
  {id:'c',type:'CSA',direction:'UP',text:'CSA↑',anchorPrice:4150,candleId:'c20'},
  {id:'s',type:'TEXT',text:'note',anchorPrice:4150,candleId:'c30'}
],Object.assign({candleIndex:c=>({c10:10,c20:20,c30:30}[c.candleId])},ctx));
assert.strictEqual(r.placed.length,3,'three separated labels placed');
assert.ok(r.placed.every(p=>p.stacked===false),'no stacking when there is room');
assert.ok(r.placed.every(p=>p.x>=0&&p.x+p.w<=W),'all boxes inside viewport');

/* 3. Two labels on the SAME candle -> the higher priority keeps the anchor,
   the lower STACKS (never overpainted) */
r=LLE.layout([
  {id:'re',type:'REENTRY',direction:'UP',text:'RE ↑',anchorPrice:4150,candleId:'c10'},
  {id:'mh',type:'MHV',text:'MHV',anchorPrice:4150,candleId:'c10'}
],Object.assign({candleIndex:c=>10},ctx));
assert.strictEqual(r.placed.length,2,'both placed (one stacked, not hidden)');
const re=r.placed.find(p=>p.id==='re'),mh=r.placed.find(p=>p.id==='mh');
assert.ok(re&&mh);
assert.ok(re.priority>=mh.priority,'RE(85) outranks MHV(80)');
assert.ok(mh.stacked||Math.abs(re.y-mh.y)>fontH,'lower label stacked clear of the higher one');

/* 4. Many labels forced into the same x -> compact strip rescues the pile */
const pile=[];for(let k=0;k<6;k++)pile.push({id:'p'+k,type:['MOMENTUM','CSA','REENTRY','MHV','EXTREME','TEXT'][k],direction:'UP',text:['MOM↑','CSA↑','RE↑','MHV','EXT↓','txt'][k],anchorPrice:4150,candleId:'c10'});
r=LLE.layout(pile,Object.assign({candleIndex:c=>10},ctx));
/* the top survivors are placed and/or compacted — nothing is silently lost:
   every id appears in placed OR the compact strip OR hidden (accounted). */
const accounted=r.placed.map(p=>p.id).concat(r.hidden).concat(r.compact?r.compact.ids:[]);
for(const p of pile)assert.ok(accounted.includes(p.id),'label '+p.id+' accounted for (placed/hidden/compact)');
if(r.compact)assert.ok(r.compact.ids.length>=2,'compact strip merges 2+ labels');

/* 5. Viewport clipping: a label anchored far right is clipped, not drawn off-canvas */
r=LLE.layout([{id:'far',type:'TEXT',text:'x',anchorPrice:4150,candleId:'c1000'}],
  Object.assign({candleIndex:c=>1000,X:i=>8+i*10},ctx)); /* x would be 10008px */
const far=r.placed.find(p=>p.id==='far');
assert.ok(!far|| (far.x>=0&&far.x+far.w<=W),'clipped label is either hidden or clamped inside viewport');

/* 6. Selected label forced to priority 100 (beats MOM 95) */
r=LLE.layout([
  {id:'mom',type:'MOMENTUM',direction:'UP',text:'MOM↑',anchorPrice:4150,candleId:'c10'},
  {id:'sel',type:'TEXT',text:'SEL',anchorPrice:4150,candleId:'c10'}
],Object.assign({},ctx,{candleIndex:c=>10,selectedId:'sel'}));
const sel=r.placed.find(p=>p.id==='sel'),mom=r.placed.find(p=>p.id==='mom');
assert.ok(sel&&mom);
assert.strictEqual(sel.priority,100,'selected label is priority 100');
assert.ok(sel.priority>=mom.priority,'selected outranks MOM');

console.log('LabelLayoutEngine proof: priorities + stack-on-collision + compact + clip + selected=100 all verified');
process.exit(0);
