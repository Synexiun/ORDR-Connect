-- ============================================================================
-- ORDR-Connect — 0005_notifications.sql
-- In-app notification center for HITL approvals, compliance, escalations, SLA
--
-- SOC2 CC7.2   — Monitoring: security event alerting.
-- ISO 27001 A.16.1.2 — Reporting information security events.
-- HIPAA §164.312(b) — Audit controls: no PHI in notification content.
-- ============================================================================

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE notification_type AS ENUM (
  'hitl',
  'compliance',
  'escalation',
  'sla',
  'system'
);

CREATE TYPE notification_severity AS ENUM (
  'critical',
  'high',
  'medium',
  'low'
);

-- ============================================================================
-- TABLE
-- ============================================================================

CREATE TABLE notifications (
  id            UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID                   NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       UUID                   REFERENCES users(id) ON DELETE SET NULL,
  type          notification_type      NOT NULL,
  severity      notification_severity  NOT NULL DEFAULT 'low',
  title         TEXT                   NOT NULL,
  description   TEXT                   NOT NULL,
  read          BOOLEAN                NOT NULL DEFAULT false,
  dismissed     BOOLEAN                NOT NULL DEFAULT false,
  action_label  VARCHAR(100),
  action_route  VARCHAR(500),
  metadata      JSONB                  NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ            NOT NULL DEFAULT now(),
  read_at       TIMESTAMPTZ,
  dismissed_at  TIMESTAMPTZ
);

CREATE INDEX notifications_tenant_read_idx    ON notifications (tenant_id, read);
CREATE INDEX notifications_tenant_created_idx ON notifications (tenant_id, created_at DESC);
CREATE INDEX notifications_tenant_type_idx    ON notifications (tenant_id, type);

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_tenant_isolation ON notifications
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
