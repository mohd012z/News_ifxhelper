// Pure, fail-closed review policy for the HELIX Telegram delivery control plane.
// No Telegram calls or side effects occur in this module.
const ALLOWED = new Set(['pending','reviewed','sent','uncertain','rejected']);
const HTTPS = /^https:\/\/[^\s/?#]+(?:[^\s]*)$/i;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function authorizedAdmin(actorId, configuredIds) {
  if (!/^[1-9]\d{0,19}$/.test(String(actorId ?? ''))) return false;
  const ids = String(configuredIds ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return ids.length > 0 && ids.every(id => /^[1-9]\d{0,19}$/.test(id)) && ids.includes(String(actorId));
}

export function validateNewsCandidate(candidate, now = Date.now()) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {ok:false, reason:'invalid_candidate'};
  if (typeof candidate.id !== 'string' || !/^[a-zA-Z0-9:_-]{8,128}$/.test(candidate.id)) return {ok:false,reason:'invalid_id'};
  if (typeof candidate.title !== 'string' || candidate.title.trim().length < 8 || candidate.title.length > 300) return {ok:false,reason:'invalid_title'};
  if (typeof candidate.sourceUrl !== 'string' || candidate.sourceUrl.length > 2048 || !HTTPS.test(candidate.sourceUrl)) return {ok:false,reason:'invalid_source'};
  let url;
  try { url = new URL(candidate.sourceUrl); } catch { return {ok:false,reason:'invalid_source'}; }
  if (url.username || url.password || url.port || /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(url.hostname) || url.hostname.endsWith('.local')) return {ok:false,reason:'unsafe_source'};
  if (!Number.isSafeInteger(candidate.publishedAt) || candidate.publishedAt > now + 300000 || now - candidate.publishedAt > MAX_AGE_MS) return {ok:false,reason:'stale_or_future'};
  if (!['scheduled','breaking'].includes(candidate.kind)) return {ok:false,reason:'invalid_kind'};
  if (!['low','medium','high'].includes(candidate.impact)) return {ok:false,reason:'invalid_impact'};
  if (candidate.kind === 'breaking' && candidate.independentlyVerified !== true) return {ok:false,reason:'unverified_breaking'};
  return {ok:true};
}

export function resendDecision({actorId, adminIds, record, candidate, confirmation, now=Date.now()}) {
  if (!authorizedAdmin(actorId,adminIds)) return {allowed:false,reason:'unauthorized'};
  const validation=validateNewsCandidate(candidate,now);
  if (!validation.ok) return {allowed:false,reason:validation.reason};
  if (!record || !ALLOWED.has(record.status) || record.eventKey !== candidate.id) return {allowed:false,reason:'invalid_record'};
  if (record.status === 'uncertain') return {allowed:false,reason:'reconcile_first'};
  if (record.status === 'rejected') return {allowed:false,reason:'rejected'};
  if (record.status !== 'sent') return {allowed:false,reason:'not_previously_sent'};
  if (confirmation !== 'RESEND '+candidate.id) return {allowed:false,reason:'confirmation_required'};
  if (!Number.isSafeInteger(record.messageId) || record.messageId <= 0) return {allowed:false,reason:'missing_delivery_evidence'};
  return {allowed:true,reason:'approved_for_atomic_claim'};
}
