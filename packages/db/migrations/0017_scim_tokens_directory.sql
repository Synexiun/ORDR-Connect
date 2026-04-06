-- 0017_scim_tokens_directory.sql
ALTER TABLE scim_tokens
  ADD COLUMN IF NOT EXISTS directory_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS scim_tokens_directory_id_idx
  ON scim_tokens (directory_id)
  WHERE directory_id IS NOT NULL;
