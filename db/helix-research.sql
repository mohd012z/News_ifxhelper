CREATE TABLE IF NOT EXISTS helix_research_snapshots (
 id TEXT PRIMARY KEY,
 symbol TEXT NOT NULL,
 provider TEXT NOT NULL,
 as_of TEXT NOT NULL,
 quality TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS helix_delivery_outbox (
 id TEXT PRIMARY KEY,
 snapshot_id TEXT NOT NULL REFERENCES helix_research_snapshots(id),
 destination TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'DISABLED' CHECK (state IN ('DISABLED','PREVIEW','PENDING','LEASED','SENT','UNCERTAIN')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 last_error TEXT,
 UNIQUE(snapshot_id,destination)
);
CREATE INDEX IF NOT EXISTS helix_research_asof_idx ON helix_research_snapshots(symbol,as_of);
