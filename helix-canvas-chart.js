/* HELIX independent Canvas chart geometry and renderer. No trading or network operations. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.HELIXCanvas=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  function validate(candles){
    if(!Array.isArray(candles))throw new TypeError('Candles must be an array');
    let previous=-Infinity;
    return candles.map(function(c){
      const t=Date.parse(c.time);
      if(!Number.isFinite(t)||t<=previous)throw new RangeError('Candles must have strictly increasing timestamps');
      const values=[c.open,c.high,c.low,c.close].map(Number);
      if(!values.every(Number.isFinite)||values[1]<Math.max(values[0],values[3])||values[2]>Math.min(values[0],values[3])||values[2]>values[1])
        throw new RangeError('Invalid OHLC');
      previous=t;
      return {time:t,open:values[0],high:values[1],low:values[2],close:values[3]};
    });
  }
  function geometry(candles,width,height,padding){
    padding=padding===undefined?32:padding;
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=padding*2||height<=padding*2)throw new RangeError('Invalid viewport');
    if(!candles.length)throw new RangeError('No candles');
    const min=Math.min(...candles.map(c=>c.low)),max=Math.max(...candles.map(c=>c.high));
    const range=max-min||Math.max(1,Math.abs(max)*0.001);
    const step=(width-padding*2)/candles.length;
    return {x:i=>padding+step*(i+0.5),y:p=>height-padding-(p-min)/range*(height-padding*2),step,min,max};
  }
  function draw(canvas,input,options){
    if(!canvas||typeof canvas.getContext!=='function')throw new TypeError('Canvas required');
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Canvas 2D unavailable');
    const candles=validate(input);
    if(!candles.length)throw new RangeError('No candles');
    const w=canvas.width,h=canvas.height,g=geometry(candles,w,h,32);
    ctx.clearRect(0,0,w,h);
    const colors=Object.assign({up:'#2dcf98',down:'#f46c80',wick:'#9bb3c8'},options||{});
    candles.forEach((c,i)=>{
      const x=g.x(i),r=Math.max(1,Math.min(g.step*0.65,16))/2;
      ctx.strokeStyle=colors.wick;ctx.beginPath();ctx.moveTo(x,g.y(c.high));ctx.lineTo(x,g.y(c.low));ctx.stroke();
      ctx.fillStyle=c.close>=c.open?colors.up:colors.down;
      const top=Math.min(g.y(c.open),g.y(c.close)),height=Math.max(1,Math.abs(g.y(c.open)-g.y(c.close)));
      ctx.fillRect(x-r,top,r*2,height);
    });
    return {count:candles.length,min:g.min,max:g.max};
  }
  return {validate,geometry,draw};
});
