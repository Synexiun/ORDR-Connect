-- ============================================================================
-- ORDR-Connect — 0025_sla_policies.sql
-- Per-tenant SLA policy configuration
--
-- SOC2 CC7.2  — Monitoring: configurable SLA breach thresholds per tenant
-- ISO 27001 A.16.1.1 — Responsibilities for information security events
-- HIPAA §164.308(a)(5)(ii)(C) — Log-in monitoring: unanswered contact SLAs
--
-- SLA policy resolution order (most-specific wins):
--   1. channel + priority_tier (both non-null)
--   2. channel only (priority_tier IS NULL)
--   3. priority_tier only (channel IS NULL)
--   4. Global default (both NULL) — applied when no specific policy matches
--
-- Mutable by design: operators adjust thresholds as business needs change.
-- All changes are WORM-logged through the audit system (sla.policy_updated).
-- ============================================================================

CREATE TABLE sla_policies (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- NULL = matches any channel; one of 'sms', 'email', 'voice', 'whatsapp',
  -- 'chat', 'push', 'in_app' when specific.
  channel           VARCHAR(50),

  -- NULL = matches any priority tier; one of 'vip', 'high', 'standard', 'low'
  -- when specific. Priority tier is derived from the customer record at breach time.
  priority_tier     VARCHAR(50),

  -- Breach threshold in minutes. Valid range: 1 minute to 10,080 minutes (7 days).
  threshold_minutes INTEGER      NOT NULL CHECK (threshold_minutes BETWEEN 1 AND 10080),

  enabled           BOOLEAN      NOT NULL DEFAULT true,

  created_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by        UUID         REFERENCES users(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- One policy per channel × priority_tier combination per tenant
  CONSTRAINT sla_policies_unique_scope
    UNIQUE NULLS NOT DISTINCT (tenant_id, channel, priority_tier)
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX sla_policies_tenant_idx
  ON sla_policies (tenant_id);

CREATE INDEX sla_policies_tenant_enabled_idx
  ON sla_policies (tenant_id, enabled)
  WHERE enabled = true;

-- ─── updated_at auto-stamp ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_sla_policies_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sla_policies_updated_at
  BEFORE UPDATE ON sla_policies
  FOR EACH ROW EXECUTE FUNCTION update_sla_policies_timestamp();

-- ─── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY sla_policies_tenant_isolation ON sla_policies
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- ─── Access control ──────────────────────────────────────────────────────────

REVOKE ALL ON sla_policies FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON sla_policies TO ordr_app;
