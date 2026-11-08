import assert from 'node:assert/strict';
import {recordAndPreview,listPreview} from '../lib/helix-d1-journal.mjs';
const snapshot={id:'a'.repeat(64),symbol:'XAUUSD',provider:'test',asOf:'2026-11-08T02:15:00Z',quality:'VALIDATED'};
const preview={id:'b'.repeat(64),destination:'preview:local'};
class FakeD1{
 constructor(){this.snap=new Map();this.out=new Map();}
 prepare(sql){return {bind:(...args)=>({sql,args,run:async()=>this.apply(sql,args),all:async()=>({results:[...this.out.values()].filter(x=>x.state==='PREVIEW').map(x=>({...x,payload_json:JSON.stringify(this.snap.get(x.snapshot_id))}))})})};}
 apply(sql,a){if(sql.includes('helix_research_snapshots')){if(this.snap.has(a[0]))return {meta:{changes:0}};this.snap.set(a[0],{id:a[0],symbol:a[1],provider:a[2],asOf:a[3],quality:a[4]});return {meta:{changes:1}};}if(!this.snap.has(a[1]))throw Error('FOREIGN_KEY');if(this.out.has(a[0]))return {meta:{changes:0}};this.out.set(a[0],{id:a[0],snapshot_id:a[1],destination:a[2],state:'PREVIEW'});return {meta:{changes:1}};}
 async batch(stmts){const snap=new Map(this.snap),out=new Map(this.out);try{return await Promise.all(stmts.map(s=>s.run()));}catch(e){this.snap=snap;this.out=out;throw e;}}
}
const db=new FakeD1();
assert.deepEqual(await recordAndPreview(db,snapshot,preview),{snapshotInserted:true,previewInserted:true});
assert.deepEqual(await recordAndPreview(db,snapshot,preview),{snapshotInserted:false,previewInserted:false});
assert.equal((await listPreview(db)).length,1);
const restart=new FakeD1();restart.snap=db.snap;restart.out=db.out;
assert.equal((await listPreview(restart)).length,1,'persistent backing state visible after restart');
await assert.rejects(recordAndPreview(db,snapshot,{...preview,destination:'telegram:live'}),/INVALID_INPUT/);
assert.equal(db.out.size,1,'invalid destination not inserted');
console.log('HELIX D1 adapter contract, idempotency and simulated restart tests passed');
