'use strict';
/** Exact migration + journal SQL against a real file-backed SQLite engine.
 * No network, Cloudflare bindings, Telegram transport or production writes.
 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {journal}=require('../lib/helix-d1-journal');
const {fingerprint}=require('../lib/helix-delivery-gate');
const NOW=Date.parse('2026-11-07T00:00:00Z');
const preview={mode:'PREVIEW_ONLY',destination:'@ifxhelper2',parse_mode:'HTML',text:'<b>HELIX offline test</b>'};
const report={kind:'RESEARCH_ONLY',asOf:new Date(NOW-1000).toISOString(),timeframes:Object.fromEntries(['H4','H1','M15','M5'].map(tf=>[tf,{state:'READY',closedCandles:55,latestClosedOpen:new Date(NOW-3600000).toISOString(),bbma:{state:'READY'},zones:[]}]))};
const id=fingerprint(preview);
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'helix-d1-sqlite-'));
 const file=path.join(dir,'journal.db');
 const handles=[];
 const connect=({failBatchAt=0}={})=>{
  const db=new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;');
  handles.push(db);
  return {
   prepare(sql){return {bind(...args){return {
    first(){return db.prepare(sql).get(...args)??null;},
    run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}
   };}};},
   batch(statements){
    db.exec('BEGIN IMMEDIATE');
    try{
     const result=[];
     for(let i=0;i<statements.length;i++){
      if(failBatchAt===i+1)throw new Error('INJECTED_CRASH');
      result.push(statements[i].run());
     }
     db.exec('COMMIT');
     return result;
    }catch(e){db.exec('ROLLBACK');throw e;}
   }
  };
 };
 const first=connect();
 const schema=fs.readFileSync(path.join(__dirname,'../migrations/helix_research_delivery_draft.sql'),'utf8');
 handles[0].exec(schema);
 t.after(()=>{for(const db of handles)db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const raw=()=>handles[0];
 return {connect,first,raw};
}
async function seeded(t){
 const f=fixture(t);
 const j=journal(f.first);
 const a=await j.enqueue(report,preview,NOW);
 assert.equal(a.created,true);
 assert.equal((await j.enqueue(report,preview,NOW)).created,false);
 assert.equal(await j.approve(id,'offline-reviewer',NOW+3600000,NOW),true);
 return {...f,j};
}
test('exact schema: duplicate insert is idempotent and destination is constrained',async t=>{
 const {raw}=await seeded(t);
 assert.equal(raw().prepare('SELECT count(*) AS n FROM helix_research_delivery').get().n,1);
 assert.throws(()=>raw().prepare("INSERT INTO helix_research_delivery(report_hash,destination,payload,state,created_at,updated_at) VALUES (?,?,?,?,?,?)").run('b'.repeat(64),'@wrong','{}','APPROVED',NOW,NOW),/CHECK/);
});
test('competing connections: only one atomic claim and attempt record',async t=>{
 const {connect,j,raw}=await seeded(t);
 const contender=journal(connect());
 const [a,b]=await Promise.all([j.claim(id,'token_first_0000001',NOW),contender.claim(id,'token_second_000001',NOW)]);
 assert.equal(Number(a.claimed)+Number(b.claimed),1);
 assert.equal(raw().prepare('SELECT count(*) AS n FROM helix_delivery_attempts').get().n,1);
 assert.equal((await j.inspect(id)).attempts,1);
});
test('injected crash between claim and attempt insert rolls back both',async t=>{
 const {connect,j,raw}=await seeded(t);
 await assert.rejects(journal(connect({failBatchAt:2})).claim(id,'token_crash_000001',NOW),/INJECTED_CRASH/);
 assert.equal((await j.inspect(id)).state,'APPROVED');
 assert.equal(raw().prepare('SELECT count(*) AS n FROM helix_delivery_attempts').get().n,0);
 assert.equal((await j.claim(id,'token_valid_000001',NOW)).claimed,true);
});
test('confirmed non-send retries after backoff; delivered cannot replay',async t=>{
 const {j,raw}=await seeded(t);
 assert.equal((await j.claim(id,'token_retry_000001',NOW)).claimed,true);
 assert.equal(await j.settle(id,'token_retry_000001','CONFIRMED_NOT_SENT',{now:NOW}),true);
 assert.equal((await j.claim(id,'token_early_000001',NOW+29999)).claimed,false);
 assert.equal((await j.claim(id,'token_later_000001',NOW+30000)).claimed,true);
 assert.equal(await j.settle(id,'token_later_000001','CONFIRMED_SUCCESS',{messageId:123,now:NOW+30000}),true);
 assert.equal((await j.claim(id,'token_again_000001',NOW+31000)).claimed,false);
 assert.equal(raw().prepare('SELECT count(*) AS n FROM helix_delivery_attempts').get().n,2);
 assert.equal(raw().prepare('SELECT state FROM helix_research_delivery').get().state,'DELIVERED');
});
test('settlement failure injection rolls back journal and delivery record',async t=>{
 const {connect,j,raw}=await seeded(t);
 assert.equal((await j.claim(id,'token_settle_000001',NOW)).claimed,true);
 await assert.rejects(journal(connect({failBatchAt:2})).settle(id,'token_settle_000001','CONFIRMED_NOT_SENT',{now:NOW}),/INJECTED_CRASH/);
 assert.equal(raw().prepare('SELECT outcome FROM helix_delivery_attempts').get().outcome,'STARTED');
 assert.equal((await j.inspect(id)).state,'LEASED');
 assert.equal(await j.settle(id,'token_settle_000001','UNCERTAIN',{now:NOW+1}),true);
 assert.equal((await j.inspect(id)).state,'UNCERTAIN');
});
test('restart on reopened SQLite: expired lease quarantined and never resent',async t=>{
 const {connect,j,raw}=await seeded(t);
 assert.equal((await j.claim(id,'token_restart_00001',NOW,1000)).claimed,true);
 const restarted=journal(connect());
 assert.equal((await restarted.recover(NOW+1001)).quarantined,1);
 assert.equal((await restarted.recover(NOW+2000)).quarantined,0);
 assert.equal((await restarted.inspect(id)).state,'UNCERTAIN');
 assert.equal(raw().prepare('SELECT outcome FROM helix_delivery_attempts').get().outcome,'UNCERTAIN');
 assert.equal((await restarted.claim(id,'token_replay_000001',NOW+2000)).claimed,false);
});
test('approval expires before lease; cannot claim',async t=>{
 const {j}=await seeded(t);
 assert.equal((await j.claim(id,'token_expired_00001',NOW+3600000)).claimed,false);
});
