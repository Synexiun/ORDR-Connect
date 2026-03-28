-- ============================================================================
-- ORDR-Connect — 0006_developer_portal.sql
-- Developer portal: password auth, named API keys, named sandboxes
--
-- SOC2 CC6.1   — Access control: developer-scoped authentication.
-- ISO 27001 A.9.4.2 — Secure log-on procedures.
-- HIPAA §164.312(d) — Entity authentication via hashed credentials.
-- ============================================================================

-- ============================================================================
-- 1. Add password_hash to developer_accounts
--    Empty string default is safe — application always sets it on register.
-- ============================================================================

ALTER TABLE developer_accounts
  ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';

-- ============================================================================
-- 2. Add name to sandbox_tenants
-- ============================================================================

ALTER TABLE sandbox_tenants
  ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';

-- ============================================================================
-- 3. Create developer_api_keys table
--    Named, revocable keys per developer — replaces single-key model.
--    key_hash stores SHA-256 of raw key (Rule 2 — NEVER store raw keys).
-- ============================================================================

CREATE TABLE IF NOT EXISTS developer_api_keys (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id   UUID        NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  key_hash       TEXT        NOT NULL,
  key_prefix     VARCHAR(8)  NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS developer_api_keys_developer_id_idx
  ON developer_api_keys(developer_id);

CREATE INDEX IF NOT EXISTS developer_api_keys_key_prefix_idx
  ON developer_api_keys(key_prefix);

-- ============================================================================
-- 4. Row-Level Security on developer_api_keys
--    Developer portal uses 'developer-portal' as tenant context.
--    Application-layer filtering (developer_id = ctx.userId) is the primary
--    isolation control; RLS FORCE ensures no bypass.
-- ============================================================================

ALTER TABLE developer_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_api_keys FORCE ROW LEVEL SECURITY;

-- Allow superuser / migration runner to bypass
CREATE POLICY developer_api_keys_superuser
  ON developer_api_keys
  TO postgres
  USING (true)
  WITH CHECK (true);
