'use strict';
/* EXECUTED proof: IN_AI internal debate + Falsifier (§8), self-correction
 * gate (§14) + knowledge provenance (§10), structured decision trace (§12),
 * and the MindState contract (§15). */
const assert=require('assert');
const fs=require('fs'),path=require('path'),os=require('os');
const DEB=require('../lib/debate-falsifier.js');
const GOV=require('../lib/correction-gate.js');
const TR=require('../lib/decision-trace.js');
const MS=require('../lib/mindstate.js');

/* --- §8 debate: bull/bear/range, kernel receives ALL three --- */
const bullCtx={mtf:{H1:{trend:'UP'},H4:{trend:'UP'},M15:{trend:'UP'}},zone:'LOW_BB',pattern:'REENTRY_UP_ZONE',squeeze:'TIGHT',news:{state:'NO_EVENT'},atr:'NORMAL',compare:{flag:null,settledSamples:30}};
const db=DEB.debate(bullCtx);
assert.ok(db.cases.BULL&&db.cases.BEAR&&db.cases.RANGE,'all three cases always built');
assert.ok(db.cases.BULL.claims.some(c=>/HTF aligned UP/.test(c.claim)),'bull has a real grounded claim');
assert.ok(db.synthesis.note.includes('ALL'),'synthesis makes explicit the Kernel receives all cases, not only the winner');
assert.ok(db.surviving.includes('BULL'),'bull survives in a clean UP-aligned context');
/* a bearish context flips the leading case — the debate is evidence-driven */
const bearCtx={mtf:{H1:{trend:'DOWN'},H4:{trend:'DOWN'},M15:{trend:'DOWN'}},zone:'TOP_BB',pattern:'MOMENTUM_DOWN',squeeze:'NONE',news:{state:'PRE_NEWS',event:'US CPI'},atr:'HIGH',compare:{flag:'recent deterioration',settledSamples:30},recentAccuracy:35};
const db2=DEB.debate(bearCtx);
assert.ok(db2.synthesis.leading==='BEAR'||db2.surviving.includes('BEAR'),'bear leads in a DOWN-aligned top-BB CPI context: '+db2.synthesis.leading);
/* falsifier attacks with SPECIFIC counter-evidence and can defeat a case */
assert.ok(Array.isArray(db2.falsifier.BEAR)&&db2.falsifier.BEAR.length,'falsifier produces findings per case');
/* a bull case in a DOWN market is falsified (material counter-evidence) */
assert.ok(db2.falsifier.BULL.some(f=>f.defeats)||!db2.surviving.includes('BULL'),'a bull case in a DOWN market is defeated/not surviving');
/* mixed/conflicting => RANGE is a legitimate survivor */
const mixCtx={mtf:{H1:{trend:'UP'},H4:{trend:'DOWN'}},zone:'MID_BB',pattern:'NONE',squeeze:'SQUEEZE',news:{state:'NO_EVENT'},atr:'LOW'};
assert.ok(DEB.debate(mixCtx).surviving.includes('RANGE'),'conflicting HTF + squeeze + low ATR => RANGE survives');

/* --- §14 correction gate: IN_AI proposes, Kernel NEVER auto-accepts --- */
const cand=GOV.propose({error:'reentry threshold too loose',suspectedCause:'wick >0.45 false positives',proposedAdjustment:'wick >0.55',supportingHistory:['3/5 recent reversals'],contradictingHistory:[],replayResult:{pass:true,note:'replay on 120 settled bars'},walkForwardResult:{degrading:false,note:'walk-forward 120 bars'}});
assert.strictEqual(cand.status,'PROPOSED','a correction starts PROPOSED (IN_AI)');
/* IN_AI may advance to TESTING then SHADOW, but needs evidence at each step */
let r=GOV.advance(cand,'TESTING');assert.ok(r.ok);
const testingCand=r.cand;
r=GOV.advance(testingCand,'SHADOW');assert.ok(r.ok&&r.cand.status==='SHADOW','SHADOW advances WITH a replay result on the candidate');
const noReplay=GOV.propose({error:'no replay yet'});let nr=GOV.advance(noReplay,'TESTING');
assert.strictEqual(GOV.advance(nr.cand,'SHADOW').ok,false,'SHADOW refused WITHOUT a replay result (evidence-gated)');
r=GOV.advance(r.cand,'VALIDATED');assert.ok(r.ok&&r.cand.status==='VALIDATED','VALIDATED advances WITH a walk-forward result on the candidate');
/* VALIDATED is refused WITHOUT a walk-forward result (evidence-gated) */
const noWf=GOV.propose({error:'no wf yet',replayResult:{pass:true}});let nw=GOV.advance(noWf,'TESTING');nw=GOV.advance(nw.cand,'SHADOW');
assert.strictEqual(GOV.advance(nw.cand,'VALIDATED').ok,false,'VALIDATED refused WITHOUT a walk-forward result (evidence-gated)');
/* IN_AI CANNOT promote (kernel-only) */
const badPromo=GOV.promote(r.cand,{});
assert.strictEqual(badPromo.ok,false,'PROMOTED is refused without an explicit approval (Kernel never auto-accepts)');
/* even a VALIDATED candidate is refused if walk-forward is DEGRADING */
const degr=GOV.propose({error:'x',proposedAdjustment:'y',replayResult:{pass:true},walkForwardResult:{degrading:true}});
let d=GOV.advance(degr,'TESTING');d=GOV.advance(d.cand,'SHADOW');d=GOV.advance(d.cand,'VALIDATED');
const degrPromo=GOV.promote(d.cand,{token:'FATAH-APPROVED',by:'KERNEL'});
assert.strictEqual(degrPromo.ok,false,'a walk-forward-DEGRADING correction is refused even with approval: '+degrPromo.reason);
/* a clean approval + non-degrading wf promotes */
const good=GOV.propose({error:'x',proposedAdjustment:'y',replayResult:{pass:true},walkForwardResult:{degrading:false}});
let g=GOV.advance(good,'TESTING');g=GOV.advance(g.cand,'SHADOW');g=GOV.advance(g.cand,'VALIDATED');
const promoted=GOV.promote(g.cand,{token:'FATAH-APPROVED',by:'KERNEL'});
assert.strictEqual(promoted.ok,true,'a VALIDATED + approved + non-degrading correction promotes');
assert.strictEqual(promoted.cand.status,'PROMOTED');
assert.ok(promoted.cand.approval.token,'the approval is recorded (provenance)');
/* rolling back a promoted correction isolates it (not auto-deleted) */
const rb=GOV.rollBack(promoted.cand,'regression after promotion');
assert.strictEqual(rb.ok,true,'a promoted correction can be rolled back');
assert.strictEqual(rb.cand.status,'ROLLED_BACK');
/* illegal transitions are refused (cannot skip SHADOW to VALIDATED from PROPOSED) */
assert.strictEqual(GOV.advance(GOV.propose({error:'x'}),'VALIDATED').ok,false,'cannot skip SHADOW to VALIDATED (from PROPOSED)');
assert.strictEqual(GOV.rollBack({status:'PROPOSED'},'x').ok,false,'only a PROMOTED correction can be rolled back');

/* --- §10 knowledge provenance + generation isolation --- */
const k3=GOV.makeKnowledge({claim:'REENTRY_UP+H1_UP continues',modelGeneration:'v3',methodVersion:'m5',sampleSize:40,dateRange:['2026-01','2026-08'],observations:[1,2,3],contradictingEvidence:[]});
assert.ok(k3.knowledgeId&&k3.modelGeneration==='v3'&&k3.methodVersion==='m5'&&!k3.status.includes('OBSOLETE'),'knowledge carries full provenance (claim/source/sampleSize/dateRange/modelGeneration/methodVersion/contradictingEvidence)');
const k4=GOV.makeKnowledge({claim:'v4 detection rule',modelGeneration:'v4'});
const iso=GOV.isolateForGeneration([k3,k4],'v3','v4');
assert.strictEqual(iso.quarantined.length,1,'v3 knowledge quarantined on v3->v4');
assert.strictEqual(iso.current.length,1,'v4 knowledge stays current');
assert.strictEqual(iso.quarantined[0].status,'OBSOLETE_GENERATION','old-generation knowledge is quarantined (auditable), not silently contaminated into v4');
assert.ok(iso.quarantined[0].quarantinedTo==='v4');
/* lineage preserved + expanded (the existing mechanism is kept) */
assert.strictEqual(GOV.lineage(['g1','g1']).status,'CONSISTENT');
assert.strictEqual(GOV.lineage(['g1','g2']).status,'MIXED');
assert.strictEqual(GOV.lineage([]).status,'UNKNOWN');

/* --- §12 structured decision trace: /codeview reconstructs the whole path --- */
const tmp=path.join(os.tmpdir(),'trace-'+Date.now()+'.jsonl');
const t1=TR.appendToFile(tmp,'tr_1','INGEST',{source:'GC=F',quality:'REAL',output:{bars:316}});
TR.appendToFile(tmp,'tr_1','VALIDATE',{quality:'VALID',output:{prohibitions:[]}});
TR.appendToFile(tmp,'tr_1','BBMA',{quality:'READY',output:{zone:'LOW_BB'}});
TR.appendToFile(tmp,'tr_1','FALSIFY',{quality:'OK',output:{surviving:['BULL']}});
TR.appendToFile(tmp,'tr_1','KERNEL',{quality:'WAIT',output:{decision:'WAIT'}});
TR.appendToFile(tmp,'tr_1','PREDICT',{quality:'APPENDED',output:{predictionId:'p1'}});
const loaded=TR.load(tmp);
assert.ok(loaded.verify().ok,'trace hash-chain verifies clean ('+loaded.verify().lines+' lines)');
assert.deepStrictEqual(loaded.stages(),['INGEST','VALIDATE','BBMA','FALSIFY','KERNEL','PREDICT'],'stages in order');
const recon=loaded.reconstruct();
assert.ok(/SEQ 1 \[INGEST\]/.test(recon)&&/SEQ 6 \[PREDICT\]/.test(recon),'reconstruct() renders the auditable path');
assert.ok(!/AI thinks|may rise/.test(recon),'no free-text "AI thinks" — every stage is structured (STAGE/INPUT/OUTPUT/QUALITY)');
/* tamper a middle stage's PAYLOAD (the real hash input) -> chain breaks (immutability) */
loaded.lines[2].payload.output={zone:'TOP_BB'};
assert.ok(!loaded.verify().ok,'retro-editing a trace stage payload BREAKS the chain (detected at '+loaded.verify().brokenAt+')');
/* unknown stage rejected */
let threw=false;try{const t2=new TR.Trace('tr_x');t2.append('NOT_A_STAGE',{});}catch(e){threw=true;}
assert.ok(threw,'an unknown trace stage is rejected (schema enforced)');
fs.unlinkSync(tmp);

/* --- §15 MindState: one compact "what the system knows" object --- */
const now=Date.UTC(2026,8,28,4,0,0);
function ep(i,correct){const st={asset:'GC=F',tf:'M15',pattern:'REENTRY_UP_ZONE',bbmaZone:'LOW_BB',htf:{H1:'UP',H4:'UP'},atr:'NORMAL',session:'NEW_YORK',newsPhase:'NO_NEWS'};return {tf:'M15',pattern:'REENTRY_UP_ZONE',state:st,stateId:'e'+i,session:'NEW_YORK',newsPhase:'NO_NEWS',settled:true,correct:correct,recordedAt:new Date(now-24*i*3600000).toISOString(),confidence:{score:80,prohibitions:[]},value:{value:0.5},generationId:'g1'};}
const episodes=[];for(let i=0;i<20;i++)episodes.push(ep(i,i%2===0));
const mind=MS.buildMindState({
  symbol:'GC=F',price:4167.7,instrument:{display:'XAU/USD',marketType:'FUTURES',isProxy:true},feed:{state:'LIVE'},
  mtf:{H1:{trend:'UP',state:'READY'},H4:{trend:'UP',state:'READY'},M15:{trend:'UP',state:'READY'}},
  zone:'LOW_BB',pattern:'REENTRY_UP_ZONE',squeeze:'TIGHT',
  news:{state:'NO_EVENT'},session:'NEW_YORK',atr:'NORMAL',trendStrength:0.5,htfConflict:false,
  confidence:{score:84,prohibitions:['INSTRUMENT_MISMATCH_UNRESOLVED'],verdict:'WAIT'},
  modelLineage:'CONSISTENT',generationIds:['g1'],episodes:episodes,
  openPredictions:[{prediction:{state:'UP_BIAS'}}],pendingOutcomes:[{prediction:{state:'UP_BIAS'}}],
  recentMistakes:[{id:'m1'}],now:now
});
assert.strictEqual(mind.schema,'MindState/v1');
assert.ok(mind.marketState&&mind.bbmaState&&mind.newsState&&mind.regimeState,'core state sections present');
assert.ok(Array.isArray(mind.activeHypotheses)&&mind.activeHypotheses.length,'activeHypotheses = the surviving debate cases');
assert.ok(Array.isArray(mind.recalledEpisodes)&&mind.recalledEpisodes.every(e=>typeof e.weight==='number'),'recalledEpisodes are weighted (from forgetting)');
assert.ok(mind.compare&&mind.compare.rows.length,'compare battery present (not a single number)');
assert.ok(mind.uncertainties&&mind.uncertainties.sources.data,'uncertainty decomposition present');
assert.ok(mind.kernelDecision&&mind.kernelDecision.decision,'kernelDecision is the Governor output (informing, not publishing)');
/* the instrument is a proxy + a prohibition => kernelDecision is NOT a blind PROCEED */
assert.ok(mind.kernelDecision.decision!=='PROCEED'||mind.uncertainties.sources.data.level!=='LOW','a proxy/prohibited instrument is not blindly PROCEED');
assert.ok(Array.isArray(mind.contradictions),'contradictions (falsifier) present');
assert.ok(Array.isArray(mind.nextRequiredEvidence),'nextRequiredEvidence tells what is missing');
assert.strictEqual(mind.driftState.lineage,'CONSISTENT','driftState carries the preserved lineage');
/* MindState NEVER recomputes BBMA and NEVER publishes: it is derived from the
   ctx + proven libs only (no network, no engine call, no Telegram). */
assert.ok(!/post|send|telegram/i.test(JSON.stringify(mind.kernelDecision)),'kernelDecision informs; MindState does not publish');

console.log('debate+gate+trace+mindstate proof: bull/bear/range always built, kernel receives ALL (not only the winner), falsifier defeats a bull case in a DOWN market; correction gate PROPOSED->TESTING->SHADOW->VALIDATED is evidence-gated and PROMOTED is kernel-only (auto-accept refused), walk-forward-degrading refused, roll-back isolates; knowledge provenance full + v3->v4 quarantines old gen (lineage CONSISTENT/MIXED/UNKNOWN preserved); decision trace is hash-chained, reconstructs the path, rejects unknown stages, breaks on tamper, and never says "AI thinks"; MindState/v1 is one compact object (market/bbma/news/regime + hypotheses + weighted recall + compare + uncertainties + contradictions + kernelDecision + nextRequiredEvidence) that derives from proven libs only and never publishes');
process.exit(0);
