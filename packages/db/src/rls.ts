// ---------------------------------------------------------------------------
// @ordr/db — Row-Level Security policies & WORM triggers
//
// These SQL statements are exported as string arrays for execution during
// migration. They MUST be applied to enforce tenant isolation and audit
// log immutability at the database level.
//
// Usage in migration:
//   import { RLS_POLICIES, WORM_TRIGGERS } from '@ordr/db';
//   for (const stmt of [...RLS_POLICIES, ...WORM_TRIGGERS]) {
//     await db.execute(sql.raw(stmt));
//   }
// ---------------------------------------------------------------------------

/**
 * All tenant-scoped tables that require RLS.
 * audit_logs and merkle_roots use tenant_id but are NOT foreign-keyed;
 * they still need RLS for multi-tenant query isolation.
 */
const RLS_TABLES = [
  'users',
  'sessions',
  'api_keys',
  'customers',
  'interactions',
  'audit_logs',
  'merkle_roots',
  'agent_actions',
  'compliance_records',
  'contacts',
  'consent_records',
  'agent_sessions',
  'messages',
  'payment_records',
  'decision_rules',
  'decision_audit',
  'channel_preferences',
  'organizations',
  'sso_connections',
  'custom_roles',
  'user_custom_roles',
  'scim_tokens',
] as const;

/**
 * RLS policy SQL statements.
 *
 * Each table gets:
 *   1. ALTER TABLE ... ENABLE ROW LEVEL SECURITY
 *   2. ALTER TABLE ... FORCE ROW LEVEL SECURITY (applies even to table owners)
 *   3. CREATE POLICY for tenant isolation using current_setting('app.current_tenant')
 *
 * The GUC `app.current_tenant` is set per-transaction via setTenantContext().
 */
export const RLS_POLICIES: readonly string[] = RLS_TABLES.flatMap((table) => [
  // Enable RLS
  `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,

  // Force RLS even for table owner (prevents accidental bypass)
  `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`,

  // Tenant isolation policy — all CRUD operations
  `CREATE POLICY "${table}_tenant_isolation" ON "${table}"
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);`,
]);

/**
 * WORM (Write Once, Read Many) triggers for the audit_logs table.
 *
 * CRITICAL: These triggers prevent ANY update or delete on audit_logs,
 * enforcing immutability as required by SOC2/ISO27001.
 *
 * The raise_exception function must exist before the triggers are created.
 * We create it idempotently with CREATE OR REPLACE.
 */
export const WORM_TRIGGERS: readonly string[] = [
  // Helper function that raises an exception (used by triggers)
  `CREATE OR REPLACE FUNCTION raise_exception(msg text)
  RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION '%', msg;
    RETURN NULL;
  END;
  $$ LANGUAGE plpgsql;`,

  // Prevent UPDATE on audit_logs
  `CREATE TRIGGER prevent_audit_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION raise_exception('Audit logs are immutable');`,

  // Prevent DELETE on audit_logs
  `CREATE TRIGGER prevent_audit_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION raise_exception('Audit logs are immutable');`,

  // Prevent TRUNCATE on audit_logs
  `CREATE TRIGGER prevent_audit_truncate
  BEFORE TRUNCATE ON audit_logs
  EXECUTE FUNCTION raise_exception('Audit logs are immutable');`,

  // -- consent_records WORM triggers --

  // Prevent UPDATE on consent_records
  `CREATE TRIGGER prevent_consent_record_update
  BEFORE UPDATE ON consent_records
  FOR EACH ROW
  EXECUTE FUNCTION raise_exception('Consent records are immutable');`,

  // Prevent DELETE on consent_records
  `CREATE TRIGGER prevent_consent_record_delete
  BEFORE DELETE ON consent_records
  FOR EACH ROW
  EXECUTE FUNCTION raise_exception('Consent records are immutable');`,

  // Prevent TRUNCATE on consent_records
  `CREATE TRIGGER prevent_consent_record_truncate
  BEFORE TRUNCATE ON consent_records
  EXECUTE FUNCTION raise_exception('Consent records are immutable');`,

  // -- decision_audit WORM triggers --

  // Prevent UPDATE on decision_audit
  `CREATE TRIGGER prevent_decision_audit_update
  BEFORE UPDATE ON decision_audit
  FOR EACH ROW
  EXECUTE FUNCTION raise_exception('Decision audit records are immutable');`,

  // Prevent DELETE on decision_audit
  `CREATE TRIGGER prevent_decision_audit_delete
  BEFORE DELETE ON decision_audit
  FOR EACH ROW
  EXECUTE FUNCTION raise_exception('Decision audit records are immutable');`,

  // Prevent TRUNCATE on decision_audit
  `CREATE TRIGGER prevent_decision_audit_truncate
  BEFORE TRUNCATE ON decision_audit
  EXECUTE FUNCTION raise_exception('Decision audit records are immutable');`,
];
