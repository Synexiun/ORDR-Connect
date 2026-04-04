-- Phase 51: GDPR Data Subject Request tables
-- SOC2 CC6.1 — RLS enforced on both tables
-- GDPR Art. 12, 15, 17, 20 — full DSR lifecycle storage

CREATE TABLE data_subject_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  type            TEXT NOT NULL CHECK (type IN ('access', 'erasure', 'portability')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','processing','completed','rejected','cancelled','failed')),
  requested_by    TEXT NOT NULL,
  reason          TEXT,
  deadline_at     TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY dsr_tenant_isolation ON data_subject_requests
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

CREATE INDEX idx_dsr_tenant_status ON data_subject_requests (tenant_id, status);
CREATE INDEX idx_dsr_deadline       ON data_subject_requests (deadline_at)
  WHERE status NOT IN ('completed','rejected','cancelled');
CREATE INDEX idx_dsr_customer       ON data_subject_requests (customer_id);

-- ────────────────────────────────────────────────────────────────────

CREATE TABLE dsr_exports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dsr_id           UUID NOT NULL REFERENCES data_subject_requests(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  s3_key           TEXT NOT NULL,
  s3_bucket        TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  file_size_bytes  BIGINT,
  checksum_sha256  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dsr_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY dsr_exports_tenant_isolation ON dsr_exports
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

CREATE INDEX idx_dsr_exports_dsr_id ON dsr_exports (dsr_id);
