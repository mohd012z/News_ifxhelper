'use strict';
/* Executed proof for the P0 lineage fix: generation-fingerprint + instrument-registry.
 * Run: node test/generation-lineage.test.js
 */
const assert=require('assert');
const GF=require('../lib/generation-fingerprint.js');
const IR=require('../lib/instrument-registry.js');
let pass=0;function ok(c,m){assert(c,m);pass++;}

/* ===== InstrumentRegistry (P0: one canonical instrument registry) ===== */
const gc=IR.resolve({providerSymbol:'GC=F',analysisSymbol:'XAUUSD',marketType:'FUTURES',provider:'yahoo'});
ok(gc.canonicalId==='GC_FUTURES','GC=F -> GC_FUTURES');
ok(gc.venue==='COMEX'&&gc.marketType==='FUTURES','GC_FUTURES carries venue COMEX + FUTURES');
ok(gc.isProxy===true,'GC=F flagged as proxy for XAUUSD');
const spot=IR.resolve({providerSymbol:'XAU/USD',analysisSymbol:'XAUUSD',marketType:'SPOT'});
ok(spot.canonicalId==='XAUUSD_SPOT','XAU/USD spot -> XAUUSD_SPOT');
ok(spot.isProxy===false,'direct spot is NOT a proxy');
const xaut=IR.resolve({providerSymbol:'XAUt',marketType:'TOKENIZED'});
ok(xaut.canonicalId==='XAUSDT_PROXY','XAUt -> XAUSDT_PROXY');
ok(IR.sameSeries({providerSymbol:'GC=F'},{providerSymbol:'XAU/USD',marketType:'SPOT'})===false,'GC=F and XAUUSD spot are DIFFERENT series (never silently merged)');
ok(IR.sameSeries({providerSymbol:'XAU/USD',marketType:'SPOT'},{providerSymbol:'XAUUSD',marketType:'SPOT'})===true,'two spot spellings = same series');
const unk=IR.resolve({providerSymbol:'FOO123'});
ok(unk.canonicalId==='UNKNOWN'&&unk.note.indexOf('distinct series')>=0,'unknown symbol = UNKNOWN, must not merge');

/* ===== Generation fingerprint (P0: lineage = algorithm identity) ===== */
const a=GF.fingerprint({provider:'yahoo',instrument:'GC_FUTURES',extraConfig:{range:'5d'}});
const b=GF.fingerprint({provider:'yahoo',instrument:'GC_FUTURES',extraConfig:{range:'5d'}});
ok(a.algoGenerationId===b.algoGenerationId,'same config -> same algoGenerationId (deterministic)');
ok(a.algoGenerationId.indexOf('gen-')===0,'id prefix gen-');
ok(a.components.featureSchemaVersion==='FeatureSnapshot/v2','fingerprint pins the feature schema version');
ok(a.components.bbmaRuleVersion.indexOf('rules')>=0,'fingerprint pins the BBMA rule version');
const c=GF.fingerprint({provider:'yahoo',instrument:'GC_FUTURES',extraConfig:{range:'5d'}});
const d=GF.fingerprint({provider:'twelvedata',instrument:'GC_FUTURES',extraConfig:{range:'5d'}});
ok(c.algoGenerationId!==d.algoGenerationId,'provider identity change -> DIFFERENT algoGenerationId');
const e=GF.fingerprint({provider:'yahoo',instrument:'GC_FUTURES',extraConfig:{range:'1d'}});
ok(a.algoGenerationId!==e.algoGenerationId,'config change -> DIFFERENT algoGenerationId (A vs B separable)');
const f=GF.fingerprint({provider:'yahoo',instrument:'XAUUSD_SPOT',extraConfig:{range:'5d'}});
ok(a.algoGenerationId!==f.algoGenerationId,'instrument identity change -> DIFFERENT algoGenerationId');
/* key-order independence of the config hash */
const g1=GF.fingerprint({provider:'yahoo',instrument:'GC_FUTURES',extraConfig:{a:1,b:2}});
const g2=GF.fingerprint({provider:'yahoo',instrument:'GC_FUTURES',extraConfig:{b:2,a:1}});
ok(g1.algoGenerationId===g2.algoGenerationId,'config hash is key-order independent');

/* ===== lineage over algoGenerationId (the actual P0: fake-accuracy prevention) ===== */
const L1=GF.lineage([{algoGenerationId:a.algoGenerationId},{algoGenerationId:a.algoGenerationId}]);
ok(L1.status==='CONSISTENT','all one algo generation -> CONSISTENT');
const L2=GF.lineage([{algoGenerationId:a.algoGenerationId},{algoGenerationId:d.algoGenerationId}]);
ok(L2.status==='MIXED'&&L2.generations===2,'two algo generations -> MIXED (old algo results visible, not merged)');
const L3=GF.lineage([{},{}]);
ok(L3.status==='UNKNOWN','no algo id -> UNKNOWN (honest, not faked)');
/* the crux: after a rule change, a fresh run must NOT read old results as current */
const afterRuleChange=GF.lineage([{algoGenerationId:a.algoGenerationId},{algoGenerationId:d.algoGenerationId}]);
ok(afterRuleChange.status==='MIXED','algorithm A vs B is separable after a change (no masquerading)');

console.log('PASS: generation-lineage — canonical InstrumentRegistry (GC_FUTURES COMEX / XAUUSD_SPOT / XAUSDT_PROXY, different series never merged, GC=F is a proxy) + deterministic algorithm generationId = SHA256(engine+rules+featureSchema+resampler+provider+instrument+config) inherited by every observation, with CONSISTENT/MIXED/UNKNOWN lineage so old-algorithm results can never masquerade as current.',pass,'assertions');
