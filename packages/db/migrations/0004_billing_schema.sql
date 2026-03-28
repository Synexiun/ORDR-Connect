-- ============================================================================
-- ORDR-Connect — 0004_billing_schema.sql
-- Billing tables: customers, subscriptions, usage records
--
-- SOC2 CC6.1  — Plan-based access enforced from durable subscription records.
-- ISO 27001 A.8.2.3 — Encrypted Stripe IDs stored at field level.
-- ISO 27001 A.12.1.3 — Capacity management via persistent usage tracking.
-- HIPAA §164.312(b) — Subscription lifecycle changes audited.
-- PCI DSS Req 3.3  — No raw card data stored; only tokenized references.
-- ============================================================================

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE subscription_status AS ENUM (
  'active',
  'trialing',
  'past_due',
  'cancelled'
);

CREATE TYPE usage_resource AS ENUM (
  'agents',
  'contacts',
  'messages',
  'api_calls'
);

-- ============================================================================
-- TABLES
-- ============================================================================

-- ---------------------------------------------------------------------------
-- billing_customers
-- Maps ORDR tenants to Stripe customer objects.
-- stripe_customer_id is AES-256-GCM encrypted by the application layer
-- before write — never stored in plaintext.
-- ---------------------------------------------------------------------------
CREATE TABLE billing_customers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id TEXT       NOT NULL,  -- field-encrypted (AES-256-GCM)
  email             VARCHAR(255) NOT NULL,
  name              VARCHAR(255) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT billing_customers_tenant_id_uidx UNIQUE (tenant_id)
);

-- ---------------------------------------------------------------------------
-- subscriptions
-- One row per subscription lifecycle. Multiple rows per tenant are possible
-- (e.g., previous cancelled + current active). Consumers should filter on
-- status IN ('active', 'trialing') for enforcement.
--
-- id: Stripe subscription ID (sub_xxx) — used as PK for Stripe correlation.
-- stripe_subscription_id: AES-256-GCM encrypted version of the same ID.
-- ---------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                     VARCHAR(255) PRIMARY KEY,  -- Stripe sub ID e.g. sub_xxx
  tenant_id              UUID         NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  stripe_subscription_id TEXT         NOT NULL,  -- field-encrypted
  plan_tier              plan         NOT NULL DEFAULT 'free',
  status                 subscription_status NOT NULL DEFAULT 'active',
  current_period_start   TIMESTAMPTZ  NOT NULL,
  current_period_end     TIMESTAMPTZ  NOT NULL,
  cancel_at_period_end   BOOLEAN      NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_tenant_status_idx ON subscriptions (tenant_id, status);
CREATE INDEX subscriptions_period_end_idx    ON subscriptions (current_period_end);

-- ---------------------------------------------------------------------------
-- usage_records
-- Incremental resource consumption events written by UsageTracker.flushAll().
-- Rows are never updated — only inserted and (at period reset) deleted.
-- getUsageSummary SUM-aggregates these rows filtered by recorded_at.
-- ---------------------------------------------------------------------------
CREATE TABLE usage_records (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource     usage_resource NOT NULL,
  quantity     INTEGER      NOT NULL CHECK (quantity > 0),
  period_start TIMESTAMPTZ  NOT NULL,
  period_end   TIMESTAMPTZ  NOT NULL,
  recorded_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX usage_records_tenant_resource_idx ON usage_records (tenant_id, resource);
CREATE INDEX usage_records_tenant_recorded_idx ON usage_records (tenant_id, recorded_at);

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================

-- billing_customers
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_customers FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_customers_tenant_isolation ON billing_customers
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- subscriptions
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_tenant_isolation ON subscriptions
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- usage_records
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_records_tenant_isolation ON usage_records
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
