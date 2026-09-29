'use strict';
/* File-based probe for a deterministic REENTRY series (avoids inline -e consent). */
const E=require('../lib/bbma-engine.js');
const base=Date.UTC(2026,8,20,0,0,0);
function series(n,fn){const o=[];for(let i=0;i<n;i++){const p=fn(i);const op=p+(i%3===0?1.5:-1.5);o.push({time:base+i*300000,open:+op.toFixed(2),high:+(Math.max(op,p)+0.8).toFixed(2),low:+(Math.min(op,p)-0.8).toFixed(2),close:+p.toFixed(2)});}return o;}
const hits=[];
/* downtrend, then a final bar that RETRACES up (high pokes into the lower
 * LWMA of highs) but CLOSES back down below mid+ema50 -> REENTRY_DOWN_ZONE */
for(const dropN of [120,125,130]){
  for(const s of [2.0,2.8,3.5]){
    for(const poke of [1.0,2.0,3.5,5.0]){
      const fn=i=>{
        const flat=4200-dropN*2.6;
        if(i<dropN)return 4200-i*2.6;
        if(i===dropN)return flat+poke;      /* the retracing bar: high pokes up */
        return flat;                          /* then settles back */
      };
      const c=series(140,fn);
      /* force the final bar's HIGH up to the poke, keep CLOSE down */
      const last=c[c.length-1];
      last.high=+(last.close+poke).toFixed(2);
      last.open=+(last.close-0.5).toFixed(2);
      const r=E.classify(c);
      if(r.state==='READY'&&r.reentry!=='NONE'){
        hits.push({dropN,s,poke,trend:r.trend,reentry:r.reentry,zone:r.zone});
      }
    }
  }
}
console.log(JSON.stringify(hits.slice(0,15),null,1));
console.log('total hits',hits.length);
