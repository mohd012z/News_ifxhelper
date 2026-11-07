'use strict';
/**
 * Isolated D1 journal. No Telegram transport, scheduler or Worker entrypoint.
 * All writes are conditional; lease expiry is UNCERTAIN, never auto-retried.
 */
const {fingerprint,validateEvidence,DEST}=require('./helix-delivery-gate');
function assertDb(db){if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function')throw new TypeError('D1 binding required');}
function affected(result){return result?.meta?.changes===1;}
function hex(s){return typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);}
function nowMs(now){if(!Number.isSafeInteger(now)||now<0)throw new RangeError('invalid clock');return now;}
function retryDelay(attempts){if(!Number.isInteger(attempts)||attempts<1)throw new RangeError('invalid attempt count');return Math.min(3600000,Math.pow(2,Math.min(attempts-1,10))*30000);}
function journal(db){
 assertDb(db);
 const row=id=>db.prepare('SELECT * FROM helix_research_delivery WHERE report_hash=?').bind(id).first();
 return Object.freeze({
  async enqueue(report,preview,now=Date.now()){
   nowMs(now);validateEvidence(report,now);const id=fingerprint(preview);
   const payload=JSON.stringify(preview);
   const r=await db.prepare("INSERT OR IGNORE INTO helix_research_delivery (report_hash,destination,payload,state,created_at,updated_at) VALUES (?,? ,?,'AWAITING_APPROVAL',?,?)").bind(id,DEST,payload,now,now).run();
   return {id,created:affected(r),record:await row(id)};
  },
  async approve(id,actor,expiresAt,now=Date.now()){
   nowMs(now);if(!hex(id)||typeof actor!=='string'||!actor.trim()||actor.length>128||!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+3600000)throw new TypeError('invalid approval');
   const r=await db.prepare("UPDATE helix_research_delivery SET state='APPROVED',approved_by=?,approved_at=?,approval_expires_at=?,updated_at=? WHERE report_hash=? AND destination=? AND state='AWAITING_APPROVAL'").bind(actor,now,expiresAt,now,id,DEST).run();
   return affected(r);
  },
  async claim(id,token,now=Date.now(),leaseMs=60000){
   nowMs(now);if(!hex(id)||typeof token!=='string'||!/^[-a-zA-Z0-9_]{16,128}$/.test(token)||!Number.isSafeInteger(leaseMs)||leaseMs<1000||leaseMs>300000)throw new TypeError('invalid claim');
   // D1 batch executes statements transactionally. A rejected claim cannot create an attempt.
   const results=await db.batch([
    db.prepare("UPDATE helix_research_delivery SET state='LEASED',lease_token=?,lease_expires_at=?,attempts=attempts+1,updated_at=? WHERE report_hash=? AND destination=? AND state IN ('APPROVED','RETRY_WAIT') AND approved_by IS NOT NULL AND approval_expires_at>? AND (next_retry_at IS NULL OR next_retry_at<=?) AND NOT EXISTS (SELECT 1 FROM helix_delivery_attempts WHERE lease_token=?)").bind(token,now+leaseMs,now,id,DEST,now,now,token),
    db.prepare("INSERT INTO helix_delivery_attempts(attempt_id,report_hash,lease_token,started_at,outcome) SELECT ?,report_hash,?,?,'STARTED' FROM helix_research_delivery WHERE report_hash=? AND state='LEASED' AND lease_token=? AND updated_at=?").bind(token,token,now,id,token,now)
   ]);
   if(!affected(results[0]))return {claimed:false};
   if(!affected(results[1]))throw new Error('attempt journal not persisted');
   return {claimed:true,record:await row(id)};
  },
  async settle(id,token,outcome,{messageId=null,errorCode=null,now=Date.now()}={}){
   nowMs(now);if(!hex(id)||typeof token!=='string'||!['CONFIRMED_SUCCESS','CONFIRMED_NOT_SENT','UNCERTAIN'].includes(outcome))throw new TypeError('invalid settlement');
   if(outcome==='CONFIRMED_SUCCESS'&&(!Number.isSafeInteger(messageId)||messageId<=0))throw new TypeError('confirmed message ID required');
   if(errorCode!==null&&(typeof errorCode!=='string'||errorCode.length>128))throw new TypeError('invalid error code');
   const current=await row(id);
   if(!current||current.state!=='LEASED'||current.lease_token!==token)return false;
   const next=outcome==='CONFIRMED_SUCCESS'?'DELIVERED':outcome==='CONFIRMED_NOT_SENT'?'RETRY_WAIT':'UNCERTAIN';
   const retry=next==='RETRY_WAIT'?now+retryDelay(current.attempts):null;
   const results=await db.batch([
    db.prepare("UPDATE helix_delivery_attempts SET finished_at=?,outcome=?,telegram_message_id=?,error_code=? WHERE attempt_id=? AND report_hash=? AND outcome='STARTED' AND EXISTS (SELECT 1 FROM helix_research_delivery WHERE report_hash=? AND state='LEASED' AND lease_token=?)").bind(now,outcome,messageId,errorCode,token,id,id,token),
    db.prepare("UPDATE helix_research_delivery SET state=?,next_retry_at=?,telegram_message_id=?,last_error_code=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE report_hash=? AND state='LEASED' AND lease_token=? AND EXISTS (SELECT 1 FROM helix_delivery_attempts WHERE attempt_id=? AND report_hash=? AND outcome=?)").bind(next,retry,messageId,errorCode,now,id,token,token,id,outcome)
   ]);
   if(affected(results[0])!==affected(results[1]))throw new Error('inconsistent journal settlement');
   return affected(results[0]);
  },
  async recover(now=Date.now()){
   nowMs(now);
   const results=await db.batch([
    db.prepare("UPDATE helix_delivery_attempts SET outcome='UNCERTAIN',finished_at=?,error_code='LEASE_EXPIRED' WHERE outcome='STARTED' AND EXISTS (SELECT 1 FROM helix_research_delivery WHERE state='LEASED' AND lease_expires_at<=? AND lease_token=helix_delivery_attempts.lease_token AND report_hash=helix_delivery_attempts.report_hash)").bind(now,now),
    db.prepare("UPDATE helix_research_delivery SET state='UNCERTAIN',last_error_code='LEASE_EXPIRED',lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE state='LEASED' AND lease_expires_at<=?").bind(now,now)
   ]);
   return {quarantined:results[1]?.meta?.changes??0};
  },
  async inspect(id){if(!hex(id))throw new TypeError('invalid report ID');return row(id);}
 });
}
module.exports={journal,retryDelay};
