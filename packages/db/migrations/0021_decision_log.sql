-- 0021_decision_log.sql
--
-- Decision Engine: per-decision summary log table.
--
-- The existing decision_audit table (0001_initial_schema.sql) records per-layer
-- evaluation detail. This table captures one row per NBAPipeline.evaluate()
-- call — the final outcome, layer reached, latency, and compliance gate results.
-- The DecisionEngine UI queries this table for the Decision Log tab.
--
-- SOC2 CC6.1  — Tenant-scoped RLS.
-- SOC2 CC7.2  — Full decision chain audit trail.
-- ISO 27001 A.8.15 — Logging and monitoring.
-- HIPAA §164.312(b) — Audit controls: who decided what, when, at what confidence.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS decision_log (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NOT a foreign key — log records must outlive tenant lifecycle
  tenant_id        UUID         NOT NULL,

  -- Tokenized customer reference — NEVER raw PII/PHI
  customer_id      VARCHAR(255) NOT NULL,

  -- Logical decision category: 'nba' | 'compliance' | 'routing' | 'fraud'
  decision_type    VARCHAR(50)  NOT NULL,

  -- Final outcome: 'approved' | 'rejected' | 'escalated' | 'deferred'
  outcome          VARCHAR(20)  NOT NULL
                   CHECK (outcome IN ('approved', 'rejected', 'escalated', 'deferred')),

  -- Which layer terminated the pipeline
  layer_reached    VARCHAR(20)  NOT NULL
                   CHECK (layer_reached IN ('rules', 'ml_scorer', 'llm_reasoner')),

  -- Final action selected by the pipeline
  action_selected  VARCHAR(100) NOT NULL,

  -- Composite confidence (0.0–1.0)
  confidence       REAL         NOT NULL
                   CHECK (confidence >= 0.0 AND confidence <= 1.0),

  -- Total pipeline wall-clock duration
  latency_ms       INTEGER      NOT NULL CHECK (latency_ms >= 0),

  -- Compliance-safe reasoning summary (no PHI)
  reasoning        VARCHAR(1000) NOT NULL DEFAULT '',

  -- ID of the rule that fired (Layer 1 only); NULL for ML/LLM decisions
  rule_id          UUID,

  -- Actor who triggered the evaluation
  actor_id         VARCHAR(255) NOT NULL DEFAULT 'system',

  -- JSON array of compliance gate results: [{ruleId, regulation, passed}]
  compliance_gates JSONB        NOT NULL DEFAULT '[]',

  -- JSON array of decision_audit row IDs for deep-link
  audit_entry_ids  JSONB        NOT NULL DEFAULT '[]',

  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS decision_log_tenant_created_at_idx
  ON decision_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS decision_log_tenant_type_idx
  ON decision_log (tenant_id, decision_type);

CREATE INDEX IF NOT EXISTS decision_log_tenant_outcome_idx
  ON decision_log (tenant_id, outcome);

CREATE INDEX IF NOT EXISTS decision_log_customer_idx
  ON decision_log (customer_id);

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE decision_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY decision_log_tenant_isolation ON decision_log
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- ── WORM Enforcement ─────────────────────────────────────────────────────────
--
-- Decision log entries are immutable. UPDATE and DELETE are physically
-- blocked at the database level — no application bypass is possible.

CREATE OR REPLACE FUNCTION block_decision_log_mutations()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'decision_log is WORM — UPDATE and DELETE are forbidden. '
    'Violating event recorded. (SOC2 CC6.1, HIPAA §164.312(b))';
END;
$$;

CREATE TRIGGER decision_log_no_update
  BEFORE UPDATE ON decision_log
  FOR EACH ROW EXECUTE FUNCTION block_decision_log_mutations();

CREATE TRIGGER decision_log_no_delete
  BEFORE DELETE ON decision_log
  FOR EACH ROW EXECUTE FUNCTION block_decision_log_mutations();
