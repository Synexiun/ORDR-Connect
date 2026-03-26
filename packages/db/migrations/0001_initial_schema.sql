-- ============================================================================
-- ORDR-Connect — 0001_initial_schema.sql
-- Initial database schema: all tables, enums, indexes, constraints
-- SOC2 Type II | ISO 27001:2022 | HIPAA compliant
--
-- IMPORTANT: This migration creates the full schema from scratch.
-- All subsequent migrations are incremental.
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE plan AS ENUM ('free', 'starter', 'professional', 'enterprise');
CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'deactivated');
CREATE TYPE isolation_tier AS ENUM ('shared', 'schema', 'dedicated');
CREATE TYPE user_role AS ENUM ('super_admin', 'tenant_admin', 'manager', 'agent', 'viewer');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deactivated');
CREATE TYPE actor_type AS ENUM ('user', 'agent', 'system');
CREATE TYPE customer_type AS ENUM ('individual', 'company');
CREATE TYPE customer_status AS ENUM ('active', 'inactive', 'churned');
CREATE TYPE lifecycle_stage AS ENUM ('lead', 'qualified', 'opportunity', 'customer', 'churning', 'churned');
CREATE TYPE channel AS ENUM ('email', 'sms', 'voice', 'ivr', 'slack', 'chat', 'calendar', 'webhook');
CREATE TYPE direction AS ENUM ('inbound', 'outbound');
CREATE TYPE interaction_type AS ENUM ('message', 'call', 'meeting', 'note', 'task', 'system');
CREATE TYPE contact_channel AS ENUM ('sms', 'email', 'voice', 'whatsapp', 'mail');
CREATE TYPE consent_status AS ENUM ('opted_in', 'opted_out', 'unknown', 'revoked');
CREATE TYPE consent_action AS ENUM ('opt_in', 'opt_out', 'revoke', 'renew');
CREATE TYPE consent_method AS ENUM ('sms_keyword', 'web_form', 'verbal', 'written', 'api');
CREATE TYPE agent_session_status AS ENUM ('active', 'completed', 'failed', 'cancelled', 'timeout');
CREATE TYPE autonomy_level AS ENUM ('rule_based', 'router', 'supervised', 'autonomous', 'full_autonomy');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_status AS ENUM ('pending', 'queued', 'sent', 'delivered', 'failed', 'bounced', 'opted_out', 'retrying', 'dlq');
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'refunded', 'disputed');
CREATE TYPE payment_method AS ENUM ('ach', 'credit_card', 'debit_card', 'wire', 'check', 'other');
CREATE TYPE compliance_result AS ENUM ('pass', 'fail', 'warning');
CREATE TYPE sso_connection_type AS ENUM ('saml', 'oidc');
CREATE TYPE sso_connection_status AS ENUM ('active', 'inactive', 'validating');
CREATE TYPE developer_tier AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE developer_status AS ENUM ('active', 'suspended', 'revoked');
CREATE TYPE sandbox_status AS ENUM ('active', 'expired', 'destroyed');
CREATE TYPE seed_data_profile AS ENUM ('minimal', 'collections', 'healthcare');
CREATE TYPE marketplace_agent_status AS ENUM ('draft', 'review', 'published', 'suspended', 'rejected');
CREATE TYPE marketplace_install_status AS ENUM ('active', 'disabled', 'uninstalled');
CREATE TYPE sentiment_label AS ENUM ('negative', 'neutral', 'positive');
CREATE TYPE partner_tier AS ENUM ('silver', 'gold', 'platinum');
CREATE TYPE partner_status AS ENUM ('pending', 'active', 'suspended');
CREATE TYPE partner_payout_status AS ENUM ('pending', 'processing', 'paid', 'failed');

-- ============================================================================
-- TABLES
-- ============================================================================

-- tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  plan plan NOT NULL DEFAULT 'free',
  status tenant_status NOT NULL DEFAULT 'active',
  isolation_tier isolation_tier NOT NULL DEFAULT 'shared',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  status user_status NOT NULL DEFAULT 'active',
  mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  mfa_secret TEXT,
  last_login_at TIMESTAMPTZ,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_tenant_email_uniq ON users (tenant_id, email);
CREATE INDEX users_tenant_id_idx ON users (tenant_id);

-- sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_tenant_id_idx ON sessions (tenant_id);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- api_keys
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix VARCHAR(12) NOT NULL,
  permissions JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_tenant_id_idx ON api_keys (tenant_id);
CREATE INDEX api_keys_key_prefix_idx ON api_keys (key_prefix);

-- customers
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  external_id VARCHAR(255),
  type customer_type NOT NULL,
  status customer_status NOT NULL DEFAULT 'active',
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  metadata JSONB DEFAULT '{}',
  health_score INTEGER,
  lifecycle_stage lifecycle_stage DEFAULT 'lead',
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_tenant_id_idx ON customers (tenant_id);
CREATE UNIQUE INDEX customers_tenant_external_id_uniq ON customers (tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX customers_tenant_lifecycle_idx ON customers (tenant_id, lifecycle_stage);

-- interactions
CREATE TABLE interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  agent_id VARCHAR(255),
  channel channel NOT NULL,
  direction direction NOT NULL,
  type interaction_type NOT NULL,
  subject TEXT,
  content TEXT,
  content_hash TEXT,
  sentiment REAL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX interactions_tenant_customer_idx ON interactions (tenant_id, customer_id);
CREATE INDEX interactions_tenant_created_at_idx ON interactions (tenant_id, created_at);

-- audit_logs (WORM — immutable)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_number BIGINT NOT NULL,
  tenant_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  actor_type actor_type NOT NULL,
  actor_id VARCHAR(255) NOT NULL,
  resource VARCHAR(255) NOT NULL,
  resource_id VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  previous_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX audit_logs_tenant_seq_uniq ON audit_logs (tenant_id, sequence_number);
CREATE INDEX audit_logs_tenant_event_type_idx ON audit_logs (tenant_id, event_type);
CREATE INDEX audit_logs_tenant_timestamp_idx ON audit_logs (tenant_id, "timestamp");

-- merkle_roots (WORM — immutable)
CREATE TABLE merkle_roots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  batch_start BIGINT NOT NULL,
  batch_end BIGINT NOT NULL,
  root TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX merkle_roots_tenant_batch_start_uniq ON merkle_roots (tenant_id, batch_start);

-- agent_actions
CREATE TABLE agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  agent_id VARCHAR(255) NOT NULL,
  agent_role VARCHAR(100) NOT NULL,
  action_type VARCHAR(255) NOT NULL,
  input JSONB NOT NULL,
  output JSONB,
  confidence REAL NOT NULL,
  autonomy_level VARCHAR(50) NOT NULL,
  approved BOOLEAN,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  reasoning TEXT,
  token_count INTEGER,
  cost_usd REAL,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_actions_tenant_id_idx ON agent_actions (tenant_id);
CREATE INDEX agent_actions_agent_id_idx ON agent_actions (tenant_id, agent_id);
CREATE INDEX agent_actions_created_at_idx ON agent_actions (tenant_id, created_at);

-- compliance_records
CREATE TABLE compliance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  regulation VARCHAR(50) NOT NULL,
  rule_id VARCHAR(255) NOT NULL,
  action VARCHAR(255) NOT NULL,
  result compliance_result NOT NULL,
  details JSONB NOT NULL,
  enforced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX compliance_records_tenant_id_idx ON compliance_records (tenant_id);
CREATE INDEX compliance_records_tenant_regulation_idx ON compliance_records (tenant_id, regulation);
CREATE INDEX compliance_records_enforced_at_idx ON compliance_records (tenant_id, enforced_at);

-- contacts
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel contact_channel NOT NULL,
  value TEXT NOT NULL,
  value_hash VARCHAR(64),
  label VARCHAR(50),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  consent_status consent_status NOT NULL DEFAULT 'unknown',
  consent_updated_at TIMESTAMPTZ,
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contacts_tenant_customer_idx ON contacts (tenant_id, customer_id);
CREATE INDEX contacts_tenant_value_hash_idx ON contacts (tenant_id, value_hash);
CREATE INDEX contacts_tenant_channel_consent_idx ON contacts (tenant_id, channel, consent_status);

-- consent_records (WORM — immutable)
CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  channel contact_channel NOT NULL,
  action consent_action NOT NULL,
  method consent_method NOT NULL,
  evidence_ref TEXT,
  ip_address VARCHAR(45),
  user_agent TEXT,
  previous_status consent_status NOT NULL,
  new_status consent_status NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  content_hash VARCHAR(64) NOT NULL
);
CREATE INDEX consent_records_tenant_customer_idx ON consent_records (tenant_id, customer_id);
CREATE INDEX consent_records_tenant_contact_idx ON consent_records (tenant_id, contact_id);
CREATE INDEX consent_records_tenant_recorded_at_idx ON consent_records (tenant_id, recorded_at);

-- agent_sessions
CREATE TABLE agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  agent_role VARCHAR(50) NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  status agent_session_status NOT NULL DEFAULT 'active',
  autonomy_level autonomy_level NOT NULL,
  trigger_event_id VARCHAR(255),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  total_actions INTEGER NOT NULL DEFAULT 0,
  approved_actions INTEGER NOT NULL DEFAULT 0,
  rejected_actions INTEGER NOT NULL DEFAULT 0,
  total_cost_cents INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  confidence_avg REAL,
  outcome VARCHAR(100),
  outcome_metadata JSONB DEFAULT '{}',
  error_details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_sessions_tenant_customer_idx ON agent_sessions (tenant_id, customer_id);
CREATE INDEX agent_sessions_tenant_status_idx ON agent_sessions (tenant_id, status);
CREATE INDEX agent_sessions_tenant_role_idx ON agent_sessions (tenant_id, agent_role);
CREATE INDEX agent_sessions_tenant_started_at_idx ON agent_sessions (tenant_id, started_at);

-- messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  agent_session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  channel contact_channel NOT NULL,
  direction message_direction NOT NULL,
  status message_status NOT NULL DEFAULT 'pending',
  content_ref TEXT,
  content_hash VARCHAR(64),
  provider_message_id VARCHAR(255),
  provider_status VARCHAR(50),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_code VARCHAR(50),
  error_message TEXT,
  cost_cents INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_tenant_customer_idx ON messages (tenant_id, customer_id);
CREATE INDEX messages_tenant_status_idx ON messages (tenant_id, status);
CREATE INDEX messages_tenant_channel_direction_idx ON messages (tenant_id, channel, direction);
CREATE INDEX messages_tenant_agent_session_idx ON messages (tenant_id, agent_session_id);
CREATE INDEX messages_provider_message_id_idx ON messages (provider_message_id);

-- payment_records
CREATE TABLE payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  agent_session_id UUID REFERENCES agent_sessions(id) ON DELETE SET NULL,
  external_payment_id VARCHAR(255),
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  status payment_status NOT NULL DEFAULT 'pending',
  payment_method payment_method NOT NULL,
  payment_plan_id VARCHAR(255),
  due_date DATE,
  paid_at TIMESTAMPTZ,
  reference_number VARCHAR(255),
  notes_ref TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_records_tenant_customer_idx ON payment_records (tenant_id, customer_id);
CREATE INDEX payment_records_tenant_status_idx ON payment_records (tenant_id, status);
CREATE INDEX payment_records_tenant_due_date_idx ON payment_records (tenant_id, due_date);
CREATE INDEX payment_records_external_payment_id_idx ON payment_records (external_payment_id);

-- decision_rules
CREATE TABLE decision_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 50,
  conditions JSONB NOT NULL,
  action JSONB NOT NULL,
  regulation VARCHAR(50),
  enabled BOOLEAN NOT NULL DEFAULT true,
  terminal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX decision_rules_tenant_enabled_priority_idx ON decision_rules (tenant_id, enabled, priority);
CREATE INDEX decision_rules_tenant_regulation_idx ON decision_rules (tenant_id, regulation);

-- decision_audit (WORM — immutable)
CREATE TABLE decision_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  decision_id UUID NOT NULL,
  customer_id VARCHAR(255) NOT NULL,
  layer VARCHAR(20) NOT NULL,
  input_summary TEXT NOT NULL,
  output_summary TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  score REAL NOT NULL,
  confidence REAL NOT NULL,
  action_selected VARCHAR(100) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX decision_audit_tenant_customer_idx ON decision_audit (tenant_id, customer_id);
CREATE INDEX decision_audit_tenant_created_at_idx ON decision_audit (tenant_id, created_at);
CREATE INDEX decision_audit_decision_id_idx ON decision_audit (decision_id);

-- channel_preferences
CREATE TABLE channel_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  channel contact_channel NOT NULL,
  priority INTEGER NOT NULL DEFAULT 3,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  do_not_contact_before TIME,
  do_not_contact_after TIME,
  timezone VARCHAR(50) NOT NULL DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX channel_prefs_tenant_customer_idx ON channel_preferences (tenant_id, customer_id);
CREATE UNIQUE INDEX channel_prefs_tenant_customer_channel_uniq ON channel_preferences (tenant_id, customer_id, channel);

-- organizations
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  parent_id UUID,
  slug VARCHAR(100) NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX organizations_tenant_id_idx ON organizations (tenant_id);
CREATE INDEX organizations_tenant_parent_idx ON organizations (tenant_id, parent_id);
CREATE UNIQUE INDEX organizations_tenant_slug_uniq ON organizations (tenant_id, slug);

-- sso_connections
CREATE TABLE sso_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  type sso_connection_type NOT NULL,
  provider VARCHAR(100) NOT NULL,
  external_connection_id VARCHAR(255),
  status sso_connection_status NOT NULL DEFAULT 'validating',
  enforce_sso BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sso_connections_tenant_id_idx ON sso_connections (tenant_id);
CREATE INDEX sso_connections_tenant_status_idx ON sso_connections (tenant_id, status);
CREATE UNIQUE INDEX sso_connections_tenant_ext_id_uniq ON sso_connections (tenant_id, external_connection_id);

-- custom_roles
CREATE TABLE custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_role VARCHAR(50) NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]',
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX custom_roles_tenant_name_uniq ON custom_roles (tenant_id, name);
CREATE INDEX custom_roles_tenant_id_idx ON custom_roles (tenant_id);

-- user_custom_roles (junction table)
CREATE TABLE user_custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES custom_roles(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_custom_roles_tenant_user_role_uniq ON user_custom_roles (tenant_id, user_id, role_id);
CREATE INDEX user_custom_roles_tenant_id_idx ON user_custom_roles (tenant_id);
CREATE INDEX user_custom_roles_user_id_idx ON user_custom_roles (user_id);

-- scim_tokens
CREATE TABLE scim_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  token_hash VARCHAR(64) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scim_tokens_tenant_id_idx ON scim_tokens (tenant_id);
CREATE UNIQUE INDEX scim_tokens_hash_uniq ON scim_tokens (token_hash);

-- white_label_configs
CREATE TABLE white_label_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL UNIQUE,
  custom_domain TEXT,
  logo_url TEXT,
  favicon_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#3b82f6',
  accent_color TEXT NOT NULL DEFAULT '#10b981',
  bg_color TEXT NOT NULL DEFAULT '#0f172a',
  text_color TEXT NOT NULL DEFAULT '#e2e8f0',
  email_from_name TEXT,
  email_from_address TEXT,
  custom_css TEXT,
  footer_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX white_label_configs_custom_domain_uniq ON white_label_configs (custom_domain);

-- developer_accounts
CREATE TABLE developer_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT,
  organization TEXT,
  api_key_hash TEXT NOT NULL,
  api_key_prefix VARCHAR(8) NOT NULL,
  tier developer_tier NOT NULL DEFAULT 'free',
  rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
  sandbox_tenant_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ,
  status developer_status NOT NULL DEFAULT 'active'
);
CREATE UNIQUE INDEX developer_accounts_email_uniq ON developer_accounts (email);
CREATE INDEX developer_accounts_api_key_prefix_idx ON developer_accounts (api_key_prefix);
CREATE INDEX developer_accounts_status_idx ON developer_accounts (status);

-- developer_usage
CREATE TABLE developer_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX developer_usage_developer_id_idx ON developer_usage (developer_id);
CREATE INDEX developer_usage_timestamp_idx ON developer_usage ("timestamp");

-- sandbox_tenants
CREATE TABLE sandbox_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  status sandbox_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seed_data_profile seed_data_profile NOT NULL DEFAULT 'minimal'
);
CREATE UNIQUE INDEX sandbox_tenants_tenant_id_uniq ON sandbox_tenants (tenant_id);
CREATE INDEX sandbox_tenants_developer_id_idx ON sandbox_tenants (developer_id);
CREATE INDEX sandbox_tenants_status_idx ON sandbox_tenants (status);

-- marketplace_agents
CREATE TABLE marketplace_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  version VARCHAR(64) NOT NULL,
  description TEXT NOT NULL,
  author VARCHAR(255) NOT NULL,
  license VARCHAR(64) NOT NULL,
  manifest JSONB NOT NULL,
  package_hash VARCHAR(64) NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  rating REAL DEFAULT 0,
  status marketplace_agent_status NOT NULL DEFAULT 'draft',
  publisher_id UUID NOT NULL REFERENCES developer_accounts(id) ON DELETE RESTRICT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX marketplace_agents_name_version_uniq ON marketplace_agents (name, version);
CREATE INDEX marketplace_agents_status_idx ON marketplace_agents (status);
CREATE INDEX marketplace_agents_publisher_id_idx ON marketplace_agents (publisher_id);
CREATE INDEX marketplace_agents_name_idx ON marketplace_agents (name);
CREATE INDEX marketplace_agents_rating_idx ON marketplace_agents (rating);

-- marketplace_reviews
CREATE TABLE marketplace_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES marketplace_agents(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX marketplace_reviews_agent_id_idx ON marketplace_reviews (agent_id);
CREATE INDEX marketplace_reviews_reviewer_id_idx ON marketplace_reviews (reviewer_id);
CREATE UNIQUE INDEX marketplace_reviews_agent_reviewer_uniq ON marketplace_reviews (agent_id, reviewer_id);

-- marketplace_installs
CREATE TABLE marketplace_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  agent_id UUID NOT NULL REFERENCES marketplace_agents(id) ON DELETE RESTRICT,
  version VARCHAR(64) NOT NULL,
  status marketplace_install_status NOT NULL DEFAULT 'active',
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX marketplace_installs_tenant_agent_uniq ON marketplace_installs (tenant_id, agent_id);
CREATE INDEX marketplace_installs_tenant_id_idx ON marketplace_installs (tenant_id);
CREATE INDEX marketplace_installs_agent_id_idx ON marketplace_installs (agent_id);
CREATE INDEX marketplace_installs_status_idx ON marketplace_installs (status);

-- agent_memories
CREATE TABLE agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  similarity_score REAL,
  consolidation_count INTEGER NOT NULL DEFAULT 0,
  key_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_memories_tenant_id_idx ON agent_memories (tenant_id);
CREATE INDEX agent_memories_tenant_session_idx ON agent_memories (tenant_id, session_id);
CREATE INDEX agent_memories_tenant_created_idx ON agent_memories (tenant_id, created_at);

-- sentiment_history
CREATE TABLE sentiment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_id VARCHAR(255) NOT NULL,
  score REAL NOT NULL,
  label sentiment_label NOT NULL,
  confidence REAL NOT NULL,
  message_hash VARCHAR(64) NOT NULL,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sentiment_history_tenant_id_idx ON sentiment_history (tenant_id);
CREATE INDEX sentiment_history_tenant_customer_idx ON sentiment_history (tenant_id, customer_id);
CREATE INDEX sentiment_history_tenant_analyzed_idx ON sentiment_history (tenant_id, analyzed_at);

-- partners
CREATE TABLE partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  company VARCHAR(255) NOT NULL,
  tier partner_tier NOT NULL DEFAULT 'silver',
  status partner_status NOT NULL DEFAULT 'pending',
  revenue_share_pct INTEGER NOT NULL DEFAULT 10,
  api_key_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX partners_email_uniq ON partners (email);
CREATE INDEX partners_status_idx ON partners (status);
CREATE INDEX partners_tier_idx ON partners (tier);

-- partner_payouts
CREATE TABLE partner_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status partner_payout_status NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX partner_payouts_partner_id_idx ON partner_payouts (partner_id);
CREATE INDEX partner_payouts_status_idx ON partner_payouts (status);
CREATE INDEX partner_payouts_period_idx ON partner_payouts (period_start, period_end);

-- ============================================================================
-- MIGRATION TRACKING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  checksum VARCHAR(64) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
