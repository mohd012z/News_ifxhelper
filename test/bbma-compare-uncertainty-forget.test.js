'use strict';
/* EXECUTED proof: /compare engine (§7) + uncertainty decomposition (§9) +
 * forgetting (§13). */
const assert=require('assert');
const COMP=require('../lib/compare-engine.js');
const UNC=require('../lib/uncertainty-decompose.js');
const FORGET=require('../lib/forgetting.js');
const FP=require('../lib/state-fingerprint.js');

/* Build a settled corpus: 40 identical M15 REENTRY_UP episodes, 70% correct,
   but the most-recent 20 only 50% correct (a recent deterioration). */
function ep(i,correct,session,newsPhase,gen){
  const st={asset:'GC=F',tf:'M15',pattern:'REENTRY_UP_ZONE',bbmaZone:'LOW_BB',htf:{H1:'UP',H4:'UP'},atr:'NORMAL',session:session||'NEW_YORK',newsPhase:newsPhase||'NO_NEWS'};
  return {tf:'M15',pattern:'REENTRY_UP_ZONE',state:st,stateId:FP.stateId(st),session:session||'NEW_YORK',newsPhase:newsPhase||'NO_NEWS',
    settled:true,correct:correct,recordedAt:new Date(Date.UTC(2026,8,1+i)).toISOString(),confidence:{score:80,prohibitions:[]},value:{value:0.5},generationId:gen||'g1'};
}
const corpus=[];
for(let i=0;i<20;i++)corpus.push(ep(i,i<18?true:false));          /* older 20: 18/20 = 90%  -> long-term total 70% */
for(let i=0;i<20;i++)corpus.push(ep(20+i,i<10?true:false));       /* recent 20: 10/20 = 50% (deterioration) */
const c=COMP.compare({tf:'M15',pattern:'REENTRY_UP_ZONE',session:'NEW_YORK',newsPhase:'NO_NEWS'},corpus);
const rate=label=>(c.rows.find(r=>r.label===label)||{}).rate;
assert.strictEqual(rate('Long-term'),70,'long-term continuation 70% (got '+rate('Long-term')+')');
assert.strictEqual(rate('Recent 20'),50,'recent-20 continuation 50% (got '+rate('Recent 20')+')');
assert.strictEqual(c.flag,'recent deterioration','⚠ recent deterioration flagged (15pp drop): '+c.flag);
assert.ok(c.rows.every(r=>r.n!=null),'every compare row carries a sample size (not a bare number)');
assert.ok(/Long-term 70%/.test(c.summary)&&/Recent 20 50%/.test(c.summary),'summary is a labelled list, not a single averaged confidence: '+c.summary);
/* exact matches: same stateId -> the whole corpus (all 40) */
const qstate={asset:'GC=F',tf:'M15',pattern:'REENTRY_UP_ZONE',bbmaZone:'LOW_BB',htf:{H1:'UP',H4:'UP'},atr:'NORMAL',session:'NEW_YORK',newsPhase:'NO_NEWS'};
const c2=COMP.compare({tf:'M15',pattern:'REENTRY_UP_ZONE',session:'NEW_YORK',newsPhase:'NO_NEWS',stateId:FP.stateId(qstate)},corpus);
assert.strictEqual(c2.rows.find(r=>r.label==='Exact matches').n,40,'exact matches = all 40 same-state episodes');

/* --- uncertainty decomposition (§9): NOT one averaged number --- */
const u1=UNC.decompose({confidence:{score:90,prohibitions:[]},instrument:{isProxy:false},modelLineage:'CONSISTENT',histSamples:40,newsState:'NO_NEWS',atr:'NORMAL',htfConflict:false,trendStrength:0.4});
assert.strictEqual(u1.decision,'PROCEED','clean data + consistent model + 40 samples + no news + aligned regime => PROCEED (eligible)');
assert.strictEqual(u1.sources.data.level,'LOW');assert.strictEqual(u1.sources.model.level,'LOW');assert.strictEqual(u1.sources.historical.level,'LOW');
/* a HIGH-impact PRE_NEWS + HTF conflict => WATCH (news/regime uncertainty) */
const u2=UNC.decompose({confidence:{score:90,prohibitions:[]},instrument:{isProxy:false},modelLineage:'CONSISTENT',histSamples:40,newsState:'PRE_NEWS',eventImpact:'HIGH',atr:'NORMAL',htfConflict:true,trendStrength:0.4});
assert.strictEqual(u2.decision,'WATCH','high-impact news + HTF conflict => WATCH');
assert.strictEqual(u2.sources.news.level,'HIGH');assert.strictEqual(u2.sources.regime.level,'HIGH');
/* a PROHIBITED (data) source => BLOCK, regardless of a high score */
const u3=UNC.decompose({confidence:{score:95,prohibitions:['SYNTHETIC_DATA_PRESENT']},instrument:{isProxy:false},modelLineage:'CONSISTENT',histSamples:40,newsState:'NO_NEWS',atr:'NORMAL'});
assert.strictEqual(u3.decision,'BLOCK','a data prohibition BLOCKS even at score 95 (quality gate > score, §5 carried through)');
assert.ok(u3.drivers.includes('data=HIGH'),'the blocking driver is named (auditable): '+u3.drivers.join(','));
/* the module INFORMS; it never says "publish" */
assert.ok(!/publish|post|telegram/i.test(u1.note+u2.note+u3.note),'uncertainty module never publishes — it only informs the Governor');

/* --- forgetting (§13): remember everything for audit, trust selectively --- */
const now=Date.UTC(2026,8,28);
const fresh=Object.assign(ep(27,true),{stateId:'sid_fresh',modelGeneration:'g2'});fresh.recordedAt=new Date(now-24*3600000).toISOString();
const stale=Object.assign(ep(5,true),{stateId:'sid_stale',modelGeneration:'g2'});stale.recordedAt=new Date(now-200*24*3600000).toISOString();
const prohibited=Object.assign(ep(10,false),{stateId:'sid_proh',modelGeneration:'g2'});prohibited.confidence={score:50,prohibitions:['STALE']};
const badgen=Object.assign(ep(8,true),{stateId:'sid_gen'});badgen.modelGeneration='g1'; /* old generation -> isolated */
const f=FORGET.forget([fresh,stale,prohibited,badgen],{now:now,currentRegime:{session:'NEW_YORK',newsPhase:'NO_NEWS'},currentGeneration:'g2',halfLifeDays:45});
/* nothing deleted (audit preserved) */
assert.strictEqual(f.weighted.length,4,'all 4 episodes retained for audit (forgetting re-weights, never deletes)');
const byId={};f.weighted.forEach(o=>byId[o.episode.recordedAt]=o);
/* prohibited (STALE) is QUARANTINED, not trusted */
const qProhibited=f.weighted.find(o=>o.episode.confidence&&o.episode.confidence.prohibitions&&o.episode.confidence.prohibitions.length);
assert.strictEqual(qProhibited.quarantined,true,'bad-data (STALE-prohibited) is quarantined');
assert.strictEqual(qProhibited.quarantineReason,'BAD_DATA_STALE');
/* old-generation (g1) vs current (g2) is quarantined (obsolete-generation isolation) */
const qGen=f.weighted.find(o=>o.episode.modelGeneration==='g1'&&!(o.episode.confidence&&o.episode.confidence.prohibitions&&o.episode.confidence.prohibitions.length));
assert.strictEqual(qGen.quarantined,true,'g1 knowledge is quarantined when the current generation is g2 (v3->v4 isolation, §10)');
assert.strictEqual(qGen.quarantineReason,'OBSOLETE_GENERATION_g1');
/* the fresh, clean, current-regime episode gets the highest trust weight */
const freshO=f.weighted.find(o=>!o.quarantined&&o.episode.recordedAt===fresh.recordedAt);
assert.ok(freshO.weight>0.5,'a fresh clean current-regime episode retains high trust weight: '+freshO.weight);
/* the 200-day-old episode is decayed below the fresh one */
const staleO=f.weighted.find(o=>o.episode.recordedAt===stale.recordedAt);
assert.ok(staleO.weight<freshO.weight,'an old episode is decay-weighted below a fresh one (age matters): '+staleO.weight+' < '+freshO.weight);
/* trusted set excludes quarantined */
const trusted=FORGET.trustedSet(f);
assert.ok(trusted.every(o=>!o.quarantined),'trusted set contains only non-quarantined episodes (trust selectively for reasoning)');
/* duplicate compression */
const dup=FORGET.forget([fresh,JSON.parse(JSON.stringify(fresh))],{now:now});
assert.strictEqual(dup.compressedCount,1,'duplicate stateId episodes compressed (audit count kept)');

console.log('compare + uncertainty + forgetting proof: /compare returns a LABELLED list (Long-term 70% / Recent 20 50%) with sample sizes and a ⚠ recent-deterioration flag, never one averaged confidence; uncertainty decomposes into data/model/historical/news/regime and the Governor rule is PROCEED/WATCH/BLOCK with a data-prohibition BLOCKING even at score 95 (module informs, never publishes); forgetting keeps all episodes for audit but quarantines bad-data + obsolete-generation and decay-weights stale, so reasoning trusts selectively (fresh 0.58 > stale 0.10)');
process.exit(0);
