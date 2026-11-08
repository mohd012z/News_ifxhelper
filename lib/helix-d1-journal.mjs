// Isolated D1 journal. No external delivery or Worker route registration.
export async function recordSnapshot(db,snapshot){
 if(!db||!snapshot||!/^[a-f0-9]{64}$/.test(snapshot.id))throw Error('INVALID_SNAPSHOT');
 const payload=JSON.stringify(snapshot);
 const r=await db.prepare('INSERT OR IGNORE INTO helix_research_snapshots (id,symbol,provider,as_of,quality,payload_json) VALUES (?,?,?,?,?,?)')
 .bind(snapshot.id,snapshot.symbol,snapshot.provider,snapshot.asOf,snapshot.quality,payload).run();
 return {id:snapshot.id,inserted:r.meta?.changes===1};
}
export async function queuePreview(db,{id,snapshotId,destination}){
 if(!/^[a-f0-9]{64}$/.test(id)||!/^[a-f0-9]{64}$/.test(snapshotId)||!/^preview:[a-z0-9_-]{1,64}$/.test(destination))throw Error('INVALID_PREVIEW');
 const r=await db.prepare("INSERT OR IGNORE INTO helix_delivery_outbox (id,snapshot_id,destination,state) VALUES (?,?,?,'PREVIEW')").bind(id,snapshotId,destination).run();
 return {id,inserted:r.meta?.changes===1};
}
export async function recordAndPreview(db,snapshot,preview){
 if(!db||typeof db.batch!=='function')throw Error('D1_BATCH_REQUIRED');
 if(!/^[a-f0-9]{64}$/.test(snapshot?.id)||!/^[a-f0-9]{64}$/.test(preview?.id)||!/^preview:[a-z0-9_-]{1,64}$/.test(preview?.destination))throw Error('INVALID_INPUT');
 const results=await db.batch([
  db.prepare('INSERT OR IGNORE INTO helix_research_snapshots (id,symbol,provider,as_of,quality,payload_json) VALUES (?,?,?,?,?,?)').bind(snapshot.id,snapshot.symbol,snapshot.provider,snapshot.asOf,snapshot.quality,JSON.stringify(snapshot)),
  db.prepare("INSERT OR IGNORE INTO helix_delivery_outbox (id,snapshot_id,destination,state) VALUES (?,?,?,'PREVIEW')").bind(preview.id,snapshot.id,preview.destination)
 ]);
 return {snapshotInserted:results[0].meta?.changes===1,previewInserted:results[1].meta?.changes===1};
}
export async function listPreview(db,limit=20){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_LIMIT');
 const r=await db.prepare("SELECT o.id,o.snapshot_id,o.destination,o.state,s.payload_json FROM helix_delivery_outbox o JOIN helix_research_snapshots s ON s.id=o.snapshot_id WHERE o.state='PREVIEW' ORDER BY s.as_of DESC,o.id LIMIT ?").bind(limit).all();
 return r.results||[];
}
