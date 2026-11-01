/** Optional D1 Telegram update receipt with lease fencing. No guaranteed exactly-once external send. */
export const RECEIPTS_SCHEMA = "CREATE TABLE IF NOT EXISTS telegram_update_receipts (update_id INTEGER PRIMARY KEY, state TEXT NOT NULL CHECK (state IN ('processing','done')), lease_until_ms INTEGER NOT NULL, epoch INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 1, updated_at_ms INTEGER NOT NULL)";
const changed = r => Number(r?.meta?.changes ?? r?.changes ?? 0) === 1;
export async function withTelegramReceipt(db, updateId, action, {now=Date.now, leaseMs=60000}={}) {
 if(!db || typeof db.prepare!=='function')throw Error('Telegram D1 inbox unavailable');
 if(!Number.isSafeInteger(updateId)||updateId<0)throw TypeError('Invalid Telegram update id');
 const t=now();
 if(!Number.isSafeInteger(t)||!Number.isSafeInteger(leaseMs)||leaseMs<30000||leaseMs>300000)throw Error('Invalid receipt clock or lease');
 const ins=await db.prepare("INSERT OR IGNORE INTO telegram_update_receipts (update_id,state,lease_until_ms,epoch,attempts,updated_at_ms) VALUES (?,'processing',?,1,1,?)").bind(updateId,t+leaseMs,t).run();
 let epoch=1;
 if(!changed(ins)){
  const row=await db.prepare("SELECT state,lease_until_ms,epoch FROM telegram_update_receipts WHERE update_id=?").bind(updateId).first();
  if(!row)throw Error('Receipt disappeared');
  if(row.state==='done')return {status:'duplicate',value:null};
  if(row.lease_until_ms>t)return {status:'busy',value:null};
  const claim=await db.prepare("UPDATE telegram_update_receipts SET lease_until_ms=?,epoch=epoch+1,attempts=attempts+1,updated_at_ms=? WHERE update_id=? AND state='processing' AND epoch=? AND lease_until_ms<=?").bind(t+leaseMs,t,updateId,row.epoch,t).run();
  if(!changed(claim))return {status:'busy',value:null};
  epoch=Number(row.epoch)+1;
 }
 const release=async()=>{await db.prepare("UPDATE telegram_update_receipts SET lease_until_ms=0,updated_at_ms=? WHERE update_id=? AND state='processing' AND epoch=?").bind(now(),updateId,epoch).run();};
 try{
  const value=await action();
  if(!(value instanceof Response)||value.status>=500){
   await release();return {status:'retry',value:value instanceof Response?value:new Response('Reply unavailable',{status:503})};
  }
  const done=await db.prepare("UPDATE telegram_update_receipts SET state='done',lease_until_ms=0,updated_at_ms=? WHERE update_id=? AND state='processing' AND epoch=?").bind(now(),updateId,epoch).run();
  if(!changed(done))throw Error('Receipt fencing changed during reply');
  return {status:'done',value};
 }catch(error){try{await release();}catch{}throw error;}
}
