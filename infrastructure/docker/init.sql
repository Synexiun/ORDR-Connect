-- ORDR-Connect — PostgreSQL Initialization
-- Runs once on first container start via docker-entrypoint-initdb.d
-- SOC2/ISO27001/HIPAA: RLS + WORM enforcement primitives

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- WORM (Write-Once Read-Many) enforcement helper
-- Used by triggers to prevent UPDATE/DELETE on immutable rows
-- ============================================================
CREATE OR REPLACE FUNCTION raise_exception(msg TEXT)
RETURNS void AS $$
BEGIN
  RAISE EXCEPTION '%', msg;
END;
$$ LANGUAGE plpgsql STRICT IMMUTABLE;

-- ============================================================
-- Row-Level Security (RLS) tenant isolation
-- Every query must set app.current_tenant before accessing
-- tenant-scoped tables. This function is used in RLS policies.
-- ============================================================
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.current_tenant', true);
END;
$$ LANGUAGE plpgsql STABLE;

-- Set default tenant to empty string (no access until explicitly set)
ALTER DATABASE ordr_connect SET app.current_tenant = '';

-- ============================================================
-- Schema tables are created by Drizzle migrations, not here.
-- This file only bootstraps extensions, functions, and settings
-- required before migrations run.
-- ============================================================
