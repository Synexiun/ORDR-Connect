# Phase 52 — Integration Depth: Salesforce + HubSpot Design

**Date:** 2026-04-04
**Status:** Approved for implementation
**Scope:** CRM integration persistence, credential management, inbound webhooks, bi-directional sync, activity endpoints, field mapping CRUD

---

## Goal

Make the Salesforce and HubSpot integration layer production-ready by adding credential persistence, real webhook signature verification, bi-directional sync orchestration, and completing the missing API endpoints. The existing adapter implementations (OAuth, CRUD, field mappings, bulk operations) are retained unchanged.

---

## Background

The existing `packages/integrations` layer has production-grade adapters for both providers (1,971 lines, 1:1 test ratio). The critical gaps are infrastructure: no DB tables for token storage, no real HMAC-SHA256 webhook verification, no sync state tracking, no background sync orchestration, and missing activity + field mapping endpoints.

---

## Architecture

**Approach:** Kafka-spine event-driven sync. ORDR→CRM outbound flows through the existing `customer.created` / `customer.updated` event stream. CRM→ORDR inbound flows through new webhook POST endpoints → Kafka → worker consumer. 15-minute batch reconciliation via the existing `@ordr/scheduler`. Credentials stored in a new `integration_configs` DB table, encrypted with the existing `FieldEncryptor`.

**New Kafka topic:** `ordr.integration.events` — carries `integration.webhook_received` events from the inbound webhook endpoint to the sync worker.

**Conflict resolution:** Last write wins by timestamp. When both sides updated within a 5-minute window, log `sync.conflict` audit event + in-app notification to tenant admin, but still apply the CRM update (do not block sync).

---

## 1. Data Model

### Migration 0012

New file: `packages/db/src/migrations/0012_integration_tables.sql`

### Table: `integration_configs`

Stores per-tenant per-provider OAuth credentials and sync configuration.

```sql
CREATE TABLE integration_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('salesforce', 'hubspot')),
  status          TEXT NOT NULL DEFAULT 'disconnected'
                    CHECK (status IN ('connected','disconnected','error','rate_limited')),
  -- AES-256-GCM ciphertext — plaintext never stored (FieldEncryptor)
  access_token_enc    TEXT,
  refresh_token_enc   TEXT,
  -- Webhook secret encrypted independently — RESTRICTED credential, never stored plaintext
  webhook_secret_enc  TEXT,
  token_expires_at    TIMESTAMPTZ,
  scopes              TEXT[],
  instance_url        TEXT,                    -- Salesforce instance URL
  settings            JSONB NOT NULL DEFAULT '{}',  -- non-sensitive per-tenant overrides only
  last_sync_at    TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

ALTER TABLE integration_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_configs_tenant_isolation ON integration_configs
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

CREATE INDEX idx_integration_configs_tenant ON integration_configs (tenant_id);
CREATE INDEX idx_integration_configs_status ON integration_configs (tenant_id, status);
```

### Table: `sync_events`

Append-only audit log of every sync operation. WORM enforced by PostgreSQL trigger — UPDATE and DELETE raise an exception at the database level.

```sql
CREATE TABLE sync_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id      UUID NOT NULL REFERENCES integration_configs(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('contact','deal','activity')),
  entity_id           UUID,                -- ORDR internal ID
  external_id         TEXT,                -- CRM record ID
  status              TEXT NOT NULL CHECK (status IN ('success','failed','conflict','skipped')),
  -- 'crm_wins' = last-write-wins applied CRM value; NULL for non-conflict outcomes
  conflict_resolution TEXT CHECK (conflict_resolution IN ('crm_wins')),
  -- Sanitised error only — no PHI, no stack traces
  error_summary       TEXT,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_events_tenant_isolation ON sync_events
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

CREATE INDEX idx_sync_events_tenant_provider ON sync_events (tenant_id, provider);
CREATE INDEX idx_sync_events_entity ON sync_events (entity_id);
CREATE INDEX idx_sync_events_synced_at ON sync_events (synced_at DESC);

-- WORM enforcement: block any UPDATE or DELETE on sync_events rows
CREATE OR REPLACE FUNCTION prevent_sync_events_mutation()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sync_events is append-only (WORM)';
END;
$$;

CREATE TRIGGER sync_events_no_update
  BEFORE UPDATE OR DELETE ON sync_events
  FOR EACH ROW EXECUTE FUNCTION prevent_sync_events_mutation();
```

### Table: `webhook_logs`

Webhook processing-state table (not a WORM audit log). Records receipt, signature validity, and processing status for idempotency and retry tracking. The immutable compliance audit record is emitted to the `@ordr/audit` WORM store as `integration.webhook_received` / `integration.webhook_invalid_signature` — `webhook_logs` is a mutable operational table that may be pruned after retention window. `processed` is intentionally mutable (updated to `true` after Kafka publish). PHI is never stored — only `SHA-256(rawBody)`.

```sql
CREATE TABLE webhook_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- nullable: unknown tenant before lookup
  provider        TEXT NOT NULL,
  event_type      TEXT NOT NULL,           -- raw CRM event type string
  payload_hash    TEXT NOT NULL,           -- SHA-256(rawBody) — no PHI stored
  signature_valid BOOLEAN NOT NULL,
  processed       BOOLEAN NOT NULL DEFAULT false,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

-- Allows rows where tenant_id is NULL (not yet resolved at write time) OR matches the current tenant.
-- The inbound webhook endpoint uses the service-role DB connection for the initial INSERT
-- (before tenant resolution), bypassing RLS. Post-resolution queries use the app connection
-- and are filtered to the resolved tenant.
CREATE POLICY webhook_logs_tenant_isolation ON webhook_logs
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')::uuid);

CREATE INDEX idx_webhook_logs_tenant ON webhook_logs (tenant_id, received_at DESC);
CREATE INDEX idx_webhook_logs_unprocessed ON webhook_logs (processed, received_at)
  WHERE processed = false;
```

### Table: `integration_field_mappings`

Per-tenant field mapping overrides. Falls back to adapter defaults when no rows exist.

```sql
CREATE TABLE integration_field_mappings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('salesforce', 'hubspot')),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('contact','deal','activity')),
  direction    TEXT NOT NULL CHECK (direction IN ('inbound','outbound','both')),
  source_field TEXT NOT NULL,
  target_field TEXT NOT NULL,
  transform    JSONB,                  -- optional transformation spec
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, entity_type, direction, source_field)
);

ALTER TABLE integration_field_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_field_mappings_tenant_isolation ON integration_field_mappings
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

CREATE INDEX idx_field_mappings_tenant_provider ON integration_field_mappings (tenant_id, provider, entity_type);
```

### Table: `integration_entity_mappings`

Identity-mapping table: authoritative registry of ORDR entity ID ↔ CRM external ID pairs. Distinct from `sync_events` (audit log of what happened) — this table answers "do we already know this CRM record?" for inbound sync deduplication.

```sql
CREATE TABLE integration_entity_mappings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('salesforce', 'hubspot')),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('contact', 'deal', 'activity')),
  ordr_id      UUID NOT NULL,       -- ORDR internal ID (customer / deal / activity)
  external_id  TEXT NOT NULL,       -- CRM record ID
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, entity_type, external_id)
);

ALTER TABLE integration_entity_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY integration_entity_mappings_tenant_isolation ON integration_entity_mappings
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

CREATE INDEX idx_entity_mappings_lookup ON integration_entity_mappings
  (tenant_id, provider, entity_type, external_id);
CREATE INDEX idx_entity_mappings_ordr_id ON integration_entity_mappings (ordr_id);
```

### Drizzle Schema Files

- Create: `packages/db/src/schema/integrations.ts` — Drizzle definitions for all five tables
- Modify: `packages/db/src/schema/index.ts` — export all five tables + enums

---

## 2. Credential Manager

### New file: `packages/integrations/src/credential-manager.ts`

Wraps `FieldEncryptor` for OAuth token lifecycle. Three public functions:

**`saveCredentials(db, tenantId, provider, tokens, fieldEncryptor)`**
Encrypts `access_token` and `refresh_token` independently (separate IVs), upserts the `integration_configs` row, sets `status = 'connected'`, `token_expires_at`, `scopes`, `instance_url` (Salesforce only). Emits audit event `integration.connected`.

**`getCredentials(db, tenantId, provider, fieldEncryptor): Promise<OAuthCredentials>`**
Fetches the row, decrypts both tokens. Throws `IntegrationNotConnectedError` (typed, maps to HTTP 403) if row is missing, status is `disconnected`, or decryption fails.

**`ensureFreshCredentials(db, tenantId, provider, adapter, fieldEncryptor): Promise<OAuthCredentials>`**
Calls `getCredentials`, checks `token_expires_at < now() + 5 minutes`. If stale, calls `adapter.refreshAccessToken(refreshToken)`, persists new tokens via `saveCredentials`, returns fresh credentials. Token refresh failure sets `status = 'error'` and throws `IntegrationTokenExpiredError`.

### New middleware: `apps/api/src/middleware/crm-credentials.ts`

`withCredentials()` — Hono middleware that calls `ensureFreshCredentials` for the `:provider` param and populates `c.set('crmCredentials', credentials)`. Handlers read credentials via `c.get('crmCredentials')`. Integration routes no longer receive credentials from the request.

**Error codes:**
- `IntegrationNotConnectedError` → 403 `{ error: 'integration_not_connected' }`
- `IntegrationTokenExpiredError` → 503 `{ error: 'integration_token_refresh_failed' }`

---

## 3. Webhook Inbound Handling

### New endpoints added to `apps/api/src/routes/integrations.ts`

#### `POST /api/v1/integrations/:provider/webhook`

No JWT auth — CRM platforms push without tokens. Protected by HMAC-SHA256 signature verification.

**Signature verification (replaces stubs in both adapters):**

- **Salesforce:** Reads `X-Salesforce-Signature` header. Computes `HMAC-SHA256(webhookSecret, rawBody)`, base64-encodes. Compares with `crypto.timingSafeEqual`. Webhook secret decrypted at request time from `integration_configs.webhook_secret_enc` via `FieldEncryptor` (RESTRICTED credential — never in `settings` JSONB).
- **HubSpot:** Reads `X-HubSpot-Signature-v3` and `X-HubSpot-Request-Timestamp` headers. Verifies timestamp is within 5 minutes (replay attack prevention). Computes `HMAC-SHA256(webhookSecret, method + url + rawBody + timestamp)`. Compares with `crypto.timingSafeEqual`. Webhook secret decrypted from `integration_configs.webhook_secret_enc` via `FieldEncryptor`.

**Processing flow:**
1. Read raw body as bytes before JSON parsing
2. Verify signature — log `webhook_logs` row regardless of result (`signature_valid = true/false`)
3. If invalid: return 200 (prevent CRM retry storm), emit `compliance.violation` audit event, stop
4. Look up `integration_configs` by provider + `instance_url` / `portalId` to resolve `tenant_id`
5. Call `adapter.handleWebhook(payload)` → normalised `WebhookPayload`
6. Publish `integration.webhook_received` to `TOPICS.INTEGRATION_EVENTS`
7. Update `webhook_logs.processed = true`
8. Return `200 { received: true }`

#### `POST /api/v1/integrations/:provider/webhook/test`

JWT-authenticated. Calls `adapter.getHealth(credentials)`. Returns `{ valid: true, provider, latencyMs }` or `{ valid: false, error }`. Used to verify the stored webhook secret and connectivity without triggering a real event.

---

## 4. Events Package

### Modify: `packages/events/src/topics.ts`

Add `INTEGRATION_EVENTS: 'ordr.integration.events'` to `TOPICS` const and corresponding entry in `DEFAULT_TOPIC_CONFIGS`:
- 6 partitions, replication factor 3, 14-day retention, `delete` cleanup

### Modify: `packages/events/src/types.ts`

Add to `EventType` const:
```typescript
INTEGRATION_WEBHOOK_RECEIVED: 'integration.webhook_received',
INTEGRATION_SYNC_COMPLETED:   'integration.sync_completed',
INTEGRATION_SYNC_FAILED:      'integration.sync_failed',
INTEGRATION_CONNECTED:        'integration.connected',
INTEGRATION_DISCONNECTED:     'integration.disconnected',
```

Add `IntegrationWebhookReceivedPayload` interface:
```typescript
{
  tenantId: string;
  provider: string;
  entityType: 'contact' | 'deal' | 'activity';
  externalId: string;
  eventType: string;         // raw CRM event type
  webhookLogId: string;      // FK to webhook_logs for tracing
}
```

### Modify: `packages/events/src/schemas.ts`

Add `integrationWebhookReceivedPayloadSchema` and register in `eventSchemaRegistry`.

---

## 5. Audit Types

### Modify: `packages/audit/src/types.ts`

Add to `AuditEventType` union:
```typescript
| 'integration.connected'
| 'integration.disconnected'
| 'integration.sync_completed'
| 'integration.sync_failed'
| 'integration.conflict_detected'
| 'integration.webhook_received'
| 'integration.webhook_invalid_signature'
```

---

## 6. Sync Worker

### New file: `apps/worker/src/handlers/integration-sync.ts`

Factory: `createIntegrationSyncHandler(deps: IntegrationSyncDeps)`

#### Outbound sync (ORDR→CRM)

Consumes `TOPICS.CUSTOMER_EVENTS`. Runs alongside the existing `createCustomerEventsHandler` — both handlers registered for the same topic event types.

- **`customer.created`:** Call `ensureFreshCredentials` for every `connected` provider on the tenant, then `adapter.pushContact(credentials, crmContact)` for each. Write `sync_events` row. Emit `integration.sync_completed` or `integration.sync_failed` audit event.
- **`customer.updated`:** Enqueue `customerId` into Redis sorted set `integration:outbound:{tenantId}:{provider}` with score `Date.now()`. Does not call the adapter directly — deduplication happens in the batch job.

#### Inbound sync (CRM→ORDR)

Consumes `TOPICS.INTEGRATION_EVENTS` (event type `integration.webhook_received`).

1. Look up ORDR `customers.id` via `integration_entity_mappings WHERE external_id = payload.externalId AND provider = payload.provider AND entity_type = 'contact' AND tenant_id = tenantId`
2. If no match: create new customer record (CRM has a contact we don't have yet); insert a new `integration_entity_mappings` row linking the new `customers.id` to `payload.externalId`
3. If match found: compare CRM `lastModified` with ORDR `customers.updated_at`
   - CRM newer (or delta > 5 min): apply field delta to `customers` row via Drizzle UPDATE
   - Both updated within 5 min: apply CRM update (last write wins), write `sync_events` with `status = 'conflict'` + `conflict_resolution = 'crm_wins'`, emit `integration.conflict_detected` audit event, send in-app notification to tenant admin
   - ORDR newer (delta > 5 min): skip, write `sync_events` with `status = 'skipped'`
4. Write `sync_events` row for every outcome

### Modify: `apps/worker/src/server.ts`

- Register `createIntegrationSyncHandler` for `customer.created` and `customer.updated` (alongside existing customer handler)
- Register inbound sync handler for `integration.webhook_received`
- Add `TOPICS.INTEGRATION_EVENTS` to `consumer.subscribe([...])`
- Extend `WorkerDependencies` with `integrationSyncDeps: IntegrationSyncDeps`

### Modify: `apps/worker/src/index.ts`

Export `createIntegrationSyncHandler` and `IntegrationSyncDeps`.

---

## 7. Batch Reconciliation Job

### New file: `packages/scheduler/src/jobs/integration-batch-sync.ts`

**Schedule:** `*/15 * * * *` (every 15 minutes)

**Logic:**
1. Query all `integration_configs` with `status = 'connected'` (BYPASSRLS — cross-tenant scheduler query)
2. For each tenant+provider: drain Redis sorted set `integration:outbound:{tenantId}:{provider}` — get all customer IDs with score <= `now()`
3. Deduplicate by customer ID (keep only latest score — most recent change)
4. Fetch current ORDR customer records for those IDs
5. Call `ensureFreshCredentials` — skip batch if token refresh fails (log error, continue to next tenant)
6. If count > 200 (Salesforce) or > 100 (HubSpot): call `adapter.bulkPushContacts()`. Otherwise call individual `adapter.pushContact()` per record
7. Write `sync_events` row for each record (success/failed)
8. Update `integration_configs.last_sync_at = now()`

Export `createIntegrationBatchSyncDefinition` and `createIntegrationBatchSyncHandler` from the scheduler package index.

---

## 8. API Completions

### Modify: `apps/api/src/routes/integrations.ts`

**Activity endpoints:**
- `GET /api/v1/integrations/:provider/activities` — `withCredentials` middleware, calls `adapter.fetchActivities(credentials, query)`. Query params: `limit` (1-200, default 50), `offset` (≥0, default 0), `customerId` (UUID, optional filter). Returns `{ items: CrmActivity[], total, hasMore }`.
- `POST /api/v1/integrations/:provider/activities` — `withCredentials` middleware, Zod-validated body (`{ customerId, type, subject, description?, date? }`), calls `adapter.pushActivity(credentials, activity)`. Returns created activity. Audit-logged.

**Field mapping endpoints:**
- `GET /api/v1/integrations/:provider/field-mappings` — Returns active mappings for `tenant + provider`. Rows with `direction = 'both'` appear in results regardless of direction query; rows with `direction = 'inbound'` or `'outbound'` are filtered when the optional `?direction=` query param is supplied. If no custom rows exist, returns adapter defaults (seeded from `SalesforceAdapter` / `HubSpotAdapter` built-in mappings).
- `PUT /api/v1/integrations/:provider/field-mappings` — Replaces full mapping set atomically (DELETE + INSERT in transaction). Body: `{ mappings: FieldMapping[] }`. Validated: max 200 mappings, source/target field names ≤100 chars. Audit-logged on every write.

**Disconnect endpoint:**
- `DELETE /api/v1/integrations/:provider` — JWT-authenticated. Sets `integration_configs.status = 'disconnected'`, nulls `access_token_enc`, `refresh_token_enc`, and `webhook_secret_enc`. Emits `integration.disconnected` audit event. Returns `204 No Content`. Does not delete the `integration_configs` row (preserves sync history).

**Wire `withCredentials` onto all existing credential-requiring routes** (contacts, deals, activities, field mappings). Remove the placeholder credential-passing pattern from `configureIntegrationRoutes`.

---

## 9. Security Controls

| Control | Implementation |
|---------|---------------|
| Token encryption | `FieldEncryptor` AES-256-GCM, per-tenant derived key via KMS |
| Webhook auth | HMAC-SHA256 + `crypto.timingSafeEqual` (no timing oracle) |
| Replay prevention | HubSpot: 5-min timestamp window; Salesforce: stateless (signature is sufficient) |
| Invalid webhook | Returns 200 (no retry storm), logs `signature_valid=false`, emits `compliance.violation` |
| Tenant isolation | RLS on `integration_configs`, `sync_events`, `integration_field_mappings` |
| PHI in webhooks | `webhook_logs` stores only `SHA256(rawBody)` — raw payload never persisted |
| Credential leak | `access_token` / `refresh_token` never returned to clients, never logged |
| Rate limits | `ensureFreshCredentials` tracks `token_expires_at`; `integration_configs.status = 'rate_limited'` set when adapter signals 429 |

---

## 10. Testing Strategy

| Test | Location | What it covers |
|------|----------|---------------|
| Credential manager unit | `packages/integrations/src/__tests__/credential-manager.test.ts` | save/get/ensureFresh, token expiry, error codes |
| Webhook signature verification | `apps/api/src/__tests__/integration-webhooks.test.ts` | valid/invalid HMAC, replay attack (stale timestamp), 200-on-invalid |
| Inbound sync handler | `apps/worker/src/__tests__/integration-sync.test.ts` | CRM→ORDR apply, conflict detection, skipping, new record creation |
| Outbound sync handler | same file | customer.created immediate push, customer.updated Redis enqueue |
| Batch job | `packages/scheduler/src/__tests__/integration-batch-sync.test.ts` | drain, dedup, bulk threshold, token refresh failure skip |
| Activity endpoints | `apps/api/src/__tests__/integrations.test.ts` (extended) | GET/POST activities, auth, validation |
| Field mapping endpoints | same file | GET defaults, PUT replace, max mapping limit |
| Compliance test | `tests/compliance/check-integration-audit-events.sh` | Verifies all 7 integration AuditEventType values present |

**Coverage target:** 100% on credential encryption/decryption and webhook signature verification paths (CLAUDE.md Compliance Gates #5 and #7).

---

## 11. Files Created / Modified

### Created
- `packages/db/src/migrations/0012_integration_tables.sql`
- `packages/db/src/schema/integrations.ts`
- `packages/integrations/src/credential-manager.ts`
- `apps/api/src/middleware/crm-credentials.ts`
- `apps/worker/src/handlers/integration-sync.ts`
- `packages/scheduler/src/jobs/integration-batch-sync.ts`
- `packages/scheduler/src/__tests__/integration-batch-sync.test.ts`
- `tests/compliance/check-integration-audit-events.sh`
- `apps/api/src/__tests__/integration-webhooks.test.ts`
- `apps/worker/src/__tests__/integration-sync.test.ts`
- `packages/integrations/src/__tests__/credential-manager.test.ts`

### Modified
- `packages/db/src/schema/index.ts` — export 5 new tables + enums
- `packages/events/src/topics.ts` — add `INTEGRATION_EVENTS`
- `packages/events/src/types.ts` — add 5 `EventType` constants + `IntegrationWebhookReceivedPayload`
- `packages/events/src/schemas.ts` — add webhook payload schema + registry entry
- `packages/audit/src/types.ts` — add 7 integration audit event types
- `packages/integrations/src/salesforce/adapter.ts` — replace webhook signature stub with real HMAC-SHA256
- `packages/integrations/src/hubspot/adapter.ts` — replace webhook signature stub + disconnect stub with real implementations
- `apps/api/src/routes/integrations.ts` — add activity, field-mapping, webhook, and disconnect endpoints; wire `withCredentials`
- `apps/api/src/__tests__/integrations.test.ts` — extend with activity + field-mapping endpoint tests
- `apps/api/src/server.ts` — wire credential manager deps into `configureIntegrationRoutes`
- `apps/worker/src/server.ts` — register integration sync handlers, add `INTEGRATION_EVENTS` to subscribe
- `apps/worker/src/index.ts` — export new handler + deps type
- `packages/scheduler/src/index.ts` — export batch sync job
