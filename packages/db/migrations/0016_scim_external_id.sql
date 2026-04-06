-- 0016_scim_external_id.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS scim_external_id TEXT,
  ADD COLUMN IF NOT EXISTS scim_source TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_scim_external_id_idx
  ON users (tenant_id, scim_external_id)
  WHERE scim_external_id IS NOT NULL;
