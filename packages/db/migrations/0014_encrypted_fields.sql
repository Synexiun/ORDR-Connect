-- Phase 55: encrypted_fields — canonical DEK envelope store
-- Rule 1: AES-256-GCM two-tier key hierarchy; rotation ≤90 days

CREATE TABLE IF NOT EXISTS encrypted_fields (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  resource      TEXT NOT NULL,
  resource_id   UUID NOT NULL,
  field_name    TEXT NOT NULL,
  dek_envelope  JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_encrypted_fields_resource_field
    UNIQUE (tenant_id, resource, resource_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_encrypted_fields_tenant
  ON encrypted_fields(tenant_id);
