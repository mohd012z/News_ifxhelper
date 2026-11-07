-- Research-only schema; not applied to Cloudflare. Apply only after explicit approval.
CREATE TABLE IF NOT EXISTS helix_research_delivery (
 report_hash TEXT PRIMARY KEY CHECK(length(report_hash)=64),
 destination TEXT NOT NULL CHECK(destination='@ifxhelper2'),
 payload TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('AWAITING_APPROVAL','APPROVED','LEASED','DELIVERED','RETRY_WAIT','UNCERTAIN','REJECTED','EXPIRED')),
 created_at INTEGER NOT NULL,
 approved_by TEXT,
 approved_at INTEGER,
 approval_expires_at INTEGER,
 lease_token TEXT,
 lease_expires_at INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_retry_at INTEGER,
 telegram_message_id INTEGER,
 last_error_code TEXT,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_helix_delivery_queue ON helix_research_delivery(state,next_retry_at);
CREATE TABLE IF NOT EXISTS helix_delivery_attempts (
 attempt_id TEXT PRIMARY KEY,
 report_hash TEXT NOT NULL REFERENCES helix_research_delivery(report_hash),
 lease_token TEXT NOT NULL UNIQUE,
 started_at INTEGER NOT NULL,
 finished_at INTEGER,
 outcome TEXT NOT NULL CHECK(outcome IN ('STARTED','CONFIRMED_SUCCESS','CONFIRMED_NOT_SENT','UNCERTAIN')),
 telegram_message_id INTEGER,
 error_code TEXT
);
-- An implementation must claim work with a single conditional D1 UPDATE:
-- UPDATE helix_research_delivery SET state='LEASED',lease_token=?,lease_expires_at=?,attempts=attempts+1,updated_at=?
-- WHERE report_hash=? AND state IN ('APPROVED','RETRY_WAIT') AND approval_expires_at>?
-- AND (next_retry_at IS NULL OR next_retry_at<=?);
-- Require changes=1 before attempting a send. Lease expiry MUST become UNCERTAIN,
-- not automatically retryable, because Telegram may have accepted the request.
