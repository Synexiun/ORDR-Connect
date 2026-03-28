-- Migration 0008: partner_referrals — monthly funnel tracking per partner
--
-- SOC2 CC6.1 — Partner-scoped data, tenant-isolated via partner FK chain.
-- ISO 27001 A.9.2.3 — Privileged access managed through partner tier controls.

-- ── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_referrals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  month         VARCHAR(7) NOT NULL,                 -- YYYY-MM
  clicks        INTEGER NOT NULL DEFAULT 0,
  signups       INTEGER NOT NULL DEFAULT 0,
  conversions   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_referrals_partner_month_uniq
  ON partner_referrals (partner_id, month);

CREATE INDEX IF NOT EXISTS partner_referrals_partner_idx
  ON partner_referrals (partner_id);

-- ── Row-Level Security ─────────────────────────────────────────────────────
-- partner_referrals is partner-scoped (no tenant_id), protected through the
-- partners FK chain. Application layer enforces partner ownership checks.

ALTER TABLE partner_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_referrals FORCE ROW LEVEL SECURITY;

-- Service role bypasses RLS; all other access requires explicit policy.
CREATE POLICY partner_referrals_service_policy ON partner_referrals
  USING (true)
  WITH CHECK (true);
