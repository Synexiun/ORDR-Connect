-- 0018_groups_and_members.sql
CREATE TABLE IF NOT EXISTS groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  scim_external_id TEXT,
  scim_source TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS groups_scim_external_id_idx
  ON groups (tenant_id, scim_external_id)
  WHERE scim_external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS group_members (
  group_id  UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by  TEXT NOT NULL DEFAULT 'scim',
  PRIMARY KEY (group_id, user_id)
);

-- RLS on groups (tenant-scoped)
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;
CREATE POLICY groups_tenant_isolation ON groups
  FOR ALL
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- RLS on group_members (no tenant_id column — subquery through groups)
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members FORCE ROW LEVEL SECURITY;
CREATE POLICY group_members_tenant_isolation ON group_members
  FOR ALL
  USING (
    group_id IN (
      SELECT id FROM groups
      WHERE tenant_id = current_setting('app.current_tenant')::uuid
    )
  )
  WITH CHECK (
    group_id IN (
      SELECT id FROM groups
      WHERE tenant_id = current_setting('app.current_tenant')::uuid
    )
  );
