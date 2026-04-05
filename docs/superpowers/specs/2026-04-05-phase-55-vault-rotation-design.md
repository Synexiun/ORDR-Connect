# Phase 55 — Vault Secret Rotation Design

**Date:** 2026-04-05
**Status:** Approved

## Goal

Make secret rotation operational for SOC 2 Type II compliance. The Vault infrastructure is already deployed (EKS HA Raft, KMS auto-unseal, CloudWatch audit logs) but the application reads secrets from `process.env` only, with no dynamic refresh and no DEK rotation pipeline. Phase 55 closes three gaps: Vault-backed secret loading, zero-downtime hot-reload, and automated 90-day DEK re-wrap.

## Context

### Current State

- `apps/api/src/server.ts` reads all secrets from `process.env` via `loadConfig()` (Zod schema validation) at startup — no Vault client, no refresh.
- `packages/crypto/src/envelope.ts` has `rewrap(envelope, newKek, newKeyVersion)` — the cryptographic primitive for DEK rotation exists; it just has no orchestration layer.
- `infrastructure/terraform/modules/vault/` deploys Vault on EKS with Kubernetes auth method enabled and KMS auto-unseal. AWS KMS keys have `enable_key_rotation = true`.
- No `packages/vault` package exists. No `VAULT_ADDR` usage anywhere in application code.

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

In local dev / test (no `VAULT_ADDR` env var), `VaultClient` is a no-op: `get()` returns `undefined`, all methods resolve immediately. The application falls back to `process.env` in this case — no code change needed in callers.

**Key methods:**
```typescript
class VaultClient {
  async get(path: string): Promise<string | undefined>
  async put(path: string, value: string): Promise<void>
  async getMetadata(path: string): Promise<{ createdTime: Date; version: number }>
  async listVersions(path: string): Promise<{ version: number; createdTime: Date }[]>
}
```

No third-party Vault npm library. Uses Node.js native `fetch` against Vault's stable KV v2 REST API.

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

secretStore.onRotate('JWT_PRIVATE_KEY', (val) => configureJwt(val));
secretStore.onRotate('STRIPE_SECRET_KEY', (val) => configureStripe(val));
secretStore.onRotate('ENCRYPTION_MASTER_KEY', (val) => configureCrypto(val));
secretStore.onRotate('TWILIO_AUTH_TOKEN', (val) => configureTwilio(val));
secretStore.onRotate('SENDGRID_API_KEY', (val) => configureSendGrid(val));
secretStore.onRotate('ANTHROPIC_API_KEY', (val) => configureAI(val));
```

**What does NOT hot-reload:** `DATABASE_URL` and `REDIS_URL` — connection pool reconnection on credential change requires a pod restart and is out of scope for Phase 55.

#### `KeyRotationTracker`

```typescript
class KeyRotationTracker {
  async isApproachingExpiry(client: VaultClient, key: string, thresholdDays: number): Promise<boolean>
  async requestNewVersion(client: VaultClient, key: string): Promise<{ version: number; value: string }>
  async markVersionInactive(client: VaultClient, key: string, version: number): Promise<void>
}
```

`isApproachingExpiry` reads `getMetadata(path)` and returns `true` if `(now - createdTime) >= thresholdDays * 86400 * 1000`.

### DEK Re-wrap Pipeline (`apps/worker`)

#### Database Prerequisites

A new migration adds:
- `key_rotation_jobs` table — concurrency guard (one active job at a time per key).

```sql
CREATE TABLE key_rotation_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_name     TEXT NOT NULL,
  old_version  INTEGER NOT NULL,
  new_version  INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running', -- 'running' | 'completed' | 'failed'
  rows_total   INTEGER,
  rows_done    INTEGER NOT NULL DEFAULT 0,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

The `encrypted_fields` table (existing, stores per-tenant DEKs as envelope ciphertexts) is queried in pages of 500 rows.

#### Re-wrap Job Flow

1. `KeyRotationTracker.isApproachingExpiry(client, 'ENCRYPTION_MASTER_KEY', 80)` → if false, exit.
2. Check `key_rotation_jobs` for a row with `status = 'running'` and `key_name = 'ENCRYPTION_MASTER_KEY'` → if found, emit `KEY_ROTATION_ALREADY_RUNNING` warning and exit.
3. Request new KEK version from Vault via `KeyRotationTracker.requestNewVersion()`.
4. Insert row into `key_rotation_jobs` (status=running, old_version, new_version).
5. Emit WORM audit event: `KEY_ROTATION_STARTED`.
6. Page through `encrypted_fields` (500 rows/page):
   - For each row: `envelope.rewrap(row.dek_envelope, newKek, newVersion)`
   - Write updated envelope back in the same transaction as the page read.
   - Update `rows_done` on the job row.
   - Emit `KEY_ROTATION_BATCH_COMPLETED` audit event with page index and row count.
7. On completion: update job row to `status=completed`, `completed_at=now()`.
8. `KeyRotationTracker.markVersionInactive()` — sets old KEK version to inactive in Vault (NOT deleted; retained 7 years per Rule 3).
9. Emit `KEY_ROTATION_COMPLETED` audit event with total rows, duration, old/new version numbers.

**Idempotency:** If the job crashes mid-page and restarts, it re-reads the job row to find `rows_done`, skips already-processed pages (identified by comparing the envelope's embedded `keyVersion` field against `new_version`), and resumes from the next unprocessed page.

#### Rotation Cron

Registered in `apps/worker` scheduler as `checkKeyRotation`, running daily at 02:00 UTC. Configurable via `KEY_ROTATION_CHECK_CRON` env var. Uses the existing `packages/scheduler` infrastructure.

## File Structure

| File | Change |
|------|--------|
| `packages/vault/src/client.ts` | `VaultClient` class — K8s auth, token renewal, get/put/metadata |
| `packages/vault/src/secret-store.ts` | `SecretStore` singleton + `initSecretStore` + polling loop |
| `packages/vault/src/key-rotation-tracker.ts` | `KeyRotationTracker` — expiry check, new version request, mark inactive |
| `packages/vault/src/index.ts` | Public exports |
| `packages/vault/package.json` | Package manifest (`@ordr/vault`) |
| `packages/vault/tsconfig.json` | TypeScript config |
| `packages/vault/src/__tests__/client.test.ts` | VaultClient unit tests (mock fetch) |
| `packages/vault/src/__tests__/secret-store.test.ts` | SecretStore unit tests (polling, callbacks, dev fallback) |
| `packages/vault/src/__tests__/key-rotation-tracker.test.ts` | Expiry calculation, no-op in dev |
| `packages/db/src/schema/key-rotation-jobs.ts` | Drizzle schema for `key_rotation_jobs` |
| `packages/db/migrations/0014_key_rotation_jobs.sql` | Migration |
| `apps/worker/src/jobs/key-rotation.ts` | Re-wrap pipeline — page loop, concurrency guard, audit events |
| `apps/worker/src/jobs/__tests__/key-rotation.test.ts` | Re-wrap unit tests (in-memory DB mock, idempotency, concurrency guard) |
| `apps/api/src/server.ts` | Add `initSecretStore` call + `onRotate` registrations |

## Testing Strategy

- **`packages/vault` unit tests**: Mock `fetch` using `vi.fn()`. Tests cover: successful K8s auth flow, token renewal before expiry, `get()` returns `undefined` on 404, polling diff triggers `onRotate`, no-op when `VAULT_ADDR` absent.
- **`KeyRotationTracker` tests**: Mock `VaultClient.getMetadata()`. Tests cover: `isApproachingExpiry` returns true at exactly threshold, false one day before, false when Vault is no-op.
- **Re-wrap pipeline tests**: Use in-memory arrays instead of a live DB. Tests cover: single-page job completes, multi-page job with simulated crash and resume (idempotency), second concurrent job is blocked, audit events emitted in correct order and count.
- **No live Vault or DB in CI**: Same pattern as Redis rate limiter — no integration tests requiring external services.

## Environment Variables

| Variable | Required in prod | Default | Description |
|----------|-----------------|---------|-------------|
| `VAULT_ADDR` | Yes | — | Vault server URL (e.g., `https://vault.internal:8200`) |
| `VAULT_ROLE` | Yes | — | Kubernetes auth role name |
| `VAULT_POLL_INTERVAL_MS` | No | `60000` | Secret polling interval |
| `KEY_ROTATION_CHECK_CRON` | No | `0 2 * * *` | Cron schedule for rotation check |

When `VAULT_ADDR` is absent, the system is in dev/no-op mode. No startup failure.

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
