# Phase 55 — Vault Secret Rotation Design

**Date:** 2026-04-05
**Status:** Approved

## Goal

Make secret rotation operational for SOC 2 Type II compliance. The Vault infrastructure is already deployed (EKS HA Raft, KMS auto-unseal, CloudWatch audit logs) but the application reads secrets from `process.env` only, with no dynamic refresh and no DEK rotation pipeline. Phase 55 closes three gaps: Vault-backed secret loading, zero-downtime hot-reload, and automated 90-day DEK re-wrap.

## Context

### Current State

- `apps/api/src/server.ts` reads all secrets from `process.env` via `loadConfig()` (Zod schema validation) at startup — no Vault client, no refresh.
- `packages/crypto/src/envelope.ts` has `rewrap(envelope, newKek, newKeyVersion): EncryptedEnvelope` as an instance method on `EnvelopeEncryption`. It uses `this.kek` (the old KEK) to unwrap the DEK and then re-wraps it with `newKek`. The bulk ciphertext is unchanged (O(1) in data size).
- `infrastructure/terraform/modules/vault/` deploys Vault on EKS with Kubernetes auth method enabled and KMS auto-unseal. AWS KMS keys have `enable_key_rotation = true`.
- No `packages/vault` package exists. No `VAULT_ADDR` usage anywhere in application code.
- No `encrypted_fields` table exists — Phase 55 creates it as the canonical store for per-tenant DEK envelopes.
- Scheduler job pattern: job definitions live in `packages/scheduler/src/jobs/` (e.g., `dsr-deadline-check.ts`), export a `create*Definition()` factory and a `create*Handler()` factory, and are registered from `packages/scheduler/src/index.ts`. The `apps/worker` process consumes them.

### Compliance Gaps Closed

| Gap | Rule | Current | After Phase 55 |
|-----|------|---------|----------------|
| Secrets from `process.env` only | Rule 5 | ❌ | ✅ Vault-backed |
| No automated key rotation | Rule 1, Rule 5 | ❌ | ✅ 80-day cron trigger |
| No zero-downtime secret refresh | Rule 5 | ❌ | ✅ Polling + callbacks |
| No DEK re-wrap pipeline | Rule 1 | ❌ | ✅ Batch re-wrap with audit |
| No rotation audit trail | Rule 3 | ❌ | ✅ WORM events per batch |

## Architecture

### New Package: `packages/vault`

A single package owns the entire Vault integration surface. Nothing outside this package calls Vault's HTTP API directly. Three exports from `packages/vault/src/index.ts`:

#### `VaultClient`

Authenticates to Vault using the Kubernetes auth method:

1. Reads the pod's service account JWT from `/var/run/secrets/kubernetes.io/serviceaccount/token`.
2. POSTs to `${VAULT_ADDR}/v1/auth/kubernetes/login` with the JWT and role name.
3. Receives a Vault token with a configurable TTL (default 15 min).
4. Renews the token automatically at 80% of TTL via `PUT /v1/auth/token/renew-self`.

In local dev / test (no `VAULT_ADDR` env var), `VaultClient` is a no-op: `get()` returns `undefined`, all methods resolve immediately. The application falls back to `process.env` in this case.

All Vault KV v2 paths are constructed as `${VAULT_ADDR}/v1/${VAULT_MOUNT}/data/${path}`. `VAULT_MOUNT` defaults to `secret`.

Uses Node.js native `fetch` against Vault's stable KV v2 REST API. No third-party Vault npm library.

**Key methods:**
```typescript
class VaultClient {
  async get(path: string): Promise<string | undefined>
  async put(path: string, value: string): Promise<void>
  async getMetadata(path: string): Promise<{ createdTime: Date; version: number }>
}
```

#### `SecretStore` / `initSecretStore(client, keys)`

A module-level singleton that holds the current in-memory secret snapshot.

- `initSecretStore(client, keys)` — called once at startup. Reads all tracked keys from Vault, populates the store. Falls back to `process.env[key]` for any key not found in Vault (dev/test compatibility).
- `secretStore.get(key)` — synchronous read from the in-memory snapshot (no async per-request Vault call).
- `secretStore.onRotate(key, callback)` — registers a callback invoked whenever the polling loop detects a new version for `key`.
- Internal polling loop runs every `VAULT_POLL_INTERVAL_MS` (default 60,000ms). On each tick, fetches current versions, diffs against stored versions, calls `onRotate` callbacks for changed keys, updates the snapshot.

**Startup integration in `apps/api/src/server.ts`:**

```typescript
const vaultClient = new VaultClient();
await initSecretStore(vaultClient, TRACKED_SECRET_KEYS);

// onRotate callbacks — each function is NEW (created in Phase 55).
// They update the relevant module's in-memory state without dropping in-flight requests.
secretStore.onRotate('JWT_PRIVATE_KEY', (val) => configureJwt(val));
secretStore.onRotate('STRIPE_SECRET_KEY', (val) => configureStripe(val));
secretStore.onRotate('ENCRYPTION_MASTER_KEY', (val) => configureCrypto(val));
secretStore.onRotate('TWILIO_AUTH_TOKEN', (val) => configureTwilio(val));
secretStore.onRotate('SENDGRID_API_KEY', (val) => configureSendGrid(val));
secretStore.onRotate('OPENAI_API_KEY', (val) => configureAI(val));
// Note: use the exact key name defined in packages/core/src/config.ts — currently OPENAI_API_KEY.
// If migrated to ANTHROPIC_API_KEY, update both the schema and this registration together.
```

`configureJwt(val)`, `configureCrypto(val)`, etc. are **new single-argument overloads** added to the existing zero-argument `configure*()` functions in `server.ts` as part of Phase 55. Each updates the relevant module's runtime state (e.g., `configureCrypto(val)` reconstructs the `EnvelopeEncryption` instance with the new key and stores it in a module-level variable that all encrypt/decrypt calls reference). These must be designed carefully to be race-condition-safe: the module variable swap is atomic in JavaScript's single-threaded model, so in-flight requests using the old reference complete safely.

**What does NOT hot-reload:** `DATABASE_URL` and `REDIS_URL` — connection pool reconnection on credential change requires a pod restart and is out of scope for Phase 55.

#### `KeyRotationTracker`

```typescript
class KeyRotationTracker {
  async isApproachingExpiry(client: VaultClient, key: string, thresholdDays: number): Promise<boolean>
  async requestNewVersion(client: VaultClient, key: string): Promise<{ version: number; value: string }>
  async getVersion(client: VaultClient, key: string, version: number): Promise<string>
  async markVersionInactive(client: VaultClient, key: string, version: number): Promise<void>
}
```

`isApproachingExpiry` reads `getMetadata(path)` and returns `true` if `(now - createdTime) >= thresholdDays * 86400 * 1000`.

`getVersion(client, key, version)` reads a specific historical version from Vault KV v2 (`/v1/${VAULT_MOUNT}/data/${key}?version=${version}`). Used by the re-wrap pipeline to retrieve the old KEK bytes.

### Database Prerequisites (new in Phase 55)

Two new DB artefacts:

#### `encrypted_fields` table

Stores per-tenant DEK envelopes — the canonical home for wrapped data encryption keys. All field-level encryption in the application writes/reads DEK envelopes from this table.

```sql
CREATE TABLE encrypted_fields (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  resource     TEXT NOT NULL,        -- e.g. 'customer', 'message'
  resource_id  UUID NOT NULL,
  field_name   TEXT NOT NULL,
  dek_envelope JSONB NOT NULL,       -- EncryptedEnvelope (wrappedDek, dekIv, dekAuthTag, keyVersion, iv, authTag, ciphertext)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, resource, resource_id, field_name)
);
CREATE INDEX idx_encrypted_fields_tenant ON encrypted_fields(tenant_id);
```

#### `key_rotation_jobs` table

Concurrency guard and progress tracker for re-wrap jobs.

```sql
CREATE TABLE key_rotation_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name          TEXT NOT NULL,
  old_version       INTEGER NOT NULL,
  new_version       INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'running', -- 'running' | 'completed' | 'failed'
  rows_total        INTEGER,
  rows_done         INTEGER NOT NULL DEFAULT 0,
  last_processed_id UUID,    -- keyset cursor for idempotent resume
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);
```

> **Migration number:** Confirm the correct sequential number against the highest-numbered file in `packages/db/migrations/` at implementation time. Current highest is `0013`. If no other migration is added before Phase 55, use `0014` for `encrypted_fields` and `0015` for `key_rotation_jobs`.

### DEK Re-wrap Pipeline (`apps/worker`)

#### Re-wrap Job Flow

The job lives in `packages/scheduler/src/jobs/key-rotation-check.ts`, following the `dsr-deadline-check.ts` pattern: exports `KEY_ROTATION_CHECK_JOB_ID`, `KEY_ROTATION_CHECK_CRON`, `createKeyRotationCheckDefinition()`, and `createKeyRotationCheckHandler()`. The handler calls into `apps/worker/src/jobs/key-rotation.ts` which contains the actual re-wrap pipeline implementation.

1. `KeyRotationTracker.isApproachingExpiry(client, 'ENCRYPTION_MASTER_KEY', 80)` → if false, exit.
2. Check `key_rotation_jobs` for a row with `status = 'running'` and `key_name = 'ENCRYPTION_MASTER_KEY'` → if found, emit `KEY_ROTATION_ALREADY_RUNNING` warning and exit.
3. Read `oldVersion` from `KeyRotationTracker.getMetadata()`.
4. `KeyRotationTracker.requestNewVersion(client, 'ENCRYPTION_MASTER_KEY')` → receives `{ version: newVersion, value: newKekHex }`.
5. `KeyRotationTracker.getVersion(client, 'ENCRYPTION_MASTER_KEY', oldVersion)` → receives `oldKekHex`.
6. Insert row into `key_rotation_jobs` (status=running, old_version, new_version, last_processed_id=null).
7. Emit WORM audit event: `KEY_ROTATION_STARTED` (key_name, old_version, new_version).
8. Construct `const rewrapper = new EnvelopeEncryption(Buffer.from(oldKekHex, 'hex'), String(oldVersion))` **once, before the pagination loop**. This validates the KEK length (must be 32 bytes) upfront — a malformed key fails fast here rather than inside a transaction mid-job.

9. Page through `encrypted_fields` using **keyset pagination** with `last_processed_id` as cursor. The query branches on the cursor value:
   - First page (`last_processed_id` is null): `SELECT * FROM encrypted_fields ORDER BY id LIMIT 500` (no WHERE clause — do NOT use a zero-UUID sentinel).
   - Subsequent pages: `SELECT * FROM encrypted_fields WHERE id > $lastProcessedId ORDER BY id LIMIT 500`.

   For each page:
   - For each row: validate `row.dek_envelope` against the `EncryptedEnvelope` type (Zod parse or type guard checking `wrappedDek`, `dekIv`, `dekAuthTag`, `keyVersion`, `iv`, `authTag`, `ciphertext` are all present strings). If validation fails, emit a `KEY_ROTATION_ROW_ERROR` audit event with the row `id` (no PHI) and continue to the next row — do NOT abort the page transaction.
   - Call `rewrapper.rewrap(parsedEnvelope, Buffer.from(newKekHex, 'hex'), String(newVersion))`.
   - Write all updated envelopes back in a single transaction.
   - Update `last_processed_id` and `rows_done` on the job row (same transaction).
   - Emit `KEY_ROTATION_BATCH_COMPLETED` audit event (page index, rows in page).
10. On completion: update job row to `status=completed`, `completed_at=now()`.
11. `KeyRotationTracker.markVersionInactive(client, 'ENCRYPTION_MASTER_KEY', oldVersion)` — sets old KEK version to inactive in Vault (NOT deleted; retained 7 years per Rule 3).
12. Emit `KEY_ROTATION_COMPLETED` audit event (total rows, duration ms, old_version → new_version).

**Idempotency:** If the job crashes mid-page, restart reads `last_processed_id` from the job row and resumes from that cursor. Rows with `dek_envelope->>'keyVersion' = newVersion` are already re-wrapped; keyset pagination ensures they are not re-processed regardless of insertions to the table during the job.

**Security:** `oldKekHex` and `newKekHex` are never logged. The audit events record version numbers only, not key material.

#### Rotation Cron

Registered in `packages/scheduler/src/jobs/key-rotation-check.ts` as `KEY_ROTATION_CHECK_JOB_ID = 'key-rotation-check'`, running daily at 02:00 UTC (`KEY_ROTATION_CHECK_CRON = '0 2 * * *'`). Configurable via `KEY_ROTATION_CHECK_CRON` env var. Priority: `high`. Retry policy: 3 retries, 30s base delay, 10 min max.

## File Structure

| File | Change |
|------|--------|
| `packages/vault/src/client.ts` | `VaultClient` — K8s auth, token renewal, get/put/metadata/getVersion |
| `packages/vault/src/secret-store.ts` | `SecretStore` singleton, `initSecretStore`, polling loop |
| `packages/vault/src/key-rotation-tracker.ts` | `KeyRotationTracker` — expiry check, requestNewVersion, getVersion, markVersionInactive |
| `packages/vault/src/index.ts` | Public exports |
| `packages/vault/package.json` | Package manifest (`@ordr/vault`), no Vault npm library dependency |
| `packages/vault/tsconfig.json` | TypeScript config, extends root tsconfig |
| `packages/vault/src/__tests__/client.test.ts` | VaultClient unit tests (mock fetch) |
| `packages/vault/src/__tests__/secret-store.test.ts` | SecretStore unit tests (polling, callbacks, dev fallback) |
| `packages/vault/src/__tests__/key-rotation-tracker.test.ts` | Expiry calculation, no-op in dev |
| `packages/db/src/schema/encrypted-fields.ts` | Drizzle schema for `encrypted_fields` |
| `packages/db/src/schema/key-rotation-jobs.ts` | Drizzle schema for `key_rotation_jobs` |
| `packages/db/migrations/00NN_encrypted_fields.sql` | Migration (confirm N at implementation time) |
| `packages/db/migrations/00NN_key_rotation_jobs.sql` | Migration (confirm N at implementation time) |
| `packages/scheduler/src/jobs/key-rotation-check.ts` | Job definition + handler factory (follows `dsr-deadline-check.ts` pattern) |
| `packages/scheduler/src/index.ts` | Add `key-rotation-check` exports |
| `apps/worker/src/jobs/key-rotation.ts` | Re-wrap pipeline implementation (called by handler) |
| `apps/worker/src/jobs/__tests__/key-rotation.test.ts` | Re-wrap unit tests |
| `apps/api/src/server.ts` | Add `initSecretStore` call + `onRotate` registrations; add single-arg `configure*(val)` overloads |
| `.env.example` | Add `# Vault` section with `VAULT_ADDR`, `VAULT_ROLE`, `VAULT_MOUNT`, `VAULT_POLL_INTERVAL_MS`, `KEY_ROTATION_CHECK_CRON` |
| `packages/core/src/config.ts` | Add optional Zod fields for all 5 Vault vars; add conditional refinement: if `VAULT_ADDR` present → `VAULT_ROLE` required and `VAULT_ADDR` must be a valid URL |

## Testing Strategy

- **`packages/vault` unit tests**: Mock `fetch` with `vi.fn()`. Covers: K8s auth flow, token renewal before expiry, `get()` returns `undefined` on 404, polling diff triggers `onRotate`, no-op when `VAULT_ADDR` absent.
- **`KeyRotationTracker` tests**: Mock `VaultClient`. Covers: `isApproachingExpiry` true at threshold, false one day before, `getVersion` returns hex string.
- **Re-wrap pipeline tests**: Use in-memory arrays instead of a live DB. Covers: single-page job completes, multi-page with simulated crash and keyset resume (idempotency), second concurrent job blocked by `status=running` row, audit events emitted in correct order, key material never appears in log output.
- **No live Vault or DB in CI** — same pattern as Redis rate limiter.

## Environment Variables

| Variable | Required in prod | Default | Description |
|----------|-----------------|---------|-------------|
| `VAULT_ADDR` | Yes | — | Vault server URL (e.g., `https://vault.internal:8200`) |
| `VAULT_ROLE` | Yes | — | Kubernetes auth role name |
| `VAULT_MOUNT` | No | `secret` | KV v2 mount path |
| `VAULT_POLL_INTERVAL_MS` | No | `60000` | Secret polling interval |
| `KEY_ROTATION_CHECK_CRON` | No | `0 2 * * *` | Cron schedule for rotation check |

When `VAULT_ADDR` is absent, all Vault operations are no-ops. No startup failure.

## Compliance Mapping

| Rule | Requirement | How addressed |
|------|-------------|---------------|
| Rule 1 | HSM-backed key management | Vault + AWS KMS auto-unseal (existing) |
| Rule 1 | Automated 90-day key rotation cycle | Cron triggers at 80 days; hard limit is 90 |
| Rule 1 | Zero-downtime rotation | Polling + `onRotate` callbacks; ≤60s lag |
| Rule 3 | WORM audit trail for key rotation | `KEY_ROTATION_STARTED/BATCH_COMPLETED/COMPLETED` events |
| Rule 5 | Secrets from external secret manager | `initSecretStore` reads from Vault |
| Rule 5 | Automated rotation, short-lived leases | Vault token TTL 15 min, auto-renewed |
| Rule 5 | Rotation audit-logged | Via `onRotate` callback chain + WORM events |
| SOC 2 CC6.1 | Logical access controls on secrets | Vault K8s auth + least-privilege Vault policies |
| SOC 2 CC6.6 | Protection against unauthorized access | Secrets never in `process.env` in production |

## Out of Scope

- `DATABASE_URL` / `REDIS_URL` hot-reload (requires connection pool reconnect — Phase 56+)
- Vault policy management via Terraform (already handled in `infrastructure/terraform/modules/vault/`)
- Multi-key rotation (only `ENCRYPTION_MASTER_KEY` DEK re-wrap in Phase 55; other secrets rotate in-place via `onRotate` without re-encryption)
- Vault Enterprise features (namespaces, Sentinel policies) — using open-source Vault
- Per-tenant KEK isolation — all tenants share one application-layer KEK; per-tenant KEKs are a future phase
