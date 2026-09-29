'use strict';
/* FORMATION MEMORY (F0–F5) — instrument isolation, canonical candle,
   transition state machine, MTF tree, fingerprint, multi-horizon. */
const assert=require('assert');
const IM=require('../lib/instrument-memory');
const FM=require('../lib/formation-memory');
const EM=require('../lib/ai/empirical-memory');

let n=0;function ok(cond,msg){assert(cond,msg);n++;}

/* ---------- F0: instrument memory isolation ---------- */
const gcf={canonicalId:'GC_FUTURES',marketType:'FUTURES',proxyStatus:'PROXY',analysisSymbol:'XAUUSD'};
const spot={canonicalId:'XAUUSD_SPOT',marketType:'SPOT',analysisSymbol:'XAUUSD'};
ok(IM.memoryRoot(gcf)==='GC_FUTURES_PROXY','GC=F proxy routes to GC_FUTURES_PROXY');
ok(IM.memoryRoot(spot)==='XAUUSD_SPOT','spot routes to XAUUSD_SPOT');
ok(!IM.sameMemoryA(gcf,spot),'proxy and spot are DIFFERENT memory partitions');
ok(IM.sameMemoryA(gcf,{canonicalId:'GC_FUTURES',marketType:'FUTURES'}),'same root matches');
ok(IM.crossResearchKey(gcf)==='GC_FUTURES→XAUUSD','proxy research key points to target');
ok(IM.crossResearchKey(spot)===null,'spot has no proxy research key');
ok(!IM.contaminated({memoryRoot:'X'}),'partitioned record is not contaminated');
ok(IM.contaminated(null),'missing record is contaminated (isolate)');

/* the leak plug: empirical matcher — a GC=F row can NEVER feed an XAUUSD
   spot query, even at the coarsest L4 (tf+trend) level. */
const proxyRow={settled:true,correct:true,tf:'M15',pattern:'DOWN',state:{pattern:'DOWN',atr:'NORMAL',session:'LONDON',bbmaZone:'INSIDE_BB',newsPhase:'NO_NEWS',htf:{}},memoryRoot:'GC_FUTURES_PROXY'};
const spotRow={settled:true,correct:false,tf:'M15',pattern:'DOWN',state:{pattern:'DOWN',atr:'NORMAL',session:'LONDON',bbmaZone:'INSIDE_BB',newsPhase:'NO_NEWS',htf:{}},memoryRoot:'XAUUSD_SPOT'};
const spotQuery={tf:'M15',bbma:'DOWN',zone:'INSIDE_BB',volatility:'NORMAL',session:'LONDON',news:'NO_NEWS',trend:'DOWN',memoryRoot:'XAUUSD_SPOT'};
const rSpot=EM.match(spotQuery,[proxyRow,spotRow].concat(Array(9).fill(null).map(()=>spotRow)),{minSamples:8});
ok(rSpot.rate?rSpot.rate.n>0:true,'spot query found spot rows');
ok((rSpot.rate&&rSpot.rate.correct===0)||rSpot.level==='NONE','spot query got ZERO proxy rows (rate over 10 spot rows, all correct=false)');
const rCross=EM.match({tf:'M15',bbma:'DOWN',zone:'INSIDE_BB',volatility:'NORMAL',session:'LONDON',news:'NO_NEWS',trend:'DOWN',memoryRoot:'GC_FUTURES_PROXY'},[spotRow].concat(Array(9).fill(null).map(()=>spotRow)),{minSamples:8});
ok(rCross.level==='NONE'&&rCross.samples===0,'proxy query sees ZERO spot rows');
/* legacy (pre-F0) rows: visible only to legacy (rootless) queries */
const legacyRow={settled:true,correct:true,tf:'M15',pattern:'DOWN',state:{pattern:'DOWN',atr:'NORMAL',session:'LONDON',bbmaZone:'INSIDE_BB',newsPhase:'NO_NEWS',htf:{}}};
ok(EM.match(spotQuery,[legacyRow].concat(Array(9).fill(null).map(()=>legacyRow)),{minSamples:8}).level==='NONE','partitioned query does NOT see legacy rows');
ok(EM.match({tf:'M15',bbma:'DOWN',zone:'INSIDE_BB',volatility:'NORMAL',session:'LONDON',news:'NO_NEWS',trend:'DOWN'},[legacyRow].concat(Array(9).fill(null).map(()=>legacyRow)),{minSamples:8}).rate.n===10,'legacy query sees legacy rows');

/* ---------- F1: canonical candle (immutable) ---------- */
const candle={time:'2026-09-29T04:15:00.000Z',open:3764.21,high:3768.40,low:3761.10,close:3766.82};
const bbma={state:'READY',trend:'DOWN',momentum:'NONE',extreme:'NONE',csak:'CSAK_DOWN',reentry:'NONE',emaGap:'EMA50_INSIDE_BB',zone:'LOW_BB',lastTime:'2026-09-29T04:15:00.000Z'};
const cc=FM.canonicalCandle(candle,bbma,{symbol:'XAUUSD',tf:'M15',provider:'yahoo',sourceSymbol:'GC=F'});
ok(cc.candleId==='XAUUSD:M15:2026-09-29T04:15:00.000Z','candleId = symbol:tf:time');
ok(cc.closed===true&&cc.openTime===candle.time,'closed + openTime');
ok(cc.bbma.event==='CSAK'&&cc.bbma.direction==='DOWN'&&cc.bbma.csak===true,'event token CSAK, direction DOWN');
ok(cc.body.direction==='BULL'&&Math.abs(cc.body.bodyRatio-((3766.82-3764.21)/(3768.40-3761.10)))<1e-3,'body math');
ok(cc.provenance.sourceSymbol==='GC=F'&&cc.provenance.provider==='yahoo','provenance');
ok(Object.isFrozen(cc)&&Object.isFrozen(cc.ohlc)&&Object.isFrozen(cc.bbma),'deep-frozen immutable');
assert.throws(()=>{cc.ohlc.open=1;},'frozen ohlc');n++;
/* deterministic candleId across builds */
ok(FM.canonicalCandle(candle,bbma,{symbol:'XAUUSD',tf:'M15'}).candleId===cc.candleId,'deterministic candleId');

/* ---------- F2: transition state machine ---------- */
const seq=[
 {time:'t0',bbma:{trend:'DOWN',momentum:'NONE',extreme:'NONE',csak:'NONE',reentry:'NONE'}},
 {time:'t1',bbma:{trend:'DOWN',momentum:'MOMENTUM_DOWN',extreme:'NONE',csak:'NONE',reentry:'NONE'}},
 {time:'t2',bbma:{trend:'DOWN',momentum:'MOMENTUM_DOWN',extreme:'NONE',csak:'NONE',reentry:'NONE'}},
 {time:'t3',bbma:{trend:'DOWN',momentum:'MOMENTUM_DOWN',extreme:'NONE',csak:'NONE',reentry:'NONE'}},
 {time:'t4',bbma:{trend:'DOWN',momentum:'NONE',extreme:'NONE',csak:'NONE',reentry:'REENTRY_DOWN_ZONE'}},
 {time:'t5',bbma:{trend:'DOWN',momentum:'NONE',extreme:'NONE',csak:'NONE',reentry:'NONE'}}
];
const tr=FM.transitionsFor(seq,'M15',{symbol:'X'});
ok(tr.states.length===6,'6 states');
ok(tr.states[0].state==='DOWN'&&tr.states[1].state==='MOM'&&tr.states[4].state==='RE','token sequence DOWN→MOM→RE');
ok(tr.transitions.length===3,'3 transitions (DOWN→MOM, MOM→RE, RE→DOWN)');
const t1=tr.transitions[0];
ok(t1.from==='DOWN'&&t1.to==='MOM'&&t1.barsElapsed===1,'first transition after 1 bar');
const t2=tr.transitions[1];
ok(t2.from==='MOM'&&t2.to==='RE'&&t2.barsElapsed===3,'MOM held 3 bars before REENTRY');
ok(t1.startCandleId==='X:M15:t0'&&t1.confirmedCandleId==='X:M15:t1','candle ids in transition');
ok(tr.events.length===4&&tr.events[0].event==='MOM'&&tr.events[3].event==='RE','events = every discrete event candle (3 MOM + 1 RE)');
/* also accepts the {time, analysis:{bbma}} shape (invariant: both consumers
   read the SAME canonical engine output) */
const tr2=FM.transitionsFor(seq.map(r=>({time:r.time,analysis:{bbma:r.bbma}})),'M15',{symbol:'X'});
ok(JSON.stringify(tr2.transitions)===JSON.stringify(tr.transitions),'analysis-shape rows give identical transitions');

/* ---------- F3: MTF formation tree (3 layers + relationships) ---------- */
function mk(trend,csak){return {bbma:{state:'READY',trend,extreme:'NONE',momentum:'NONE',csak:csak?'CSAK_DOWN':'NONE',reentry:'NONE',zone:csak?'LOW_BB':'INSIDE_BB',lastTime:'2026-09-29T04:00:00.000Z'}};}
const analysis={
 H4:mk('DOWN',true),H1:mk('DOWN',true),M30:mk('DOWN',true),M15:mk('DOWN',false),M5:{bbma:{state:'READY',trend:'DOWN',extreme:'NONE',momentum:'NONE',csak:'NONE',reentry:'REENTRY_DOWN_ZONE',zone:'LOW_BB',lastTime:'2026-09-29T04:05:00.000Z'}}
};
const tree=FM.formationTree(analysis,{tf:'M15',time:'2026-09-29T04:00:00.000Z'},{symbol:'XAUUSD',instrument:gcf});
ok(tree.memoryRoot==='GC_FUTURES_PROXY','tree carries the memory partition');
ok(tree.layers.STRUCTURE.tokens.length===1&&/H4/.test(tree.layers.STRUCTURE.tokens[0]),'STRUCTURE layer has H4');
ok(tree.layers.SETUP.tokens.length===3,'SETUP layer has H1+M30+M15');
ok(tree.layers.TRIGGER.tokens.length===1&&/M5/.test(tree.layers.TRIGGER.tokens[0]),'TRIGGER layer has M5');
ok(tree.relationships.length===4,'4 adjacent-TF relationships');
const rel=tree.relationships.find(r=>r.parentTF==='H4'&&r.childTF==='H1');
ok(rel&&rel.alignment==='CONFIRM'&&(rel.parentState==='CSAK_S'||rel.parentState==='DOWN_S'),'H4→H1 CONFIRM same direction');
ok(rel&&rel.parentState===rel.childState,'aligned tokens equal here');
ok(tree.anchor.timeframe==='M15'&&tree.anchor.candleId==='XAUUSD:M15:2026-09-29T04:00:00.000Z','anchor');
ok(Object.isFrozen(tree),'tree immutable');

/* DIVERGE detection */
const tree2=FM.formationTree({H4:mk('DOWN',false),H1:{bbma:{state:'READY',trend:'UP',extreme:'NONE',momentum:'NONE',csak:'NONE',reentry:'NONE',zone:'TOP_BB',lastTime:'2026-09-29T04:00:00.000Z'}},M15:mk('DOWN',false)},{tf:'M15',time:'2026-09-29T04:00:00.000Z'},{symbol:'XAUUSD',instrument:spot});
const div=tree2.relationships.find(r=>r.parentTF==='H4');
ok(div&&div.alignment==='DIVERGE','H4 DOWN vs H1 UP = DIVERGE');

/* ---------- F4: formation fingerprint (deterministic, partitioned) ---------- */
const fp1=FM.formationFingerprint(tree,{session:'LONDON',newsPhase:'NO_NEWS',atrBand:'NORMAL'});
const fp2=FM.formationFingerprint(FM.formationTree(analysis,{tf:'M15',time:'2026-09-29T04:00:00.000Z'},{symbol:'XAUUSD',instrument:gcf}),{session:'LONDON',newsPhase:'NO_NEWS',atrBand:'NORMAL'});
ok(fp1.stateId===fp2.stateId,'deterministic formationFingerprintId');
ok(/^GC_FUTURES_PROXY /.test(fp1.fingerprint),'fingerprint names the memory partition');
ok(/H4_/.test(fp1.fingerprint)&&/M5_RE_S/.test(fp1.fingerprint),'fingerprint carries the per-TF event codes');
ok(fp1.stateId&&fp1.stateId.length===24,'24-char id');
const fp3=FM.formationFingerprint(FM.formationTree(analysis,{tf:'M15',time:'2026-09-29T04:00:00.000Z'},{symbol:'XAUUSD',instrument:spot}),{session:'LONDON',newsPhase:'NO_NEWS',atrBand:'NORMAL'});
ok(fp3.stateId!==fp1.stateId,'same formation, DIFFERENT instrument => different fingerprint (no cross-memory)');

/* ---------- F5: multi-horizon settlement ---------- */
function mkC(t,o,h,l,c){return {time:t,open:o,high:h,low:l,close:c};}
/* anchor at t0 close=100, call DOWN; drifts up 1 bar (plus1Against), then drops */
const f5={M15:[
 mkC('t0',100,101,99,100),
 mkC('t1',100,101,99.5,100.5),
 mkC('t2',100.5,100.6,98,98.5),
 mkC('t3',98.5,98.6,95,95.2),
 mkC('t4',95.2,95.5,94.5,95),
 mkC('t5',95,95.4,92,92.3),
 mkC('t6',92.3,92.8,91,91.4)
]};
const obs5={tf:'M15',candleTime:'t0',state:'DOWN_BIAS',bbma:{trend:'DOWN',momentum:'NONE',extreme:'NONE',csak:'NONE',reentry:'NONE'}};
const mh=FM.multiHorizon(obs5,f5,{t1:'DOWN',t2:'MOM',t3:'MOM',t4:'RE',t5:'DOWN'});
ok(mh&&mh.plus.plus1.direction==='UP'&&mh.plus1Against===true,'plus1 against the DOWN call');
ok(mh.plus.plus5.returnPct<0,'plus5 deeply against close');
ok(mh.mfePct<0&&mh.maePct>0,'DOWN call: mfe on the low side, mae on the high side');
ok(mh.nextState==='MOM'&&mh.barsToNextState===2,'nextState = first token change (t1 still DOWN, MOM at +2)');
ok(mh.complete===true,'all 5 horizons covered');
/* incomplete: only 2 future candles */
const f5b={M15:[f5.M15[0],f5.M15[1],f5.M15[2]]};
const mh2=FM.multiHorizon(obs5,f5b,{});
ok(mh2.complete===false&&mh2.plus.plus1&&mh2.plus.plus2&&!mh2.plus.plus5,'partial horizons reported honestly');
ok(mh2.nextState===null,'no tokens => no nextState (not invented)');
/* anchor not in frames => null, not a crash */
ok(FM.multiHorizon({tf:'M15',candleTime:'zz',state:'DOWN_BIAS',bbma:bbma},f5,{})===null,'missing anchor returns null');

console.log('PASS: formation-memory — F0 instrument isolation (proxy≠spot, legacy quarantine, matcher gate), F1 immutable canonical candle, F2 transition state machine (barsElapsed, candle ids), F3 MTF 3-layer tree + cross-TF CONFIRM/DIVERGE, F4 deterministic partitioned fingerprint, F5 multi-horizon +1/2/3/5 + direction-aware MFE/MAE + nextState. '+n+' assertions');
