# Phase 53 — Developer Portal Completion Design

**Goal:** Complete the Developer Portal by adding webhook management (CRUD), agent submission pipeline (manifest validation → marketplace), and sandbox create/destroy UI — turning the existing scaffolded console into a fully functional developer surface.

**Architecture:** Two new API route files + one new DB table + wiring of three existing UI sections to real endpoints. No new pages. All surfaces follow established patterns from `developers.ts` (dependency injection, `requireAuth()`, Zod validation, WORM audit logging).

**Tech Stack:** Hono routes, Drizzle ORM, `@ordr/sdk` manifest validator, AES-256-GCM field encryption for HMAC secrets, React state wiring in `DeveloperConsole.tsx`.

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
| `url` | `text` | Max 2048 chars, validated as URL |
| `events` | `text[]` | Array of subscribed event type strings |
| `hmac_secret_encrypted` | `text` | AES-256-GCM encrypted 32-byte random secret (Rule 1) |
| `active` | `boolean` | Default `true` |
| `last_triggered_at` | `timestamptz` | Nullable — updated on delivery (future phase) |
| `created_at` | `timestamptz` | `defaultNow()` |

Indexes: `developer_id`, `active`.

**No `developer_webhooks` table exists today** — this is the only schema addition in Phase 53. The marketplace `publisher_id` FK already links agents to developers; no new agent table needed.

### Marketplace table (existing — no change)

`marketplace_agents.publisher_id` (FK → `developer_accounts.id`) is already present. "My agents" queries filter on this column.

---

## Section 2: API

### `apps/api/src/routes/developer-webhooks.ts`

Dependency-injected (same pattern as `developers.ts`). Exported `configureWebhookRoutes(deps)` function sets module-level `deps`.

**Dependencies:**
```typescript
interface WebhookDeps {
  readonly auditLogger: AuditLogger;
  readonly createWebhook: (data: { developerId, url, events, hmacSecretEncrypted }) => Promise<WebhookRecord>;
  readonly listWebhooks: (developerId: string) => Promise<WebhookRecord[]>;
  readonly findWebhook: (developerId: string, webhookId: string) => Promise<WebhookRecord | null>;
  readonly deleteWebhook: (developerId: string, webhookId: string) => Promise<boolean>;
  readonly toggleWebhook: (developerId: string, webhookId: string, active: boolean) => Promise<WebhookRecord | null>;
  readonly fieldEncryptor: { encrypt: (plain: string) => string };
}
```

**Endpoints:**

`GET /v1/developers/webhooks` — requireAuth()
- Returns: `{ id, url, events, active, lastTriggeredAt, createdAt }[]`
- Never returns `hmacSecretEncrypted`

`POST /v1/developers/webhooks` — requireAuth()
- Input: `{ url: string (URL, max 2048), events: string[] (min 1, max 20, each must be in DELIVERABLE_EVENTS enum) }`
- Generates random 32-byte HMAC secret (`crypto.randomBytes(32).toString('hex')`)
- Encrypts with `deps.fieldEncryptor.encrypt()` before storage
- Returns raw secret ONCE in response (amber "store it now" UX same as API keys)
- Audit event: `data.created` on `developer_webhooks`
- HTTP 201

`DELETE /v1/developers/webhooks/:webhookId` — requireAuth()
- Ownership check: `findWebhook(userId, webhookId)` — 404 if not found or not owned
- Audit event: `data.deleted` on `developer_webhooks`
- HTTP 200

`PATCH /v1/developers/webhooks/:webhookId/toggle` — requireAuth()
- Input: `{ active: boolean }`
- Returns updated webhook record (no secret)
- Audit event: `data.updated` on `developer_webhooks`

**DELIVERABLE_EVENTS enum** (12 events):
```typescript
const DELIVERABLE_EVENTS = [
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
- HMAC secret: AES-256-GCM encrypted before storage (Rule 1 — no plaintext secrets at rest)
- Raw secret returned once, never stored on client (Rule 2 — same as API key pattern)
- `hmacSecretEncrypted` field never included in any response (Rule 5)
- Ownership validated on every mutation (Rule 2 — tenant isolation)
- All mutations audit-logged (Rule 3 — WORM)

---

### `apps/api/src/routes/developer-agents.ts`

**Dependencies:**
```typescript
interface AgentDeps {
  readonly auditLogger: AuditLogger;
  readonly listAgentsByPublisher: (publisherId: string) => Promise<AgentListItem[]>;
  readonly createMarketplaceListing: (data: {
    publisherId, name, version, description, author, license, manifest, packageHash
  }) => Promise<AgentListItem>;
}
```

**Endpoints:**

`GET /v1/developers/agents` — requireAuth()
- Queries `marketplace_agents` where `publisher_id = auth.userId`
- Returns: `{ id, name, version, status, installCount, createdAt }[]`

`POST /v1/developers/agents/submit` — requireAuth()
- Input: `{ manifest: object, packageHash: string (64 hex chars), description: string (max 2000) }`
- Runs `validateManifest(manifest)` from `@ordr/sdk`
- If invalid: HTTP 422 with `{ errors: string[], warnings: string[] }` — no DB write
- If valid: writes to `marketplace_agents` with `status: 'pending'`, `publisherId = auth.userId`
- Audit event: `data.created` on `marketplace_agents`
- HTTP 201

**SECURITY:**
- Manifest validation is a hard gate — no listing created for invalid manifests
- `packageHash` must be 64 hex chars (SHA-256) — validated by Zod
- Publisher can only see their own listings (scoped by `auth.userId`)

---

### `apps/api/src/index.ts` (modified)

Mount two new routers:
```typescript
app.route('/v1/developers/webhooks', developerWebhooksRouter);
app.route('/v1/developers/agents', developerAgentsRouter);
```

---

## Section 3: Client API (`developer-api.ts`)

Six new functions added to `apps/web/src/lib/developer-api.ts`:

```typescript
// Webhooks
listWebhooks(): Promise<{ data: WebhookItem[] }>
createWebhook(body: { url: string; events: string[] }): Promise<{ data: WebhookCreated }>
  // WebhookCreated includes hmacSecret (shown once)
deleteWebhook(webhookId: string): Promise<void>
toggleWebhook(webhookId: string, active: boolean): Promise<{ data: WebhookItem }>

// Agents
listMyAgents(): Promise<{ data: MyAgent[] }>
submitAgent(body: { manifest: object; packageHash: string; description: string }): Promise<{ data: MyAgent }>
```

---

## Section 4: UI (`DeveloperConsole.tsx`)

Three wiring changes within the existing component — no new pages or components.

### 4a. Webhooks section

**Current:** `const [webhooks] = useState(mockWebhooks)` — static mock, "Add Webhook" button is a no-op.

**After:**
- Add `webhooks` to `fetchData()` via `listWebhooks()` (falls back to `mockWebhooks` on error)
- "Add Webhook" opens a modal with:
  - URL input (text, required)
  - Multi-checkbox for event types (grouped: Customer, Agent, Ticket, Compliance, DSR, Integration)
  - On success: shows HMAC secret in amber "store it now" modal (same styling as raw API key modal)
- Each webhook row gets a delete button (calls `deleteWebhook`) and an active toggle (calls `toggleWebhook`)
- Webhook `active` state reflected by the existing `Badge variant={wh.active ? 'success' : 'neutral'}` row

### 4b. Published Agents section

**Current:** Pulls from `listMarketplaceAgents({ pageSize: 20 })` — shows all marketplace agents, not just this developer's.

**After:**
- Replace with `listMyAgents()` in `fetchData()`
- Add "Submit Agent" button in the Card `actions` prop
- Submit modal:
  - Manifest JSON textarea (required)
  - Package hash input (64 chars, hex)
  - Description textarea (max 2000)
  - On 422 validation error: show `errors[]` list inline in the modal
  - On success: close modal, prepend new agent to list with `status: 'review'` badge

### 4c. Sandbox section

**Current:** Read-only list — no create or destroy buttons.

**After:**
- Add "New Sandbox" button (calls existing `createSandbox()` from `developer-api.ts`) with name + seed profile inputs
- Add "Destroy" button per active sandbox row (calls existing `destroySandbox()`)
- Both already exist in `developer-api.ts` — this is pure UI wiring

---

## Section 5: Tests

### `apps/api/src/__tests__/developer-webhooks.test.ts` (new)

Tests:
1. `GET /v1/developers/webhooks` — returns list, HMAC secret never in response
2. `POST /v1/developers/webhooks` — valid input → 201, raw secret in response
3. `POST /v1/developers/webhooks` — invalid URL → 400
4. `POST /v1/developers/webhooks` — unknown event type → 400
5. `DELETE /v1/developers/webhooks/:id` — owned webhook → 200
6. `DELETE /v1/developers/webhooks/:id` — unowned webhook → 404
7. `PATCH /v1/developers/webhooks/:id/toggle` — toggles active state

### `apps/api/src/__tests__/developer-agents.test.ts` (new)

Tests:
1. `GET /v1/developers/agents` — returns only caller's agents
2. `POST /v1/developers/agents/submit` — valid manifest → 201, status pending
3. `POST /v1/developers/agents/submit` — invalid manifest → 422 with errors array
4. `POST /v1/developers/agents/submit` — invalid packageHash (not 64 hex) → 400

### Existing `DeveloperConsole.test.tsx` (extend)

Add smoke tests for:
- Webhook modal renders and fires `createWebhook`
- Agent submit modal renders and shows validation errors on 422
- Sandbox create/destroy buttons call the correct API functions

---

## File Map

| Action | File |
|--------|------|
| Create | `packages/db/src/schema/developer-webhooks.ts` |
| Create | `packages/db/migrations/0013_developer_webhooks.sql` |
| Modify | `packages/db/src/schema/index.ts` |
| Modify | `packages/db/src/index.ts` |
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

- **Rule 1 (Encryption):** HMAC secrets encrypted AES-256-GCM before storage; never plaintext at rest
- **Rule 2 (Auth):** All endpoints behind `requireAuth()`; ownership checked on every mutation
- **Rule 3 (Audit):** All creates and deletes produce WORM audit events
- **Rule 4 (Validation):** Zod on all inputs; `validateManifest` hard gate on agent submission
- **Rule 5 (Secrets):** Raw HMAC secret returned once, never re-exposed; encrypted form never in responses
- **Rule 7 (Error handling):** Validation errors include `requestId` correlation; no stack traces to client
- **Rule 9 (Agent safety):** Manifest validation enforced before any listing is written
