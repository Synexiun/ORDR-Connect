-- Phase 55: key_rotation_jobs — concurrency guard for DEK re-wrap
-- Rule 1: automated rotation tracking; Rule 3: WORM audit accompanies every run

CREATE TABLE IF NOT EXISTS key_rotation_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name          TEXT NOT NULL,
  old_version       INTEGER NOT NULL,
  new_version       INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'running',
  rows_total        INTEGER,
  rows_done         INTEGER NOT NULL DEFAULT 0,
  last_processed_id UUID,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);
