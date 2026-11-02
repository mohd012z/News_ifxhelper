-- Staging-only WhatsApp notification persistence. Do not apply to production without approval.
CREATE TABLE IF NOT EXISTS whatsapp_notification_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_key TEXT NOT NULL UNIQUE,
  destination_kind TEXT NOT NULL CHECK (destination_kind IN ('group','channel-draft')),
  destination_ref TEXT NOT NULL,
  impact TEXT NOT NULL CHECK (impact IN ('low','medium','high')),
  event_payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','retry','delivered','manual-review','manual-published','dead-letter','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  provider_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_jobs_ready ON whatsapp_notification_jobs(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS whatsapp_delivery_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_key TEXT NOT NULL,
  action TEXT NOT NULL,
  status_code INTEGER,
  provider_error_code INTEGER,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(job_key) REFERENCES whatsapp_notification_jobs(job_key)
);
