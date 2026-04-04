# Phase 53 — Developer Portal Completion Design

**Goal:** Complete the Developer Portal by adding webhook management (CRUD), agent submission pipeline (manifest validation → marketplace), and sandbox create/destroy UI — turning the existing scaffolded console into a fully functional developer surface.

**Architecture:** Two new API route files + one new DB table + wiring of three existing UI sections to real endpoints. No new pages. All surfaces follow established patterns from `developers.ts` (dependency injection, `requireAuth()`, Zod validation, WORM audit logging).

**Tech Stack:** Hono routes, Drizzle ORM, `@ordr/sdk` manifest validator, AES-256-GCM field encryption for HMAC secrets (`FieldEncryptor.encryptField()` — synchronous), React state wiring in `DeveloperConsole.tsx`.

---

## Error Response Format (Rule 7)

All endpoints use this unified shape:
```typescript
// Non-validation errors (404, 401, 429, 500):
{ success: false, message: "Human-readable safe message", requestId: "req_..." }

// Validation errors (400 — Zod):
{ success: false, message: "Validation failed", errors: { field: string[] }, requestId: "req_..." }

// Manifest validation failure (422):
{ success: false, message: "Manifest validation failed", errors: string[], warnings: string[], requestId: "req_..." }

// Limit exceeded (422):
{ success: false, message: "Webhook limit reached (max 10 active)", requestId: "req_..." }
```
Stack traces and internal paths are never included. `requestId` is always present (Rule 7).

---

## Identity Mapping

`auth.userId` (from the JWT `sub` claim) is used directly as `developerId` / `publisherId` throughout these routes. This is the established pattern in `developers.ts` — the developer onboarding `POST /register` sets `developer_accounts.id = UUID` and the resulting JWT embeds that same UUID as `sub`. No additional guard is needed beyond `requireAuth()` which validates the JWT.

---

## Section 1: Data Layer

### New table: `developer_webhooks`

Migration: `packages/db/migrations/0013_developer_webhooks.sql`
Schema: `packages/db/src/schema/developer-webhooks.ts`

Columns:
| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `defaultRandom()` |
| `developer_id` | `uuid` FK → `developer_accounts.id` | `ON DELETE CASCADE` |
| `url` | `text` | `https://` scheme enforced, max 2048 chars, SSRF-validated |
| `events` | `text[]` | Array of subscribed event type strings (max 20 per webhook) |
| `hmac_secret_encrypted` | `text` | AES-256-GCM encrypted 32-byte random secret (Rule 1) |
| `active` | `boolean` | Default `true` |
| `last_triggered_at` | `timestamptz` | Nullable — updated on delivery (future phase) |
| `created_at` | `timestamptz` | `defaultNow()` |
| `updated_at` | `timestamptz` | Updated on every mutation via Drizzle `.$onUpdate()` |

Indexes: `developer_id`, `active`.

**Per-account webhook limit:** Maximum 10 active (`active = true`) webhooks per developer account. `countActiveWebhooks(developerId)` queries `WHERE developer_id = ? AND active = true`. Limit check is app-layer pre-check (acceptable for max-10 scale; no DB partial index needed). Race condition risk is negligible at this limit — a developer hitting exact-10 concurrently creating two webhooks at most gets 11 momentarily; the next POST will then see 11 and block. This is an acceptable edge case.

Schema `updated_at` column uses Drizzle `.$onUpdate(() => new Date())` to automatically timestamp mutations.

**No `developer_webhooks` table exists today** — this is the only schema addition in Phase 53. The marketplace `publisher_id` FK already links agents to developers; no new agent table needed.

### Marketplace table (existing — no change)

`marketplace_agents.publisher_id` (FK → `developer_accounts.id`) is already present. "My agents" queries filter on this column. DB enum values: `pending | published | suspended | deprecated`. The display label `'review'` in the UI maps to DB value `'pending'` via the existing `agentStatusMap` in `DeveloperConsole.tsx`.

---

## Section 2: API

### `apps/api/src/routes/developer-webhooks.ts`

Dependency-injected — `configureWebhookRoutes(deps: WebhookDeps)` sets module-level `deps` (same pattern as `configureDeveloperRoutes` in `developers.ts`).

**Dependencies:**
```typescript
interface WebhookDeps {
  readonly auditLogger: AuditLogger;
  readonly createWebhook: (data: {
    developerId: string;
    url: string;
    events: string[];
    hmacSecretEncrypted: string;
  }) => Promise<WebhookRecord>;
  readonly listWebhooks: (developerId: string) => Promise<WebhookRecord[]>;
  readonly countActiveWebhooks: (developerId: string) => Promise<number>;
  readonly findWebhook: (developerId: string, webhookId: string) => Promise<WebhookRecord | null>;
  readonly deleteWebhook: (webhookId: string) => Promise<void>; // ownership pre-verified via findWebhook
  readonly toggleWebhook: (webhookId: string, active: boolean) => Promise<WebhookRecord>;
  readonly fieldEncryptor: FieldEncryptor; // synchronous encryptField(fieldName, value): string
}
```

**`WebhookRecord` type:**
```typescript
interface WebhookRecord {
  readonly id: string;
  readonly developerId: string;
  readonly url: string;
  readonly events: string[];
  readonly hmacSecretEncrypted: string; // NEVER included in API responses
  readonly active: boolean;
  readonly lastTriggeredAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
```

**Rate limits:** `POST /v1/developers/webhooks` and all mutating endpoints use the platform default rate limiting middleware (already applied globally in `apps/api/src/index.ts`). No additional per-endpoint override needed.

**Request size limit:** Default 1MB cap applies per Rule 4 (global middleware).

**Endpoints:**

`GET /v1/developers/webhooks` — requireAuth()
- Returns: `{ id, url, events, active, lastTriggeredAt, createdAt }[]`
- `hmacSecretEncrypted` is NEVER included in any response field

`POST /v1/developers/webhooks` — requireAuth()
- Input (Zod): `{ url: string, events: string[] }`
  - `url`: must be `https://` scheme (Zod `.url().startsWith('https://')`), max 2048 chars, SSRF-blocked (see SSRF section below)
  - `events`: min length 1, max length 20, each element must be a member of `DELIVERABLE_EVENTS`
- **SSRF protection:** Implemented as a Zod `.refine()` async validator. After URL parse, `dns.lookup(hostname, { timeout: 5000 })` resolves the hostname. Reject (fail closed) if: DNS resolution errors/times out; or resolved IP is in: `127.x.x.x`, `::1`, `10.x.x.x`, `172.16–31.x.x`, `192.168.x.x`, `169.254.x.x`, `0.0.0.0`; or hostname matches `.internal`, `.local`, `.localhost`. DNS errors are treated as blocked — never fail open.
- **Webhook limit:** Check `countActiveWebhooks(userId)` — reject with 422 if count ≥ 10
- Generates random 32-byte HMAC secret: `crypto.randomBytes(32).toString('hex')`
- Encrypts: `deps.fieldEncryptor.encryptField('hmac_secret', rawSecret)` (synchronous)
- Stores encrypted value in `hmac_secret_encrypted` column
- Response (HTTP 201) includes raw secret ONCE:
  ```json
  { "success": true, "data": { "id": "...", "url": "...", "events": [...], "active": true, "hmacSecret": "<raw 64-char hex>", "createdAt": "..." } }
  ```
- `hmacSecret` only appears in this 201 response — never again
- Audit event: `data.created` on resource `developer_webhooks`

`DELETE /v1/developers/webhooks/:webhookId` — requireAuth()
- Ownership check: `findWebhook(userId, webhookId)` — queries `WHERE id = ? AND developer_id = ?`. Returns `null` if not found OR if owned by a different developer (indistinguishable — both return 404 to prevent enumeration)
- Then: `deleteWebhook(webhookId)` — **hard delete** (permanent row removal). Ownership already verified.
- Audit event logged BEFORE deletion: `{ webhookId, developerId, url, timestamp }` (Rule 3 — log before destroy)
- Response: `{ "success": true }` HTTP 200
- Error responses include `requestId` (Rule 7)

`PATCH /v1/developers/webhooks/:webhookId/toggle` — requireAuth()
- Input (Zod): `{ active: boolean }`
- Ownership check: `findWebhook(userId, webhookId)` — 404 if null
- Then: `toggleWebhook(webhookId, active)` — returns updated record
- Response excludes `hmacSecretEncrypted`
- Includes `requestId` in error responses
- Audit event: `data.updated` on resource `developer_webhooks`

**DELIVERABLE_EVENTS enum** — defined in `packages/events/src/deliverable-events.ts` and imported by both the route and the Zod input schema. Adding new deliverable events in future phases requires updating that file only.

```typescript
// packages/events/src/deliverable-events.ts
export const DELIVERABLE_EVENTS = [
  'customer.created', 'customer.updated',
  'interaction.logged',
  'agent.triggered', 'agent.action_executed', 'agent.completed',
  'ticket.created', 'ticket.resolved',
  'dsr.approved', 'dsr.completed',
  'compliance.alert',
  'integration.webhook_received',
] as const;
```

**SECURITY:**
- HMAC secret: AES-256-GCM encrypted via `FieldEncryptor.encryptField('hmac_secret', rawSecret)` before storage (Rule 1)
- Raw secret returned once at creation — never re-exposed (Rule 2, Rule 5)
- `hmacSecretEncrypted` never in any response body (Rule 5)
- `https://` scheme enforced + SSRF blocklist on URL input (Rule 4)
- Max 10 webhooks per developer (Rule 4 — DoS prevention)
- Ownership validated via `findWebhook(userId, webhookId)` on all mutations (Rule 2)
- All state changes audit-logged with WORM semantics (Rule 3)
- All error responses include `requestId` correlation ID (Rule 7)

---

### `apps/api/src/routes/developer-agents.ts`

`configureAgentRoutes(deps: AgentDeps)` sets module-level `deps` — same dependency-injection pattern as `developers.ts` and `developer-webhooks.ts`.

**Dependencies:**
```typescript
interface AgentDeps {
  readonly auditLogger: AuditLogger;
  readonly listAgentsByPublisher: (publisherId: string) => Promise<AgentListItem[]>;
  readonly createMarketplaceListing: (data: {
    publisherId: string;
    name: string;
    version: string;
    description: string;
    author: string;
    license: string;
    manifest: Record<string, unknown>;
    packageHash: string;
  }) => Promise<AgentListItem>;
}

interface AgentListItem {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly status: 'pending' | 'published' | 'suspended' | 'deprecated';
  readonly installCount: number;
  readonly createdAt: Date;
}
```

**Endpoints:**

`GET /v1/developers/agents` — requireAuth()
- Calls `listAgentsByPublisher(auth.userId)`
- Returns: `{ id, name, version, status, installCount, createdAt }[]`
- HTTP 200

`POST /v1/developers/agents/submit` — requireAuth()
- Input (Zod):
  ```typescript
  {
    manifest: z.record(z.unknown()),         // max 64KB enforced by 1MB global limit
    packageHash: z.string().regex(/^[a-f0-9]{64}$/, 'packageHash must be 64 lowercase hex chars'),
    description: z.string().min(1).max(2000),
  }
  ```
  - `packageHash` Zod regex enforces lowercase hex only (rejects uppercase — implementers should document this for callers)
- **Manifest validation:** `validateManifest(manifest)` from `@ordr/sdk` — validates against `agentManifestSchema` (Zod strict mode, rejects unknown top-level keys)
  - If `result.valid === false`: HTTP 422 with `{ success: false, errors: result.errors, warnings: result.warnings, requestId }`
  - No DB write on invalid manifest
- If valid: call `createMarketplaceListing({ publisherId: auth.userId, name: manifest.name, version: manifest.version, description, author: manifest.author, license: manifest.license, manifest, packageHash })`
- DB status written: `'pending'`
- Audit event: `data.created` on resource `marketplace_agents`
- HTTP 201: `{ success: true, data: { id, name, version, status: 'pending', installCount: 0, createdAt } }`
- All error responses include `requestId` (Rule 7)

**Data classification:** `description` field is classified as `INTERNAL` (Rule 6). Audit events for agent submission log `{ publisherId, agentId, status, timestamp }` only — manifest and description are excluded from audit details. Error responses never echo the `description` value. No field-level encryption required.

**SECURITY:**
- Manifest validation is a hard gate — no listing created for invalid manifests (Rule 9)
- `agentManifestSchema` uses Zod strict mode — unknown top-level keys rejected (Rule 4)
- `packageHash` must be lowercase hex SHA-256 — normalized and validated by Zod regex (Rule 4)
- Publisher scoped to `auth.userId` — cannot submit on behalf of other developers (Rule 2)
- All error responses include `requestId` (Rule 7)

---

### `apps/api/src/index.ts` (modified)

At startup, call the configure functions and mount the routers:
```typescript
import { developerWebhooksRouter, configureWebhookRoutes } from './routes/developer-webhooks.js';
import { developerAgentsRouter, configureAgentRoutes } from './routes/developer-agents.js';

// Called once at startup (alongside existing configureDeveloperRoutes, configureDevUsageRoute, etc.)
configureWebhookRoutes({ auditLogger, fieldEncryptor, createWebhook, listWebhooks, countActiveWebhooks, findWebhook, deleteWebhook, toggleWebhook });
configureAgentRoutes({ auditLogger, listAgentsByPublisher, createMarketplaceListing });

app.route('/v1/developers/webhooks', developerWebhooksRouter);
app.route('/v1/developers/agents', developerAgentsRouter);
```

---

## Section 3: Client API (`developer-api.ts`)

Six new typed functions added to `apps/web/src/lib/developer-api.ts`:

```typescript
// ── Webhooks ───────────────────────────────────────────────────────────

export interface WebhookItem {
  readonly id: string;
  readonly url: string;
  readonly events: string[];
  readonly active: boolean;
  readonly lastTriggeredAt: string | null;
  readonly createdAt: string;
}

export interface WebhookCreated extends WebhookItem {
  /** HMAC secret — shown ONCE, never stored client-side. */
  readonly hmacSecret: string;
}

export function listWebhooks(): Promise<{ readonly success: true; readonly data: WebhookItem[] }> { ... }

export function createWebhook(body: {
  readonly url: string;
  readonly events: string[];
}): Promise<{ readonly success: true; readonly data: WebhookCreated }> { ... }

export async function deleteWebhook(webhookId: string): Promise<void> { ... }

export function toggleWebhook(webhookId: string, active: boolean): Promise<{
  readonly success: true;
  readonly data: WebhookItem;
}> { ... }

// ── My Agents ──────────────────────────────────────────────────────────

export interface MyAgent {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly status: 'pending' | 'published' | 'suspended' | 'deprecated';
  readonly installCount: number;
  readonly createdAt: string;
}

export function listMyAgents(): Promise<{ readonly success: true; readonly data: MyAgent[] }> { ... }

export function submitAgent(body: {
  readonly manifest: Record<string, unknown>;
  readonly packageHash: string;
  readonly description: string;
}): Promise<{ readonly success: true; readonly data: MyAgent }> { ... }
```

---

## Section 4: UI (`DeveloperConsole.tsx`)

Three wiring changes within the existing component — no new pages or components.

### 4a. Webhooks section

**Current:** `const [webhooks] = useState(mockWebhooks)` — static mock, "Add Webhook" button is a no-op.

**After:**
- Add `webhooks` state initialized to `[]` (empty, not mock fallback — real data or empty on error with error toast)
- Add `listWebhooks()` to `fetchData()` — on error, set `webhooks` to `[]` and show an error notification (not mock data)
- "Add Webhook" opens a modal with:
  - URL input (text, required, `https://` prefix hint)
  - Multi-checkbox for event types grouped by category:
    - Customer: `customer.created`, `customer.updated`
    - Agent: `agent.triggered`, `agent.action_executed`, `agent.completed`
    - Ticket: `ticket.created`, `ticket.resolved`
    - Compliance: `compliance.alert`
    - DSR: `dsr.approved`, `dsr.completed`
    - Integration: `integration.webhook_received`
  - On success: close add modal, show HMAC secret in amber "store it now" modal (same styling as raw API key display — amber warning banner, monospace key, copy button, "shown once" text)
- Each webhook row gets:
  - Delete button (`Trash2` icon, `variant="danger"`) — calls `deleteWebhook(wh.id)`, filters row from state
  - Active toggle (inline `Badge` click to call `toggleWebhook(wh.id, !wh.active)`)

### 4b. Published Agents section

**Current:** Pulls from `listMarketplaceAgents({ pageSize: 20 })` — shows all marketplace agents, not this developer's.

**After:**
- Replace `listMarketplaceAgents()` with `listMyAgents()` in `fetchData()`
- Remove the `adaptPublishedAgent` adapter (type now matches directly)
- `status: 'pending'` displays with `'review'` display label — wire through existing `agentStatusMap` (`pending → 'review'`)
- Add "Submit Agent" button in Card `actions` prop
- Submit modal:
  - Manifest JSON textarea (required, placeholder: valid JSON object)
  - Package hash input (64 lowercase hex chars)
  - Description textarea (max 2000 chars)
  - "Submit" button calls `submitAgent()` — on 422 response, parse `errors[]` and render as a bulleted error list inside the modal (not a toast — user needs to fix the manifest)
  - On success: close modal, prepend new agent to `agents` state with its returned data
- Empty state: if `agents.length === 0`, show "No agents submitted yet" with "Submit Agent" call-to-action button

### 4c. Sandbox section

**Current:** Read-only list — no create or destroy buttons.

**After:**
- Add "New Sandbox" button (calls existing `createSandbox()` from `developer-api.ts`):
  - Modal with name input (required) + seed profile dropdown (`minimal` / `collections` / `healthcare`)
  - On success: prepend new sandbox to state
- Add "Destroy" button per `active` sandbox row only (calls existing `destroySandbox()`) — filters destroyed sandbox from state on success
- Both functions already exist in `developer-api.ts` — this is pure UI wiring

---

## Section 5: Tests

### `apps/api/src/__tests__/developer-webhooks.test.ts` (new)

Tests (all require mocked auth context + mocked `WebhookDeps`):

1. `GET /v1/developers/webhooks` — 200, returns list; asserts `hmacSecretEncrypted` is NOT in response body
2. `POST /v1/developers/webhooks` — valid https URL + valid events → 201; raw `hmacSecret` in response
3. `POST /v1/developers/webhooks` — `http://` URL (not https) → 400
4. `POST /v1/developers/webhooks` — private IP URL (`http://192.168.1.1/hook`) → 400 (SSRF blocked)
5. `POST /v1/developers/webhooks` — unknown event type → 400
6. `POST /v1/developers/webhooks` — empty events array → 400
7. `POST /v1/developers/webhooks` — at webhook limit (≥10 active) → 422
8. `DELETE /v1/developers/webhooks/:id` — owned webhook → 200; webhook no longer appears in subsequent GET
9. `DELETE /v1/developers/webhooks/:id` — webhook owned by different developer (same valid ID) → 404 (indistinguishable from not-found)
10. `PATCH /v1/developers/webhooks/:id/toggle` — toggles active state; asserts `hmacSecretEncrypted` NOT in response
11. `PATCH /v1/developers/webhooks/:id/toggle` — unowned → 404

### `apps/api/src/__tests__/developer-agents.test.ts` (new)

Tests:

1. `GET /v1/developers/agents` — 200; returns only agents where publisherId matches auth.userId (not other developers' agents)
2. `POST /v1/developers/agents/submit` — valid manifest + lowercase 64-char packageHash → 201; response has `status: 'pending'`
3. `POST /v1/developers/agents/submit` — invalid manifest (fails `validateManifest`) → 422 with `errors` array
4. `POST /v1/developers/agents/submit` — `packageHash` uppercase hex (e.g. `ABCDEF...`) → 400 (Zod regex rejects)
5. `POST /v1/developers/agents/submit` — `packageHash` wrong length (e.g. 63 chars) → 400
6. `POST /v1/developers/agents/submit` — invalid manifest → `createMarketplaceListing` NOT called (assert mock not invoked)

### `apps/web/src/__tests__/DeveloperConsole.test.tsx` (extend)

Add smoke tests:
- Webhook modal renders when "Add Webhook" clicked; `createWebhook` is called with correct args on submit
- HMAC secret display modal shows after successful webhook creation
- Agent submit modal renders; shows validation error list on 422 response
- "Destroy" button visible for active sandboxes; `destroySandbox` called on click
- "New Sandbox" button opens create modal; `createSandbox` called on submit

---

## File Map

| Action | File |
|--------|------|
| Create | `packages/events/src/deliverable-events.ts` |
| Modify | `packages/events/src/index.ts` |
| Create | `packages/db/src/schema/developer-webhooks.ts` |
| Create | `packages/db/migrations/0013_developer_webhooks.sql` |
| Modify | `packages/db/src/schema/index.ts` |
| Modify | `packages/db/src/index.ts` |
| Create | `packages/db/src/queries/developer-webhooks.ts` (data access layer — implements WebhookDeps fns) |
| Create | `apps/api/src/routes/developer-webhooks.ts` |
| Create | `apps/api/src/routes/developer-agents.ts` |
| Modify | `apps/api/src/index.ts` |
| Modify | `apps/web/src/lib/developer-api.ts` |
| Modify | `apps/web/src/pages/DeveloperConsole.tsx` |
| Create | `apps/api/src/__tests__/developer-webhooks.test.ts` |
| Create | `apps/api/src/__tests__/developer-agents.test.ts` |
| Modify | `apps/web/src/__tests__/DeveloperConsole.test.tsx` |

---

## Compliance Notes

- **Rule 1 (Encryption):** HMAC secrets encrypted AES-256-GCM via `FieldEncryptor.encryptField('hmac_secret', rawSecret)` before storage; synchronous; key derived per-field via HKDF
- **Rule 2 (Auth):** All endpoints behind `requireAuth()`; ownership verified via `findWebhook(userId, webhookId)` on all webhook mutations; agent listing scoped to `auth.userId`
- **Rule 3 (Audit):** All state changes (create, delete, toggle, agent submit) produce WORM audit events with `tenantId: 'developer-portal'`. Deletion is audited BEFORE the row is hard-deleted.
- **Rule 4 (Validation):** Zod strict on all inputs; `https://` scheme enforced; SSRF blocklist on webhook URLs; max 10 webhooks per account; `agentManifestSchema` strict mode; `packageHash` lowercase hex regex
- **Rule 5 (Secrets):** Raw HMAC secret returned once at creation, excluded from all other responses; `hmacSecretEncrypted` column excluded from all API response shapes
- **Rule 6 (Data classification):** `description` on agent submission classified INTERNAL — not logged in audit details, not in error responses
- **Rule 7 (Error handling):** All error responses include `requestId` correlation ID; no stack traces to clients; 422 manifest validation errors expose only `result.errors` from `@ordr/sdk` (no internal paths)
- **Rule 9 (Agent safety):** `validateManifest()` is a hard gate — DB write blocked on any invalid manifest; `agentManifestSchema` strict mode prevents unknown-key injection
