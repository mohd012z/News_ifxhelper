'use strict';
/* LabelLayoutEngine (spec /precise-object-text /text-label) — pure function,
 * no DOM. Labels are NEVER placed raw on candle coordinates:
 *
 *   input candidates { candleId, type, direction, priority, anchorPrice,
 *                      anchorTime, text, evidenceId }
 *     -> pixel transform (via caller-supplied X/Y)
 *     -> candidate position
 *     -> collision detection (bounding boxes)
 *     -> viewport clipping
 *     -> priority resolution (high wins; low stacks / compact / hides)
 *     -> final bounding box (placed[] with x,y,w,h,stacked)
 *
 * When labels overlap, text is NEVER overpainted: the higher-priority label
 * keeps its box, lower-priority labels stack below; if vertical room runs out
 * the lowest priorities compact into a single combined strip (e.g.
 * "MOM↑ CSA↑ RE↑ MHV EXT↓") or are hidden (placed=false).
 *
 * Priority table (spec):
 *   Selected BBMA 100 | MOM 95 | CSA/CSAK 90 | RE-ENTRY 85 | MHV 80 |
 *   EXTREME 75 | News 70 | Session 60 | ordinary text 40
 */
var PRIORITIES={
  SELECTED:100, MOM:95, CSA:90, CSAK:90, REENTRY:85, RE:85,
  MHV:80, EXTREME:75, NEWS:70, SESSION:60, ORDINARY:40
};
var TYPE_PRIORITY={
  'SELECTED':100,'MOMENTUM':95,'MOM':95,
  'CSA':90,'CSAK':90,
  'REENTRY':85,'RE':85,
  'MHV':80,
  'EXTREME':75,
  'NEWS':70,'BLACKOUT':70,
  'SESSION':60,'TOKYO_OPEN':60,'US_OPEN':60,
  'TEXT':40,'ORDINARY':40
};
function priorityFor(type,explicit){
  if(explicit!=null&&Number.isFinite(+explicit))return +explicit;
  var t=String(type||'').toUpperCase();
  if(TYPE_PRIORITY[t]!=null)return TYPE_PRIORITY[t];
  for(var k in TYPE_PRIORITY){if(t.indexOf(k)>=0)return TYPE_PRIORITY[k];}
  return 40;
}
function overlap(a,b,pad){
  pad=pad||2;
  return !(a.x+a.w+pad<=b.x||b.x+b.w+pad<=a.x||a.y+a.h+pad<=b.y||b.y+b.h+pad<=a.y);
}
/**
 * layout(cands, ctx)
 *  cands: [{id,type,direction,priority,anchorPrice,anchorTime,text,evidenceId}]
 *  ctx:   { X(i),Y(p),candleIndex(cand)->i, width, height, padTop, padBottom,
 *           fontHeight, measure(text)->width, selectedId }
 * returns { placed:[{...cand, x,y,w,h,stacked,clipped,placed:true}],
 *           hidden:[...], compact:{x,y,w,h,text,ids:[]}|null }
 */
function layout(cands,ctx){
  var width=ctx.width,height=ctx.height,fontH=ctx.fontHeight||10,padTop=ctx.padTop||8,padBottom=ctx.padBottom||14;
  var measure=ctx.measure||function(t){return String(t||'').length*5.4;};
  /* 1. transform each candidate to a pixel anchor box */
  var items=[];
  for(var i=0;i<cands.length;i++){
    var c=cands[i];
    var ci=(ctx.candleIndex?ctx.candleIndex(c):null);
    if(ci==null)continue; /* no pixel position (not in this series) */
    var x=(typeof ctx.X==='function')?ctx.X(ci):ci;
    var y=(typeof ctx.Y==='function'&&c.anchorPrice!=null)?ctx.Y(+c.anchorPrice):null;
    if(y==null)y=height*0.3;
    var t=c.text||String((c.type||'')+' '+(c.direction=== 'UP'?'↑':c.direction==='DOWN'?'↓':'')).trim();
    if(!t)continue;
    var w=measure(t)+6,h=fontH;
    items.push({c:c,id:c.id||('c'+i),x:x,y:y,w:w,h:h,
      priority:priorityFor(c.type,c.priority),
      selected:c.id===ctx.selectedId,
      ax:x}); /* anchor x for stacking order */
  }
  /* selected label forced to top priority (spec: Selected BBMA 100) */
  items.forEach(function(it){if(it.selected)it.priority=100;});
  /* 2. sort: priority desc, then left-to-right */
  items.sort(function(a,b){return b.priority-a.priority||a.ax-b.ax;});
  /* 3. greedy placement with collision -> stack vertically; if out of room,
     mark hidden (a later compact pass rescues the top of the pile) */
  var placed=[],hidden=[];
  for(var j=0;j<items.length;j++){
    var it=items[j];
    /* clamp candidate x into the viewport, keep the box fully inside */
    it.x=Math.max(2,Math.min(width-it.w-2,it.x-it.w/2));
    it.y=Math.max(padTop,Math.min(height-padBottom-it.h,it.y-it.h-4));
    var box={x:it.x,y:it.y,w:it.w,h:it.h},ok=true;
    for(var k=0;k<placed.length;k++){
      if(!overlap(box,placed[k].box,2))continue;
      /* try to stack below the conflicting higher-priority box */
      var below=placed[k].box.y+placed[k].box.h+2;
      var tries=[below,placed[k].box.y-it.h-2];
      ok=false;
      for(var tr=0;tr<tries.length;tr++){
        var ty=Math.max(padTop,Math.min(height-padBottom-it.h,tries[tr]));
        var tb={x:it.x,y:ty,w:it.w,h:it.h};
        var fits=true;
        for(var m=0;m<placed.length;m++){if(overlap(tb,placed[m].box,2)){fits=false;break;}}
        if(fits){box=tb;it.y=ty;it.stacked=true;ok=true;break;}
      }
      if(ok)break; /* resolved against this box; re-check others below */
    }
    if(!ok){hidden.push(it);continue;}
    /* viewport clip check (a stack may push it off-screen) */
    it.clipped=(it.x<0||it.x+it.w>width||it.y<0||it.y+it.h>height);
    if(it.clipped){hidden.push(it);continue;}
    placed.push({it:it,box:box});
  }
  /* 4. compact: if 2+ hidden labels share an x-neighborhood, merge the
     highest-priority survivors into one combined strip so nothing is lost. */
  var compact=null;
  if(hidden.length>=2){
    hidden.sort(function(a,b){return b.priority-a.priority||a.ax-b.ax;});
    var first=hidden[0];
    var baseTxt=first.c.text||String(first.c.type||'');
    var stripText=baseTxt;
    var stripIds=[first.id];
    var stripX=(first.x!=null?first.x:first.ax);
    var stripW=measure(stripText)+6;
    for(var h2=1;h2<hidden.length;h2++){
      var hx=(hidden[h2].x!=null?hidden[h2].x:hidden[h2].ax);
      if(Math.abs(hx-stripX)>(width*0.35))continue; /* different candle: skip */
      var txt=stripText+' '+(hidden[h2].c.text||String(hidden[h2].c.type||''));
      if(measure(txt)+6>width-4)break; /* would not fit: stop */
      stripText=txt;stripW=measure(stripText)+6;stripIds.push(hidden[h2].id);
    }
    if(stripIds.length>=2){
      compact={x:Math.max(2,Math.min(width-stripW-2,stripX-stripW/2)),y:padTop,w:Math.round(stripW),h:fontH,text:stripText,ids:stripIds};
    }
  }
  var out=placed.map(function(p){
    var it=p.it,c=it.c;
    return {id:it.id,type:c.type,direction:c.direction,priority:it.priority,
      anchorPrice:c.anchorPrice,anchorTime:c.anchorTime,text:it.stacked?c.text:c.text,
      evidenceId:c.evidenceId,candleId:c.candleId,
      x:Math.round(it.x),y:Math.round(it.y),w:Math.round(it.w),h:Math.round(it.h),
      stacked:!!it.stacked,placed:true};
  });
  return {placed:out,hidden:hidden.map(function(h){return h.id;}),compact:compact};
}
/* UMD: Node (require) + browser (window.LabelLayoutEngine). Pure — no DOM. */
(function(root,mod){
  if(typeof module!=='undefined'&&module.exports){module.exports=mod();}
  else{root.LabelLayoutEngine=mod();}
})(typeof self!=='undefined'?self:this,function(){
  return {layout:layout,priorities:TYPE_PRIORITY,priorityFor:priorityFor,overlap:overlap};
});
