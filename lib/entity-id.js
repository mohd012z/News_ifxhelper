'use strict';
const crypto=require('crypto');
function norm(v){return String(v==null?'':v).trim().toLowerCase().replace(/\s+/g,' ');}
function hash(parts){return crypto.createHash('sha256').update(parts.map(norm).join('|')).digest('hex').slice(0,24);}
function eventKey(e){return hash(['event',e.source||'',e.currency||'',e.event||e.title||'',e.scheduledAt||e.timeGmt||e.publishedAt||'']);}
function contentHash(x){return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');}
module.exports={norm,hash,eventKey,contentHash};
