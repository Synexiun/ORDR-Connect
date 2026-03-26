-- ============================================================================
-- ORDR-Connect — 0002_audit_worm_triggers.sql
-- WORM (Write Once, Read Many) triggers for immutable audit tables
--
-- CRITICAL: These triggers enforce data immutability at the database level.
-- SOC 2 Type II CC7.2 | ISO 27001 A.8.10 | HIPAA §164.312(b)
--
-- Tables protected:
--   - audit_logs: Hash-chained audit events
--   - merkle_roots: Batch verification roots
--   - consent_records: Legal consent evidence
--   - decision_audit: Agent decision reasoning
--
-- ENFORCEMENT: Any UPDATE, DELETE, or TRUNCATE on these tables will raise
-- an exception and the transaction will be rolled back.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shared exception-raising function (idempotent)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'WORM violation: % on table % is forbidden — audit records are immutable (SOC2/HIPAA)',
    TG_OP, TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- audit_logs — WORM triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER prevent_audit_logs_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_audit_logs_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_audit_logs_truncate
  BEFORE TRUNCATE ON audit_logs
  EXECUTE FUNCTION prevent_audit_modification();

-- ---------------------------------------------------------------------------
-- merkle_roots — WORM triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER prevent_merkle_roots_update
  BEFORE UPDATE ON merkle_roots
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_merkle_roots_delete
  BEFORE DELETE ON merkle_roots
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_merkle_roots_truncate
  BEFORE TRUNCATE ON merkle_roots
  EXECUTE FUNCTION prevent_audit_modification();

-- ---------------------------------------------------------------------------
-- consent_records — WORM triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER prevent_consent_records_update
  BEFORE UPDATE ON consent_records
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_consent_records_delete
  BEFORE DELETE ON consent_records
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_consent_records_truncate
  BEFORE TRUNCATE ON consent_records
  EXECUTE FUNCTION prevent_audit_modification();

-- ---------------------------------------------------------------------------
-- decision_audit — WORM triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER prevent_decision_audit_update
  BEFORE UPDATE ON decision_audit
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_decision_audit_delete
  BEFORE DELETE ON decision_audit
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_modification();

CREATE TRIGGER prevent_decision_audit_truncate
  BEFORE TRUNCATE ON decision_audit
  EXECUTE FUNCTION prevent_audit_modification();
