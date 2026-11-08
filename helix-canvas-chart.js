/* HELIX Canvas Chart: dependency-free, research-only chart renderer. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.HELIXCanvasChart=api;})(typeof window!=='undefined'?window:null,function(){'use strict';
function geometry(rows,zones,width,height,view){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('INVALID_VIEWPORT');
 const n=rows.length,from=Math.max(0,Math.min(n,Math.floor(view&&view.from||0))),to=Math.max(from,Math.min(n,Math.ceil(view&&view.to||n)));
 const visible=rows.slice(from,to),pad=18;
 const values=visible.flatMap(r=>[Number(r.high),Number(r.low)]);
 if(!values.length)return {candles:[],zones:[],range:null,from,to};
 if(values.some(v=>!Number.isFinite(v)))throw Error('INVALID_OHLC');
 const hi=Math.max(...values),lo=Math.min(...values),span=hi-lo||Math.max(Math.abs(hi)*0.001,1);
 const x=i=>pad+(i-from+0.5)*(width-2*pad)/Math.max(1,to-from);
 const y=p=>pad+(hi-p)*(height-2*pad)/span;
 const candles=visible.map((r,i)=>({x:x(from+i),open:y(r.open),close:y(r.close),high:y(r.high),low:y(r.low),up:r.close>=r.open}));
 const overlays=(zones||[]).filter(z=>z&&Number.isFinite(z.low)&&Number.isFinite(z.high)&&z.high>z.low&&Number.isFinite(z.start)&&Number.isFinite(z.end)).map(z=>{
  const a=rows.findIndex(r=>r.time>=z.start),b=rows.findIndex(r=>r.time>z.end);
  const left=Math.max(from,a<0?n:a),right=Math.min(to,b<0?n:b);
  if(left>=right)return null;
  return {pattern:String(z.pattern||'ZONE').slice(0,12),x:x(left)-((width-2*pad)/Math.max(1,to-from))/2,y:y(z.high),w:(right-left)*(width-2*pad)/Math.max(1,to-from),h:Math.max(1,y(z.low)-y(z.high))};
 }).filter(Boolean);
 return {candles,zones:overlays,range:{high:hi,low:lo},from,to};
}
function mount(el){
 if(!el||!el.ownerDocument)throw Error('INVALID_CONTAINER');
 const canvas=el.ownerDocument.createElement('canvas');canvas.style.cssText='width:100%;height:100%;display:block;touch-action:pan-y';el.appendChild(canvas);
 let rows=[],zones=[],view={from:0,to:0},destroyed=false,observer=null;
 function paint(){
  if(destroyed)return;
  const w=Math.max(1,el.clientWidth),h=Math.max(1,el.clientHeight),dpr=Math.max(1,Math.min(3,(typeof window!=='undefined'&&window.devicePixelRatio)||1));
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  const ctx=canvas.getContext('2d');if(!ctx)return;ctx.scale(dpr,dpr);
  ctx.fillStyle='#071522';ctx.fillRect(0,0,w,h);
  const g=geometry(rows,zones,w,h,view),step=(w-36)/Math.max(1,g.to-g.from);
  for(const z of g.zones){ctx.fillStyle=/^(DBR|RBR)$/.test(z.pattern)?'rgba(84,199,255,.16)':'rgba(255,200,87,.16)';ctx.fillRect(z.x,z.y,z.w,z.h);ctx.strokeStyle='#ffc857';ctx.strokeRect(z.x,z.y,z.w,z.h);}
  for(const c of g.candles){ctx.strokeStyle=ctx.fillStyle=c.up?'#31df8b':'#ff596d';ctx.beginPath();ctx.moveTo(c.x,c.high);ctx.lineTo(c.x,c.low);ctx.stroke();ctx.fillRect(c.x-Math.max(1,step*.3),Math.min(c.open,c.close),Math.max(2,step*.6),Math.max(1,Math.abs(c.close-c.open)));}
 }
 function setData(data,config){if(destroyed)throw Error('CHART_DESTROYED');rows=(data||[]).slice();for(let i=0;i<rows.length;i++){const r=rows[i];if(!Number.isFinite(r.time)||![r.open,r.high,r.low,r.close].every(Number.isFinite)||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close)||r.low>r.high||(i&&r.time<=rows[i-1].time))throw Error('INVALID_SORTED_OHLC');}zones=(config&&config.zones||[]).slice();view={from:Math.max(0,rows.length-80),to:rows.length};paint();return {count:rows.length,zones:zones.length};}
 function zoom(factor){const count=Math.max(5,Math.min(rows.length||5,Math.round((view.to-view.from)*factor)));view.from=Math.max(0,view.to-count);paint();}
 function pan(bars){const width=view.to-view.from,from=Math.max(0,Math.min(Math.max(0,rows.length-width),view.from+Math.trunc(bars)));view={from,to:from+width};paint();}
 function wheel(e){e.preventDefault();zoom(e.deltaY<0?0.8:1.25);}
 canvas.addEventListener('wheel',wheel,{passive:false});
 if(typeof ResizeObserver==='function'){observer=new ResizeObserver(paint);observer.observe(el);}
 paint();
 return {setData,paint,zoom,pan,getVisibleRange:()=>({...view}),destroy(){if(destroyed)return;destroyed=true;if(observer)observer.disconnect();canvas.removeEventListener('wheel',wheel);canvas.remove();}};
}
return {geometry,mount};
});
