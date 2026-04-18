-- 0026_user_org_memberships.sql
-- User <-> Organization membership (many-to-many within a tenant).
-- Backs OrgStore.getUsersByOrg / listOrgsForUser / addUserToOrg / removeUserFromOrg.
--
-- SOC 2 CC6.1 / CC6.3 — org-scoped access control with tenant isolation.
-- ISO 27001 A.5.2 / A.5.15 — information security roles and access rights.
-- HIPAA §164.312(a)(1) — access enforced at the organizational-unit boundary.

CREATE TABLE IF NOT EXISTS user_organization_memberships (
  tenant_id  UUID NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,
  org_id     UUID NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by   TEXT NOT NULL DEFAULT 'system',
  PRIMARY KEY (tenant_id, org_id, user_id)
);

-- Fast "what orgs is this user in?" lookup
CREATE INDEX IF NOT EXISTS user_org_memberships_user_idx
  ON user_organization_memberships (tenant_id, user_id);

-- Fast "who is in this org?" lookup (already covered by PK prefix, but explicit
-- makes intent clear and helps when tenant_id is constant in the plan).
CREATE INDEX IF NOT EXISTS user_org_memberships_org_idx
  ON user_organization_memberships (tenant_id, org_id);

-- RLS — same pattern as the other tenant-scoped tables
ALTER TABLE user_organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_organization_memberships FORCE  ROW LEVEL SECURITY;

CREATE POLICY user_org_memberships_tenant_isolation
  ON user_organization_memberships
  FOR ALL
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
