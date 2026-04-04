-- Phase 52: Integration depth tables
-- SOC2 CC6.1 — RLS enforced on all tenant-scoped tables
-- ISO 27001 A.8.2.3 — Handling of external data assets

-- ── integration_configs ──────────────────────────────────────────

CREATE TABLE integration_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('salesforce', 'hubspot')),
  status          TEXT NOT NULL DEFAULT 'disconnected'
                    CHECK (status IN ('connected','disconnected','error','rate_limited')),
  -- AES-256-GCM ciphertext — plaintext never stored (FieldEncryptor)
  access_token_enc    TEXT,
  refresh_token_enc   TEXT,
  -- Webhook secret encrypted independently — RESTRICTED credential, never stored plaintext
  webhook_secret_enc  TEXT,
  token_expires_at    TIMESTAMPTZ,
  scopes              TEXT[],
  instance_url        TEXT,
  settings            JSONB NOT NULL DEFAULT '{}',
  last_sync_at    TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

ALTER TABLE integration_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_configs_tenant_isolation ON integration_configs
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE INDEX idx_integration_configs_tenant ON integration_configs (tenant_id);
CREATE INDEX idx_integration_configs_status ON integration_configs (tenant_id, status);

-- ── sync_events (WORM) ───────────────────────────────────────────

CREATE TABLE sync_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id      UUID NOT NULL REFERENCES integration_configs(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('contact','deal','activity')),
  entity_id           UUID,
  external_id         TEXT,
  status              TEXT NOT NULL CHECK (status IN ('success','failed','conflict','skipped')),
  conflict_resolution TEXT CHECK (conflict_resolution IN ('crm_wins')),
  error_summary       TEXT,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY sync_events_tenant_isolation ON sync_events
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE INDEX idx_sync_events_tenant_provider ON sync_events (tenant_id, provider);
CREATE INDEX idx_sync_events_entity ON sync_events (entity_id);
CREATE INDEX idx_sync_events_synced_at ON sync_events (synced_at DESC);

CREATE OR REPLACE FUNCTION prevent_sync_events_mutation()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sync_events is append-only (WORM)';
END;
$$;
CREATE TRIGGER sync_events_no_update
  BEFORE UPDATE OR DELETE ON sync_events
  FOR EACH ROW EXECUTE FUNCTION prevent_sync_events_mutation();
CREATE TRIGGER sync_events_no_truncate
  BEFORE TRUNCATE ON sync_events
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_sync_events_mutation();

-- ── webhook_logs (mutable processing-state table) ────────────────

CREATE TABLE webhook_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  processed       BOOLEAN NOT NULL DEFAULT false,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_logs_tenant_isolation ON webhook_logs
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')::uuid);
CREATE INDEX idx_webhook_logs_tenant ON webhook_logs (tenant_id, received_at DESC);
CREATE INDEX idx_webhook_logs_unprocessed ON webhook_logs (processed, received_at)
  WHERE processed = false;

-- ── integration_field_mappings ───────────────────────────────────

CREATE TABLE integration_field_mappings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('salesforce', 'hubspot')),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('contact','deal','activity')),
  direction    TEXT NOT NULL CHECK (direction IN ('inbound','outbound','both')),
  source_field TEXT NOT NULL,
  target_field TEXT NOT NULL,
  transform    JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, entity_type, direction, source_field)
);

ALTER TABLE integration_field_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_field_mappings_tenant_isolation ON integration_field_mappings
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE INDEX idx_field_mappings_tenant_provider
  ON integration_field_mappings (tenant_id, provider, entity_type);

-- ── integration_entity_mappings ──────────────────────────────────

CREATE TABLE integration_entity_mappings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('salesforce', 'hubspot')),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('contact', 'deal', 'activity')),
  ordr_id      UUID NOT NULL,
  external_id  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, entity_type, external_id)
);

ALTER TABLE integration_entity_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY integration_entity_mappings_tenant_isolation ON integration_entity_mappings
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE INDEX idx_entity_mappings_lookup
  ON integration_entity_mappings (tenant_id, provider, entity_type, external_id);
CREATE INDEX idx_entity_mappings_ordr_id ON integration_entity_mappings (ordr_id);
