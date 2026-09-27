'use strict';
/** BBMA multi-timeframe dashboard model. Descriptive context, not trade execution. */
const BBMA=require('./bbma-engine');
const CHAINS=[
 ['W1','D1','H4'],['D1','H4','H1'],['H4','H1','M30'],['H1','M30','M15'],['M30','M15','M5'],['M15','M5','M1']
];
function direction(x){return x&&x.state==='READY'&&['UP','DOWN'].includes(x.trend)?x.trend:null;}
function chainState(frames,chain){
 const rows=chain.map(tf=>({tf,state:frames[tf]||{state:'MISSING'}}));
 const dirs=rows.map(r=>direction(r.state)).filter(Boolean);
 let alignment='INSUFFICIENT_DATA';
 if(dirs.length===chain.length) alignment=dirs.every(x=>x==='UP')?'UP_ALIGNED':dirs.every(x=>x==='DOWN')?'DOWN_ALIGNED':'MIXED';
 return {chain,alignment,rows};
}
function role(tf){return ({W1:'MACRO',D1:'MAJOR',H4:'MAJOR',H1:'SETUP',M30:'BRIDGE',M15:'TRIGGER',M5:'EXECUTION',M1:'MICRO'})[tf]||'OTHER';}
function badge(x){
 if(!x||x.state!=='READY')return 'NO_DATA';
 if(x.momentum!=='NONE')return x.momentum;
 if(x.reentry!=='NONE')return x.reentry;
 if(x.csak!=='NONE')return x.csak;
 if(x.extreme!=='NONE')return x.extreme;
 return x.trend==='MIXED'?'RANGE_OR_TRANSITION':x.trend;
}
function build(rawFrames,qualityByTf={}){
 const result=BBMA.mtf(rawFrames), frames=result.frames;
 const rows=Object.entries(frames).map(([tf,x])=>({tf,role:role(tf),trend:x.trend||'UNKNOWN',pattern:badge(x),squeeze:x.squeeze||'UNKNOWN',quality:qualityByTf[tf]||'UNKNOWN',lastTime:x.lastTime||null}));
 return {generatedAt:new Date().toISOString(),overall:result.alignment,up:result.up,down:result.down,rows,chains:CHAINS.map(c=>chainState(frames,c))};
}
module.exports={CHAINS,direction,chainState,role,badge,build};
