-- Isolated D1 metadata only; do not store Google or YouTube secrets.
CREATE TABLE IF NOT EXISTS story_jobs(
 id TEXT PRIMARY KEY,
 due_utc TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','claimed','rendered','needs_review','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 lease_id TEXT,
 lease_until INTEGER,
 duration_seconds REAL,
 result_sha256 TEXT,
 created_at TEXT NOT NULL DEFAULT(datetime('now')),
 updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS story_jobs_due ON story_jobs(state,due_utc);
