-- packages/db/migrations/0013_developer_webhooks.sql
-- Phase 53: Developer webhook registrations
-- Rule 1: HMAC secret stored encrypted (hmac_secret_encrypted)
-- Rule 3: Mutations audited at route layer (no WORM needed on this table)

CREATE TABLE developer_webhooks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id          UUID NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
  url                   TEXT NOT NULL,
  events                TEXT[] NOT NULL DEFAULT '{}',
  hmac_secret_encrypted TEXT NOT NULL,
  active                BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_developer_webhooks_developer_id ON developer_webhooks (developer_id);
CREATE INDEX idx_developer_webhooks_active      ON developer_webhooks (active);
