-- ============================================================================
-- ORDR-Connect — 0021_compliance_violations.sql
-- Operator-facing compliance violation records
--
-- SOC2 CC6.1  — RLS tenant isolation
-- SOC2 CC7.2  — Compliance monitoring and anomaly detection
-- ISO 27001 A.5.36 — Compliance with information security policies
-- HIPAA §164.308(a)(1) — Risk analysis and management documentation
--
-- WORM semantics (partial):
--   Core fields (rule_name, regulation, severity, description, customer_id,
--   detected_at, tenant_id) are IMMUTABLE after insert.
--   Resolution fields (resolved, resolved_at, resolved_by, resolution_note)
--   are MUTABLE — operators mark violations as addressed.
--   DELETE and TRUNCATE are fully blocked.
-- ============================================================================

CREATE TYPE violation_regulation AS ENUM (
  'HIPAA',
  'FDCPA',
  'TCPA',
  'GDPR',
  'SOC2',
  'ISO27001'
);

CREATE TYPE violation_severity AS ENUM (
  'critical',
  'high',
  'medium',
  'low'
);

CREATE TABLE compliance_violations (
  id              UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID                 NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  rule_name       VARCHAR(255)         NOT NULL,
  regulation      violation_regulation NOT NULL,
  severity        violation_severity   NOT NULL,
  description     TEXT                 NOT NULL,
  -- Nullable: system-level violations have no specific customer
  customer_id     UUID                 REFERENCES customers(id) ON DELETE SET NULL,
  detected_at     TIMESTAMPTZ          NOT NULL DEFAULT now(),
  -- ─── Resolution fields (mutable) ──────────────────────────────
  resolved        BOOLEAN              NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  resolved_by     VARCHAR(255),
  resolution_note TEXT,
  -- ─── Metadata ─────────────────────────────────────────────────
  created_at      TIMESTAMPTZ          NOT NULL DEFAULT now()
);

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX cv_tenant_idx        ON compliance_violations (tenant_id);
CREATE INDEX cv_tenant_detected   ON compliance_violations (tenant_id, detected_at DESC);
CREATE INDEX cv_tenant_regulation ON compliance_violations (tenant_id, regulation);
CREATE INDEX cv_tenant_resolved   ON compliance_violations (tenant_id, resolved);
CREATE INDEX cv_customer_idx      ON compliance_violations (customer_id)
  WHERE customer_id IS NOT NULL;

-- ─── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE compliance_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_violations FORCE ROW LEVEL SECURITY;

CREATE POLICY cv_tenant_isolation ON compliance_violations
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- ─── Partial WORM: core fields are immutable ─────────────────────────────────
-- Resolution fields (resolved, resolved_at, resolved_by, resolution_note)
-- remain mutable so operators can acknowledge violations.

CREATE OR REPLACE FUNCTION prevent_violation_core_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.rule_name    IS DISTINCT FROM NEW.rule_name    OR
     OLD.regulation   IS DISTINCT FROM NEW.regulation   OR
     OLD.severity     IS DISTINCT FROM NEW.severity     OR
     OLD.description  IS DISTINCT FROM NEW.description  OR
     OLD.customer_id  IS DISTINCT FROM NEW.customer_id  OR
     OLD.detected_at  IS DISTINCT FROM NEW.detected_at  OR
     OLD.tenant_id    IS DISTINCT FROM NEW.tenant_id    OR
     OLD.created_at   IS DISTINCT FROM NEW.created_at   THEN
    RAISE EXCEPTION
      'WORM violation: compliance_violations core fields are immutable (SOC2 CC7.2)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cv_core_immutable
  BEFORE UPDATE ON compliance_violations
  FOR EACH ROW EXECUTE FUNCTION prevent_violation_core_update();

-- Full WORM on DELETE and TRUNCATE (reuse shared function from 0002)
CREATE TRIGGER prevent_compliance_violations_delete
  BEFORE DELETE ON compliance_violations
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_compliance_violations_truncate
  BEFORE TRUNCATE ON compliance_violations
  EXECUTE FUNCTION prevent_audit_modification();

-- ─── Access control ──────────────────────────────────────────────────────────

REVOKE ALL ON compliance_violations FROM PUBLIC;
GRANT SELECT, INSERT ON compliance_violations TO ordr_app;
-- Resolution UPDATE granted column-by-column as belt-and-suspenders
GRANT UPDATE (resolved, resolved_at, resolved_by, resolution_note)
  ON compliance_violations TO ordr_app;
