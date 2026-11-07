-- HELIX manual review staging schema. Apply only to a dedicated staging D1 database.
CREATE TABLE IF NOT EXISTS helix_update_receipts (
  update_id INTEGER PRIMARY KEY CHECK(update_id >= 0),
  actor_id TEXT NOT NULL,
  command TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK(created_at >= 0)
);
CREATE TABLE IF NOT EXISTS helix_news_delivery (
  event_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('pending','reviewed','sending','sent','uncertain','rejected','manual_pending')),
  message_id TEXT,
  reviewed_by TEXT,
  updated_at INTEGER NOT NULL CHECK(updated_at >= 0),
  CHECK(status <> 'sent' OR message_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS helix_news_delivery_status_updated ON helix_news_delivery(status,updated_at);
