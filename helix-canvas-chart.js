/* HELIX Canvas Chart: dependency-free, research-only chart renderer. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.HELIXCanvasChart=api;})(typeof window!=='undefined'?window:null,function(){'use strict';
function closedReplay(rows,asOf,minutes){
 const cutoff=Date.parse(asOf);if(!Number.isFinite(cutoff)||!Number.isInteger(minutes)||minutes<1)throw Error('INVALID_REPLAY_CUTOFF');
 return rows.filter(r=>Number.isFinite(r.time)&&r.time*1000+minutes*60000<=cutoff);
}
function indicators(rows){
 const keys=['bbMiddle','bbUpper','bbLower','ema50','lwma5High','lwma10High','lwma5Low','lwma10Low'];
 const c=rows.map(r=>r.close),h=rows.map(r=>r.high),l=rows.map(r=>r.low);
 function sma(a,p,i){if(i<p-1)return null;let sum=0;for(let j=i-p+1;j<=i;j++)sum+=a[j];return sum/p;}
 function lwma(a,p,i){if(i<p-1)return null;let sum=0;for(let j=0;j<p;j++)sum+=a[i-p+1+j]*(j+1);return sum/(p*(p+1)/2);}
 let prev=null;return rows.map((r,i)=>{const mid=sma(c,20,i);if(i===49)prev=sma(c,50,i);else if(i>49)prev=r.close*(2/51)+prev*(49/51);
 const sd=mid===null?null:Math.sqrt(c.slice(i-19,i+1).reduce((a,v)=>a+(v-mid)**2,0)/20);
 const vals=[mid,sd===null?null:mid+2*sd,sd===null?null:mid-2*sd,prev,lwma(h,5,i),lwma(h,10,i),lwma(l,5,i),lwma(l,10,i)];
 return Object.fromEntries(keys.map((k,j)=>[k,vals[j]]));});
}
function geometry(rows,zones,width,height,view,studies){
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
 const lines={};if(studies)for(const key of Object.keys(studies[0]||{})){lines[key]=studies.slice(from,to).map((v,i)=>v[key]===null||!Number.isFinite(v[key])?null:{x:x(from+i),y:y(v[key])});}
 return {candles,zones:overlays,lines,range:{high:hi,low:lo},from,to};
}
function mount(el){
 if(!el||!el.ownerDocument)throw Error('INVALID_CONTAINER');
 const canvas=el.ownerDocument.createElement('canvas');canvas.style.cssText='width:100%;height:100%;display:block;touch-action:pan-y';el.appendChild(canvas);
 let rows=[],zones=[],studies=[],view={from:0,to:0},destroyed=false,observer=null,cross=null,gesture=null;
 function paint(){
  if(destroyed)return;
  const w=Math.max(1,el.clientWidth),h=Math.max(1,el.clientHeight),dpr=Math.max(1,Math.min(3,(typeof window!=='undefined'&&window.devicePixelRatio)||1));
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  const ctx=canvas.getContext('2d');if(!ctx)return;ctx.scale(dpr,dpr);
  ctx.fillStyle='#071522';ctx.fillRect(0,0,w,h);
  const g=geometry(rows,zones,w,h,view,studies),step=(w-36)/Math.max(1,g.to-g.from);
  for(const z of g.zones){ctx.fillStyle=/^(DBR|RBR)$/.test(z.pattern)?'rgba(84,199,255,.16)':'rgba(255,200,87,.16)';ctx.fillRect(z.x,z.y,z.w,z.h);ctx.strokeStyle='#ffc857';ctx.strokeRect(z.x,z.y,z.w,z.h);}
  const colors={bbMiddle:'#ffc857',bbUpper:'#37aef2',bbLower:'#37aef2',ema50:'#b37cff',lwma5High:'#ff9b54',lwma10High:'#f4c95d',lwma5Low:'#54d6ff',lwma10Low:'#4b9cff'};
  for(const [key,pts] of Object.entries(g.lines||{})){ctx.strokeStyle=colors[key]||'#fff';ctx.beginPath();let started=false;for(const p of pts){if(!p){started=false;continue;}if(!started){ctx.moveTo(p.x,p.y);started=true;}else ctx.lineTo(p.x,p.y);}ctx.stroke();}
  for(const c of g.candles){ctx.strokeStyle=ctx.fillStyle=c.up?'#31df8b':'#ff596d';ctx.beginPath();ctx.moveTo(c.x,c.high);ctx.lineTo(c.x,c.low);ctx.stroke();ctx.fillRect(c.x-Math.max(1,step*.3),Math.min(c.open,c.close),Math.max(2,step*.6),Math.max(1,Math.abs(c.close-c.open)));}
  if(cross){ctx.strokeStyle='#8da9bd';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(cross.x,0);ctx.lineTo(cross.x,h);ctx.moveTo(0,cross.y);ctx.lineTo(w,cross.y);ctx.stroke();ctx.setLineDash([]);}
 }
 function setData(data,config){if(destroyed)throw Error('CHART_DESTROYED');const input=(data||[]).slice();for(let i=0;i<input.length;i++){const r=input[i];if(!Number.isFinite(r.time)||![r.open,r.high,r.low,r.close].every(Number.isFinite)||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close)||r.low>r.high||(i&&r.time<=input[i-1].time))throw Error('INVALID_SORTED_OHLC');}rows=config&&config.asOf?closedReplay(input,config.asOf,config.minutes):input;studies=indicators(rows);
 zones=(config&&config.zones||[]).filter(z=>Number.isFinite(z.start)&&Number.isFinite(z.end)&&Number.isFinite(z.low)&&Number.isFinite(z.high)&&z.high>z.low&&(!config.asOf||z.start*1000<=Date.parse(config.asOf))).map(z=>({...z,end:config&&config.asOf?Math.min(z.end,Math.floor(Date.parse(config.asOf)/1000)):z.end}));view={from:Math.max(0,rows.length-80),to:rows.length};paint();return {count:rows.length,zones:zones.length};}
 function zoom(factor){const count=Math.max(5,Math.min(rows.length||5,Math.round((view.to-view.from)*factor)));view.from=Math.max(0,view.to-count);paint();}
 function pan(bars){const width=view.to-view.from,from=Math.max(0,Math.min(Math.max(0,rows.length-width),view.from+Math.trunc(bars)));view={from,to:from+width};paint();}
 function pointerDown(e){canvas.setPointerCapture?.(e.pointerId);gesture={x:e.clientX,from:view.from,to:view.to};cross={x:e.offsetX,y:e.offsetY};paint();}
 function pointerMove(e){cross={x:e.offsetX,y:e.offsetY};if(gesture){const step=Math.max(1,(el.clientWidth-36)/Math.max(1,gesture.to-gesture.from));pan(Math.round((gesture.x-e.clientX)/step));gesture.x=e.clientX;}else paint();}
 function pointerUp(){gesture=null;}
 function wheel(e){e.preventDefault();zoom(e.deltaY<0?0.8:1.25);}
 canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);
 if(typeof ResizeObserver==='function'){observer=new ResizeObserver(paint);observer.observe(el);}
 paint();
 return {setData,paint,zoom,pan,getVisibleRange:()=>({...view}),destroy(){if(destroyed)return;destroyed=true;if(observer)observer.disconnect();canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('pointerdown',pointerDown);canvas.removeEventListener('pointermove',pointerMove);canvas.removeEventListener('pointerup',pointerUp);canvas.removeEventListener('pointercancel',pointerUp);canvas.remove();}};
}
return {geometry,mount,indicators,closedReplay};
});
