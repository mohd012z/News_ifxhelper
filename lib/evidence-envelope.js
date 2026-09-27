'use strict';
const crypto=require('crypto');
function iso(v){const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null;}
function stable(v){if(v==null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';}
function evidenceId(x){const key=[x.agent||'UNKNOWN',x.source||'UNKNOWN',iso(x.sourceAt)||'NO_TIME',stable(x.evidence||[])].join('|');return crypto.createHash('sha256').update(key).digest('hex').slice(0,24);}
function mergeConflicts(items){return [...new Set((items||[]).flatMap(x=>Array.isArray(x&&x.conflicts)?x.conflicts:[]).filter(Boolean))].sort();}
function makeEvidence(input={}){const sourceAt=iso(input.sourceAt),fetchedAt=iso(input.fetchedAt||Date.now());const latencyMs=sourceAt&&fetchedAt?Math.max(0,new Date(fetchedAt)-new Date(sourceAt)):null;const x={schemaVersion:1,agent:String(input.agent||'UNKNOWN').toUpperCase(),source:input.source||'UNKNOWN',sourceAt,fetchedAt,latencyMs,quality:String(input.quality||'UNKNOWN').toUpperCase(),freshness:String(input.freshness||'UNKNOWN').toUpperCase(),status:String(input.status||'UNKNOWN').toUpperCase(),fallbackUsed:!!input.fallbackUsed,callbackRequired:!!input.callbackRequired,evidence:Array.isArray(input.evidence)?input.evidence:[],conflicts:mergeConflicts([input]),metadata:input.metadata||{}};x.id=evidenceId(x);return x;}
module.exports={iso,stable,evidenceId,mergeConflicts,makeEvidence};
