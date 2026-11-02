-- Research-only shared agent memory. Do not store secrets or raw private messages.
CREATE TABLE IF NOT EXISTS research_memory (
 id TEXT PRIMARY KEY,
 agent TEXT NOT NULL,
 skill TEXT NOT NULL,
 event_key TEXT NOT NULL,
 source_url TEXT NOT NULL,
 source_published_at TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 summary TEXT NOT NULL,
 evidence_status TEXT NOT NULL CHECK(evidence_status IN ('unverified','reviewed','confirmed','rejected')),
 outcome_status TEXT NOT NULL DEFAULT 'pending' CHECK(outcome_status IN ('pending','observed','inconclusive','invalidated')),
 confidence REAL CHECK(confidence IS NULL OR (confidence>=0 AND confidence<=1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS research_memory_event_idx ON research_memory(event_key);
CREATE INDEX IF NOT EXISTS research_memory_skill_idx ON research_memory(skill,evidence_status);
CREATE TABLE IF NOT EXISTS research_outcomes (
 memory_id TEXT PRIMARY KEY REFERENCES research_memory(id),
 outcome_summary TEXT NOT NULL,
 outcome_source_url TEXT NOT NULL,
 assessed_at TEXT NOT NULL,
 assessment_method TEXT NOT NULL
);
