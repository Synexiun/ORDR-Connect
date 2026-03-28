-- ============================================================================
-- ORDR-Connect — 0007_tickets_reports.sql
-- Support ticket system + report generation and scheduling
--
-- SOC2 CC9.1   — Vendor/customer issue tracking to resolution.
-- ISO 27001 A.16 — Information security incident management.
-- HIPAA §164.308(a)(6) — Security incident response procedures.
-- SOC2 PI1.4   — Processing integrity: audit trail for generated reports.
-- ISO 27001 A.18.1 — Compliance with legal and contractual requirements.
-- ============================================================================

-- ============================================================================
-- ENUMS — Tickets
-- ============================================================================

CREATE TYPE ticket_status AS ENUM (
  'open',
  'in-progress',
  'waiting',
  'resolved',
  'closed'
);

CREATE TYPE ticket_priority AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

CREATE TYPE ticket_category AS ENUM (
  'bug',
  'feature',
  'question',
  'compliance',
  'billing'
);

CREATE TYPE ticket_message_author_role AS ENUM (
  'user',
  'admin',
  'system'
);

-- ============================================================================
-- TABLES — Tickets
-- ============================================================================

CREATE TABLE tickets (
  id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID                    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title           TEXT                    NOT NULL,
  status          ticket_status           NOT NULL DEFAULT 'open',
  priority        ticket_priority         NOT NULL DEFAULT 'medium',
  category        ticket_category         NOT NULL,
  -- Display name of assigned agent (null = unassigned)
  assignee_name   TEXT,
  -- Display name captured at creation time
  reporter_name   TEXT                    NOT NULL,
  -- No PHI in description — operational/technical content only
  description     TEXT                    NOT NULL,
  -- Denormalized count kept in sync with ticket_messages
  message_count   INTEGER                 NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX tickets_tenant_status_idx  ON tickets (tenant_id, status);
CREATE INDEX tickets_tenant_created_idx ON tickets (tenant_id, created_at DESC);

CREATE TABLE ticket_messages (
  id          UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID                          NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tenant_id   UUID                          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author_name TEXT                          NOT NULL,
  author_role ticket_message_author_role    NOT NULL DEFAULT 'user',
  -- No PHI in content — operational/technical content only
  content     TEXT                          NOT NULL,
  created_at  TIMESTAMPTZ                   NOT NULL DEFAULT now()
);

CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id);

-- ============================================================================
-- ROW-LEVEL SECURITY — Tickets
-- ============================================================================

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;
CREATE POLICY tickets_tenant_isolation ON tickets
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY ticket_messages_tenant_isolation ON ticket_messages
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ============================================================================
-- ENUMS — Reports
-- ============================================================================

CREATE TYPE report_type AS ENUM (
  'operations',
  'agent-performance',
  'compliance-audit',
  'channel-analytics',
  'customer-health',
  'revenue',
  'hipaa',
  'sla'
);

CREATE TYPE report_status AS ENUM (
  'completed',
  'generating',
  'failed'
);

CREATE TYPE schedule_frequency AS ENUM (
  'daily',
  'weekly',
  'monthly',
  'quarterly'
);

CREATE TYPE schedule_status AS ENUM (
  'active',
  'paused'
);

-- ============================================================================
-- TABLES — Reports
-- ============================================================================

CREATE TABLE generated_reports (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type              report_type     NOT NULL,
  name              TEXT            NOT NULL,
  -- Email or identifier of requesting user — NOT PHI
  generated_by      TEXT            NOT NULL,
  time_range_start  TIMESTAMPTZ     NOT NULL,
  time_range_end    TIMESTAMPTZ     NOT NULL,
  status            report_status   NOT NULL DEFAULT 'generating',
  row_count         INTEGER         NOT NULL DEFAULT 0,
  size_bytes        INTEGER         NOT NULL DEFAULT 0,
  -- Aggregate non-PHI ReportData snapshot; null while generating
  report_data       JSONB,
  generated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX generated_reports_tenant_idx ON generated_reports (tenant_id, generated_at DESC);

CREATE TABLE report_schedules (
  id          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID                NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT                NOT NULL,
  type        report_type         NOT NULL,
  frequency   schedule_frequency  NOT NULL,
  -- Array of recipient email addresses
  recipients  JSONB               NOT NULL DEFAULT '[]',
  status      schedule_status     NOT NULL DEFAULT 'active',
  next_run    TIMESTAMPTZ         NOT NULL,
  last_run    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX report_schedules_tenant_idx ON report_schedules (tenant_id);

-- ============================================================================
-- ROW-LEVEL SECURITY — Reports
-- ============================================================================

ALTER TABLE generated_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY generated_reports_tenant_isolation ON generated_reports
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY report_schedules_tenant_isolation ON report_schedules
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
