-- 0019_workos_events.sql
CREATE TABLE IF NOT EXISTS workos_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workos_id    TEXT NOT NULL UNIQUE,
  event_type   TEXT NOT NULL,
  directory_id TEXT,
  payload      JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON workos_events FROM PUBLIC;
GRANT INSERT, SELECT ON workos_events TO ordr_api_role;

-- WORM: block UPDATE
CREATE OR REPLACE FUNCTION block_workos_events_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workos_events rows are immutable (WORM)';
END;
$$;
CREATE TRIGGER workos_events_no_update
  BEFORE UPDATE ON workos_events
  FOR EACH ROW EXECUTE FUNCTION block_workos_events_update();

-- WORM: block DELETE
CREATE OR REPLACE FUNCTION block_workos_events_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workos_events rows are immutable (WORM)';
END;
$$;
CREATE TRIGGER workos_events_no_delete
  BEFORE DELETE ON workos_events
  FOR EACH ROW EXECUTE FUNCTION block_workos_events_delete();
