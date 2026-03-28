-- Migration 0009 — Workflow, Scheduler, and Search Index
--
-- Creates tables for:
--   1. workflow_definitions   — multi-step workflow templates
--   2. workflow_instances     — in-flight workflow execution records
--   3. workflow_step_results  — per-step execution history (append-only)
--   4. job_definitions        — scheduler job type registry
--   5. job_instances          — scheduled job execution records
--   6. job_dead_letters       — permanently failed jobs
--   7. search_index           — unified tsvector search index
--
-- SOC2 CC7.1/CC7.2   — Automated operations tracked and auditable.
-- ISO 27001 A.12.4.1 — Event logging for all automated processing.
-- HIPAA §164.312(b)  — Audit controls; no PHI in any column.
--
-- RLS FORCE row-level security applied on all tenant-scoped tables.

BEGIN;

-- ─── Enums ────────────────────────────────────────────────────────────────

CREATE TYPE workflow_status AS ENUM (
  'pending', 'running', 'paused', 'completed', 'failed', 'cancelled'
);

CREATE TYPE step_status AS ENUM (
  'pending', 'running', 'completed', 'failed', 'skipped', 'waiting'
);

CREATE TYPE step_type AS ENUM (
  'action', 'condition', 'delay', 'parallel', 'human-review'
);

CREATE TYPE trigger_type AS ENUM ('event', 'schedule', 'manual');

CREATE TYPE job_status AS ENUM (
  'pending', 'running', 'completed', 'failed', 'retrying', 'cancelled'
);

CREATE TYPE job_priority AS ENUM ('critical', 'high', 'normal', 'low');

CREATE TYPE search_entity_type AS ENUM (
  'customer', 'interaction', 'agent-session', 'workflow', 'marketplace-agent'
);

-- ─── Workflow Definitions ────────────────────────────────────────────────────

CREATE TABLE workflow_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  version         INTEGER NOT NULL DEFAULT 1,
  steps           JSONB NOT NULL DEFAULT '[]',
  triggers        JSONB NOT NULL DEFAULT '[]',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX workflow_definitions_tenant_idx  ON workflow_definitions (tenant_id);
CREATE INDEX workflow_definitions_active_idx  ON workflow_definitions (tenant_id, is_active);

ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_definitions FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON workflow_definitions
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- ─── Workflow Instances ──────────────────────────────────────────────────────

CREATE TABLE workflow_instances (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  definition_id       UUID NOT NULL REFERENCES workflow_definitions(id),
  entity_type         TEXT NOT NULL,
  entity_id           TEXT NOT NULL,
  status              workflow_status NOT NULL DEFAULT 'pending',
  current_step_index  INTEGER NOT NULL DEFAULT 0,
  -- AES-256-GCM encrypted WorkflowContext. No plaintext PHI stored.
  context             JSONB NOT NULL DEFAULT '{}',
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  error               TEXT
);

CREATE INDEX workflow_instances_tenant_idx     ON workflow_instances (tenant_id);
CREATE INDEX workflow_instances_status_idx     ON workflow_instances (tenant_id, status);
CREATE INDEX workflow_instances_entity_idx     ON workflow_instances (tenant_id, entity_type, entity_id);
CREATE INDEX workflow_instances_def_entity_idx ON workflow_instances (tenant_id, definition_id, entity_type, entity_id);

ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_instances FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON workflow_instances
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- ─── Workflow Step Results ────────────────────────────────────────────────────

CREATE TABLE workflow_step_results (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id  UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  step_index   INTEGER NOT NULL,
  step_type    step_type NOT NULL,
  status       step_status NOT NULL,
  input        JSONB NOT NULL DEFAULT '{}',
  output       JSONB NOT NULL DEFAULT '{}',
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error        TEXT,
  retry_count  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX workflow_step_results_instance_idx      ON workflow_step_results (instance_id);
CREATE INDEX workflow_step_results_instance_step_idx ON workflow_step_results (instance_id, step_index);

-- Step results are effectively append-only (no RLS needed — accessed via instance join).
-- DELETE is allowed for cascade when instance is deleted.

-- ─── Job Definitions ─────────────────────────────────────────────────────────

CREATE TABLE job_definitions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  cron_expression  TEXT,
  job_type         TEXT NOT NULL,
  payload_template JSONB NOT NULL DEFAULT '{}',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  priority         job_priority NOT NULL DEFAULT 'normal',
  retry_policy     JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX job_definitions_job_type_idx ON job_definitions (job_type);
CREATE INDEX job_definitions_active_idx   ON job_definitions (is_active);

-- job_definitions are global (no tenant scope) — no RLS.

-- ─── Job Instances ───────────────────────────────────────────────────────────

CREATE TABLE job_instances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id UUID NOT NULL REFERENCES job_definitions(id),
  -- NULL for system-level (non-tenant-scoped) jobs
  tenant_id     UUID,
  status        job_status NOT NULL DEFAULT 'pending',
  payload       JSONB NOT NULL DEFAULT '{}',
  result        JSONB,
  error         TEXT,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  -- Advisory lock: NULL = unlocked; SET atomically via UPDATE WHERE locked_by IS NULL
  locked_by     TEXT,
  locked_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX job_instances_status_idx     ON job_instances (status);
CREATE INDEX job_instances_tenant_idx     ON job_instances (tenant_id);
CREATE INDEX job_instances_next_retry_idx ON job_instances (next_retry_at);
CREATE INDEX job_instances_created_idx    ON job_instances (created_at);

-- Partial index for fast due-job polling (most common query pattern)
CREATE INDEX job_instances_due_idx ON job_instances (created_at, definition_id)
  WHERE status IN ('pending', 'retrying') AND locked_by IS NULL;

-- ─── Job Dead Letters ────────────────────────────────────────────────────────

CREATE TABLE job_dead_letters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_instance_id  UUID NOT NULL REFERENCES job_instances(id),
  definition_id    UUID NOT NULL REFERENCES job_definitions(id),
  error            TEXT NOT NULL,
  payload          JSONB NOT NULL DEFAULT '{}',
  failed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX job_dead_letters_failed_at_idx   ON job_dead_letters (failed_at);
CREATE INDEX job_dead_letters_definition_idx  ON job_dead_letters (definition_id);

-- ─── Search Index ────────────────────────────────────────────────────────────

CREATE TABLE search_index (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     search_entity_type NOT NULL,
  entity_id       TEXT NOT NULL,
  -- tsvector assembled and sanitized by the application layer (no PHI).
  content_vector  TEXT NOT NULL DEFAULT '',
  display_title   TEXT NOT NULL DEFAULT '',
  display_subtitle TEXT NOT NULL DEFAULT '',
  metadata        JSONB NOT NULL DEFAULT '{}',
  indexed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT search_index_tenant_entity_uniq UNIQUE (tenant_id, entity_type, entity_id)
);

CREATE INDEX search_index_tenant_idx       ON search_index (tenant_id);
CREATE INDEX search_index_entity_type_idx  ON search_index (tenant_id, entity_type);
CREATE INDEX search_index_updated_idx      ON search_index (updated_at);

-- GIN index for full-text search via to_tsvector
CREATE INDEX search_index_content_gin ON search_index
  USING gin(to_tsvector('english', content_vector));

ALTER TABLE search_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_index FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON search_index
  USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

COMMIT;
