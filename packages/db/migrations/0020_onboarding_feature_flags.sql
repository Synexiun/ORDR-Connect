-- 0020_onboarding_feature_flags.sql
--
-- Phase 57: Per-tenant onboarding state + runtime feature flags
--
-- SOC2 CC6.1  — Access control: tenant-scoped RLS on feature_flags.
-- ISO 27001 A.14.2.5 — Feature gating for controlled rollout.

-- ── Onboarding state on tenants ───────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS onboarding_complete  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step      SMALLINT    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- ── Feature flags ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feature_flags (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    TEXT         NOT NULL,
  flag_name    VARCHAR(100) NOT NULL,
  enabled      BOOLEAN      NOT NULL DEFAULT false,
  rollout_pct  SMALLINT     NOT NULL DEFAULT 100
               CHECK (rollout_pct BETWEEN 0 AND 100),
  description  TEXT,
  metadata     JSONB        NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, flag_name)
);

CREATE INDEX IF NOT EXISTS feature_flags_tenant_enabled_idx
  ON feature_flags (tenant_id, enabled);

-- RLS — each tenant sees only its own flags
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY feature_flags_tenant_isolation ON feature_flags
  USING (tenant_id = current_setting('app.current_tenant', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true));

REVOKE ALL ON feature_flags FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flags TO ordr_api_role;
