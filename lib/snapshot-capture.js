'use strict';
const crypto=require('crypto');
const KINDS=new Set(['MARKET','EVENT','CONTEXT','PRE_EVENT']);
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}
function deepFreeze(o){if(!o||typeof o!=='object'||Object.isFrozen(o))return o;Object.freeze(o);for(const v of Object.values(o))deepFreeze(v);return o;}
function idFor(kind,x,version){const identity=[kind,x.symbol||'',x.timeframe||'',x.candleTime||x.eventTime||'',x.eventId||'',version||'v1'].join('|');return crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);}
function capture(kind,input={},opts={}){if(!KINDS.has(kind))throw new Error('Unsupported snapshot kind: '+kind);const dataVersion=opts.dataVersion||'v1',capturedAt=opts.capturedAt||new Date().toISOString();const x=clone(input);const record={kind,snapshotId:idFor(kind,x,dataVersion),dataVersion,capturedAt,...x};return deepFreeze(record);}
function outcome(snapshotId,data={},opts={}){if(!snapshotId)throw new Error('snapshotId required');return deepFreeze({kind:'OUTCOME',snapshotId,capturedAt:opts.capturedAt||new Date().toISOString(),...clone(data)});}
module.exports={KINDS,capture,outcome,idFor,deepFreeze};
