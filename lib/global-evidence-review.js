'use strict';
// Pure evidence review; never infer market moves from headlines.
const ALLOWED=new Set(['usgs','noaa','eia','iea','opec','federal-reserve','sec','government','news','x','twitter','instagram']);
function canonicalUrl(value) {
 if(typeof value!=='string') return null;
 try { const u=new URL(value); if(u.protocol!=='https:'||u.username||u.password||u.hostname==='localhost') return null; u.hash=''; return u.href; } catch { return null; }
}
function evaluateEvidence(item,{nowMs=Date.now(),maxAgeMs=86400000}={}) {
 if(!item||typeof item!=='object') throw TypeError('Invalid story');
 if(!Number.isFinite(nowMs)||!Number.isFinite(maxAgeMs)||maxAgeMs<0) throw Error('Invalid clock');
 const provider=String(item.provider||'').toLowerCase();
 const urls=[...new Set((Array.isArray(item.evidenceUrls)?item.evidenceUrls:[]).map(canonicalUrl).filter(Boolean))];
 const domains=new Set(urls.map(u=>new URL(u).hostname.replace(/^www\./,'')));
 const time=Date.parse(item.publishedAt||item.timeUtc||'');
 const fresh=Number.isFinite(time)&&time<=nowMs+300000&&nowMs-time<=maxAgeMs;
 const social=['x','twitter','instagram'].includes(provider);
 const independent=domains.size>=2;
 const official=ALLOWED.has(provider)&&!social&&provider!=='news';
 const confirmed=item.verified===true&&fresh&&(official||independent)&&(!social||independent);
 const marketEffect=confirmed&&item.marketReactionVerified===true&&item.marketDataEvidence===true?'observed':'not-established';
 return {confirmed,fresh,independent,sourceCount:domains.size,sourceClass:social?'social-lead':official?'official':'unverified-news',marketEffect,evidenceUrls:urls.slice(0,5)};
}
function dedupeStories(stories) {
 const seen=new Set();
 return stories.filter(s=>{const key=JSON.stringify([String(s.provider||'').toLowerCase(),String(s.title||s.event||'').toLowerCase().replace(/\s+/g,' ').trim(),String(s.publishedAt||s.timeUtc||'').slice(0,10)]);if(seen.has(key))return false;seen.add(key);return true;});
}
module.exports={canonicalUrl,evaluateEvidence,dedupeStories};
