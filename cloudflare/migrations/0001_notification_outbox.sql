-- Staging-only notification outbox. Apply to a separate Cloudflare D1 staging database.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('whatsapp','telegram')),
  impact TEXT NOT NULL CHECK(impact IN ('low','medium','high')),
  recipient_hash TEXT NOT NULL,
  template_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','sent','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  next_attempt_at INTEGER NOT NULL,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  lease_epoch INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(event_key,channel,recipient_hash)
);
CREATE INDEX IF NOT EXISTS idx_notification_due ON notification_outbox(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_notification_lease ON notification_outbox(status,lease_expires_at);
CREATE TABLE IF NOT EXISTS notification_consent (
  recipient_hash TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('whatsapp','telegram')),
  opted_in INTEGER NOT NULL DEFAULT 0 CHECK(opted_in IN (0,1)),
  consent_source TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(recipient_hash,channel)
);
