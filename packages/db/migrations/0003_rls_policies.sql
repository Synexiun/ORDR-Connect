-- ============================================================================
-- ORDR-Connect — 0003_rls_policies.sql
-- Row-Level Security policies for multi-tenant isolation
--
-- SOC 2 Type II CC6.1 | ISO 27001 A.9.4.1 | HIPAA §164.312(a)(1)
--
-- MECHANISM:
--   Every tenant-scoped query sets the GUC `app.current_tenant` via:
--     SELECT set_config('app.current_tenant', '<uuid>', true);
--   RLS policies filter rows by matching tenant_id to this GUC.
--
-- FORCE: RLS is forced even for table owners (prevents accidental bypass).
-- MIGRATION ROLE: Create a dedicated migration role that bypasses RLS:
--     ALTER ROLE ordr_migrator BYPASSRLS;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_tenant_isolation ON users
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_tenant_isolation ON sessions
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- api_keys
-- ---------------------------------------------------------------------------
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY api_keys_tenant_isolation ON api_keys
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY customers_tenant_isolation ON customers
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- interactions
-- ---------------------------------------------------------------------------
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions FORCE ROW LEVEL SECURITY;
CREATE POLICY interactions_tenant_isolation ON interactions
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_tenant_isolation ON audit_logs
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- merkle_roots
-- ---------------------------------------------------------------------------
ALTER TABLE merkle_roots ENABLE ROW LEVEL SECURITY;
ALTER TABLE merkle_roots FORCE ROW LEVEL SECURITY;
CREATE POLICY merkle_roots_tenant_isolation ON merkle_roots
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- agent_actions
-- ---------------------------------------------------------------------------
ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_actions_tenant_isolation ON agent_actions
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- compliance_records
-- ---------------------------------------------------------------------------
ALTER TABLE compliance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_records FORCE ROW LEVEL SECURITY;
CREATE POLICY compliance_records_tenant_isolation ON compliance_records
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY contacts_tenant_isolation ON contacts
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- consent_records
-- ---------------------------------------------------------------------------
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_records_tenant_isolation ON consent_records
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- agent_sessions
-- ---------------------------------------------------------------------------
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_sessions_tenant_isolation ON agent_sessions
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY messages_tenant_isolation ON messages
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- payment_records
-- ---------------------------------------------------------------------------
ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_records FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_records_tenant_isolation ON payment_records
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- decision_rules
-- ---------------------------------------------------------------------------
ALTER TABLE decision_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_rules_tenant_isolation ON decision_rules
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- decision_audit
-- ---------------------------------------------------------------------------
ALTER TABLE decision_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY decision_audit_tenant_isolation ON decision_audit
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- channel_preferences
-- ---------------------------------------------------------------------------
ALTER TABLE channel_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_preferences_tenant_isolation ON channel_preferences
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_tenant_isolation ON organizations
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- sso_connections
-- ---------------------------------------------------------------------------
ALTER TABLE sso_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY sso_connections_tenant_isolation ON sso_connections
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- custom_roles
-- ---------------------------------------------------------------------------
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY custom_roles_tenant_isolation ON custom_roles
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- user_custom_roles
-- ---------------------------------------------------------------------------
ALTER TABLE user_custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_custom_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY user_custom_roles_tenant_isolation ON user_custom_roles
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- scim_tokens
-- ---------------------------------------------------------------------------
ALTER TABLE scim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE scim_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY scim_tokens_tenant_isolation ON scim_tokens
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- marketplace_installs (tenant-scoped)
-- ---------------------------------------------------------------------------
ALTER TABLE marketplace_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_installs FORCE ROW LEVEL SECURITY;
CREATE POLICY marketplace_installs_tenant_isolation ON marketplace_installs
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- agent_memories
-- ---------------------------------------------------------------------------
ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memories FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_memories_tenant_isolation ON agent_memories
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- ---------------------------------------------------------------------------
-- sentiment_history
-- ---------------------------------------------------------------------------
ALTER TABLE sentiment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentiment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY sentiment_history_tenant_isolation ON sentiment_history
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
