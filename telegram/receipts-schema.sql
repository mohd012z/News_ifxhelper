-- Initialize only in an owner-approved, isolated D1 database.
CREATE TABLE IF NOT EXISTS telegram_update_receipts (
 update_id INTEGER PRIMARY KEY,
 state TEXT NOT NULL CHECK (state IN ('processing','done')),
 lease_until_ms INTEGER NOT NULL,
 epoch INTEGER NOT NULL DEFAULT 1,
 attempts INTEGER NOT NULL DEFAULT 1,
 updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS telegram_receipts_lease_idx ON telegram_update_receipts(state,lease_until_ms);
