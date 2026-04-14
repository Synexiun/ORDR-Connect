-- Migration: sessions — add token_family, role, permissions
--
-- Rationale:
--   token_family enables family-based refresh token revocation (anti session-fixation).
--   role + permissions are stored at session creation time so SessionManager.refreshSession()
--   can re-issue access tokens without a JOIN to the users table (prevents TOCTOU race).
--
-- SOC2 CC6.1 — Session integrity and revocation.
-- ISO 27001 A.9.4.2 — Secure log-on: token rotation with reuse detection.
-- HIPAA §164.312(a)(2)(iii) — Automatic logoff and session lifecycle control.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_family UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'agent';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS sessions_token_family_idx ON sessions (token_family);
