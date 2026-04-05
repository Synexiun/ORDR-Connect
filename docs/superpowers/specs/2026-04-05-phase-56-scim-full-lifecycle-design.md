# Phase 56 — SCIM Full Lifecycle Design

**Date:** 2026-04-05
**Status:** Approved
**Scope:** SCIM 2.0 server completion + WorkOS Directory Sync webhooks + Kafka provisioning events + filter expansion

---

## 1. Problem Statement

The existing SCIM server (`packages/auth/src/scim.ts`, ~747 lines) provides partial coverage:
- User provisioning (create/update) works
- Group operations are stubs
- Deprovisioning cascade is incomplete
- WorkOS Directory Sync webhooks are unimplemented (ORDR-Connect cannot receive push events from Okta/Azure AD via WorkOS)
- SCIM filters only support `eq` on `userName`
- All stores are in-memory (no persistence)

Phase 56 fills all these gaps while keeping the existing SCIM server as the core — WorkOS webhooks are a thin translation layer over the same `SCIMHandler` logic, not a parallel path.

---

## 2. Approach

**Dual-path with shared core:**

```
SCIM Client (Okta, Azure AD direct) ──────────────────────────────┐
                                                                    ▼
WorkOS Directory Sync ──→ WorkOS Webhook Receiver ──→ Normalizer ──→ SCIMHandler ──→ DB + Kafka
```

Both paths converge on `SCIMHandler`. The WorkOS normalizer maps WorkOS event shapes to standard SCIM payloads/method calls. Zero logic duplication.

**Method naming:** Phase 56 renames all existing `handle*` methods on `SCIMHandler` to short, verb-first names matching the table in Section 5. The mapping is:

| Old name (scim.ts) | New name (handler.ts) |
|---|---|
| `handleCreateUser` | `createUser` |
| `handleUpdateUser` | `updateUser` |
| `handleDeactivateUser` | `deleteUser` (triggers deprovisioning cascade) |
| `handleListUsers` | `listUsers` |
| `handleGetUser` | `getUser` |

Group methods (`createGroup`, `updateGroup`, `deleteGroup`, `listGroups`, `getGroup`, `patchGroup`) are new — no old names to rename. The WorkOS normalizer and SCIM router both call the new names directly. No alias or backward-compat shim is needed since `scim.ts` is being replaced wholesale by the `scim/` submodule.

---

## 3. File Structure

### `packages/auth/src/scim/` (submodule split from `scim.ts`)

| File | Responsibility |
|------|----------------|
| `index.ts` | Re-exports: `SCIMHandler`, `createSCIMRouter`, types, stores |
| `types.ts` | All SCIM 2.0 types: `SCIMUser`, `SCIMGroup`, `SCIMPatchOp`, `SCIMListResponse`, `SCIMError`, store interfaces |
| `handler.ts` | `SCIMHandler` class — all 10 operations (User CRUD, Group CRUD, Patch, deprovisioning) |
| `schema.ts` | Zod schemas for SCIM payloads; `createSCIMRouter` (Hono router factory) |
| `filters.ts` | `parseSCIMFilter(filterStr)` — tokenizer + evaluator for `eq`, `ne`, `co`, `sw`, `pr` operators |
| `workos-normalizer.ts` | Maps WorkOS Directory Sync event payloads to `SCIMHandler` method calls |
| `stores/drizzle-user-store.ts` | `DrizzleUserStore` implements `UserStore` — wraps Drizzle `users` table |
| `stores/drizzle-group-store.ts` | `DrizzleGroupStore` implements `GroupStore` — wraps `groups` + `group_members` tables; transactional member sync |
| `stores/drizzle-token-store.ts` | `DrizzleTokenStore` implements `TokenStore` — wraps `scim_tokens` table |

### `apps/api/src/routes/`

| File | Responsibility |
|------|----------------|
| `webhooks-workos.ts` | Hono route group: `POST /webhooks/workos` — HMAC-SHA256 verification, idempotency check, normalizer dispatch |

### Tests

| File | Covers |
|------|--------|
| `packages/auth/src/scim/__tests__/handler.test.ts` | All 10 `SCIMHandler` operations including deprovisioning cascade |
| `packages/auth/src/scim/__tests__/filters.test.ts` | All filter operators + edge cases (invalid syntax, unknown attr) |
| `packages/auth/src/scim/__tests__/workos-normalizer.test.ts` | All 8 WorkOS event types → correct handler calls |
| `packages/auth/src/scim/__tests__/drizzle-stores.test.ts` | CRUD + idempotency for all three Drizzle stores |
| `apps/api/src/__tests__/webhooks-workos.test.ts` | HMAC verification, idempotency guard, normalizer dispatch |

---

## 4. Database Schema Changes

### Migration 0016 — SCIM fields on `users`

Add to `users` table:
- `scim_external_id TEXT` — nullable, unique per tenant (composite unique on `tenant_id, scim_external_id`)
- `scim_source TEXT` — nullable (e.g. `'okta'`, `'azure-ad'`, `'workos'`)

These fields are nullable so existing users (created before SCIM) remain valid. The unique constraint is partial (only when `scim_external_id IS NOT NULL`).

**Field mapping:** The existing `SCIMUserRecord` interface in `scim.ts` has a plain `externalId` field. In the new `types.ts`, `SCIMUserRecord.externalId` is preserved as-is. `DrizzleUserStore` maps the DB column `scim_external_id` ↔ `SCIMUserRecord.externalId` in both read and write paths. The DB column name changes (`scim_external_id` is the namespaced form for future-proofing); the interface field name stays `externalId` for SCIM protocol compatibility.

### Migration 0017 — Groups

```sql
-- Migration 0017
CREATE TABLE groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  display_name TEXT NOT NULL,
  external_id TEXT,          -- IdP's group ID
  external_source TEXT,      -- 'okta', 'azure-ad', 'workos'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by   TEXT NOT NULL DEFAULT 'scim',
  PRIMARY KEY (group_id, user_id)
);
```

**RLS — `groups`:** Standard `tenant_id = current_setting('app.current_tenant_id')::uuid` policy (same pattern as all other tenant-scoped tables in `rls.ts`).

**RLS — `group_members`:** PostgreSQL RLS does NOT propagate through foreign key relationships. An explicit policy is required:

```sql
CREATE POLICY "group_members_tenant_isolation" ON "group_members"
  FOR ALL
  USING (
    group_id IN (
      SELECT id FROM groups
      WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
    )
  );
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
```

Both `groups` and `group_members` must be added to `RLS_TABLES` in `packages/db/src/rls.ts`.

### Migration 0016b — `directory_id` on `scim_tokens`

Add to `scim_tokens` table:
- `directory_id TEXT UNIQUE` — nullable; set when a WorkOS Directory Sync connection is established for this token's tenant

This column enables webhook tenant resolution: `event.data.directory_id` → `scim_tokens.directory_id` → `scim_tokens.tenant_id`. Without it, the WorkOS webhook receiver cannot determine which tenant an event belongs to.

### Migration 0018 — WorkOS webhook idempotency

```sql
CREATE TABLE workos_events (
  id           TEXT PRIMARY KEY,   -- WorkOS event ID (e.g. 'evt_01...')
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WORM protection (Rule 3): idempotency guard must itself be tamper-proof
CREATE OR REPLACE FUNCTION workos_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'workos_events rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workos_events_no_update
  BEFORE UPDATE ON workos_events FOR EACH ROW EXECUTE FUNCTION workos_events_immutable();

CREATE TRIGGER workos_events_no_delete
  BEFORE DELETE ON workos_events FOR EACH ROW EXECUTE FUNCTION workos_events_immutable();
```

Simple lookup table. No tenant scope — event IDs are globally unique from WorkOS. No RLS needed; access locked to the API service role only:

```sql
REVOKE ALL ON workos_events FROM PUBLIC;
GRANT INSERT, SELECT ON workos_events TO ordr_api_role;
```

`REVOKE ALL FROM PUBLIC` must precede the GRANT to ensure no other role (migration runner, analytics connector, read-replica) inherits implicit access to this WORM tamper-guard table (Rule 3, Rule 10).

---

## 5. Group Lifecycle

### `SCIMHandler` group operations

| Operation | Method | Behavior |
|-----------|--------|----------|
| List groups | `GET /Groups` | Filter by displayName (eq/co/sw), paginate with startIndex+count, returns `SCIMListResponse` |
| Get group | `GET /Groups/:id` | Fetch group + members, return `SCIMGroup` with `members` array |
| Create group | `POST /Groups` | Insert group row, bulk-insert members if provided, emit Kafka `group.created` |
| Update group | `PUT /Groups/:id` | Full replace: update display name, sync members in single transaction |
| Patch group | `PATCH /Groups/:id` | Apply `PatchOp` operations: `add/remove/replace` members by `value` (user ID) |
| Delete group | `DELETE /Groups/:id` | Delete group (members cascade), emit Kafka `group.deleted` |

### `DrizzleGroupStore` — member sync transaction

```typescript
async syncMembers(groupId: string, memberIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(groupMembers).where(eq(groupMembers.groupId, groupId));
    if (memberIds.length > 0) {
      await tx.insert(groupMembers).values(
        memberIds.map(userId => ({ groupId, userId, addedBy: 'scim' }))
      );
    }
  });
}
```

Transactional full-replace ensures no partial states survive a crash mid-sync.

---

## 6. Deprovisioning Cascade

Triggered when `SCIMHandler.deleteUser(tenantId, userId)` is called (renamed from `handleDeactivateUser` — see Section 2). All steps run in a **single Drizzle transaction** except Kafka emission (after commit).

**Transaction steps (atomic):**
1. Set `users.status = 'inactive'`, `users.deactivatedAt = now()`
2. Delete all active sessions for user from `sessions` table
3. Delete all `group_members` rows for user
4. NULL `users.scimExternalId` + `users.scimSource` (disconnects SCIM link)
5. Emit WORM audit event `USER_DEPROVISIONED` (via `emitAudit` inside tx — Rule 3)

**After commit:**
6. Emit Kafka event `user.deprovisioned` (best-effort, never blocks the transaction)

**Idempotency:** If user is already `status='inactive'`, return 204 without re-running cascade. SCIM spec requires idempotent DELETE.

**Compliance note (Rule 6):** User record is NOT deleted — cryptographic erasure (key destruction) is used for Right to Erasure. The deprovisioning cascade only deactivates access; a separate erasure flow handles GDPR Right to Erasure.

---

## 7. WorkOS Webhook Receiver

### Route: `POST /webhooks/workos`

**Step 1 — HMAC-SHA256 verification**

```typescript
const secret = secretStore.get('WORKOS_WEBHOOK_SECRET');
const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
const actual = Buffer.from(c.req.header('X-WorkOS-Signature') ?? '', 'hex');
// crypto.timingSafeEqual is required — string equality is timing-unsafe (Rule 1, Rule 4)
if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
  // emit audit + return 401
}
```

On mismatch: `401 Unauthorized` (log attempt with Rule 3 audit event `WEBHOOK_SIGNATURE_INVALID`).
Tests must cover: valid signature passes, tampered body fails, wrong secret fails.

**Step 2 — Idempotency**

```sql
SELECT id FROM workos_events WHERE id = $eventId
```

If found: return `200 OK` immediately (already processed).
If not found: insert row, then process.

**Step 3 — Normalizer dispatch**

`workos-normalizer.ts` maps WorkOS event types to `SCIMHandler` calls:

| WorkOS Event | Normalizer Action |
|---|---|
| `dsync.user.created` | `handler.createUser(tenantId, normalizeUser(event.data))` |
| `dsync.user.updated` | `handler.updateUser(tenantId, userId, normalizeUser(event.data))` |
| `dsync.user.deleted` | `handler.deleteUser(tenantId, userId)` |
| `dsync.group.created` | `handler.createGroup(tenantId, normalizeGroup(event.data))` |
| `dsync.group.updated` | `handler.updateGroup(tenantId, groupId, normalizeGroup(event.data))` |
| `dsync.group.deleted` | `handler.deleteGroup(tenantId, groupId)` |
| `dsync.group.user_added` | `handler.patchGroup(tenantId, groupId, addMemberOp(userId))` |
| `dsync.group.user_removed` | `handler.patchGroup(tenantId, groupId, removeMemberOp(userId))` |

**Tenant resolution:** `event.data.directory_id` → lookup `scim_tokens.directoryId` → `scim_tokens.tenantId`. If not found: `422 Unprocessable Entity` (directory not configured for this tenant).

**Error handling:** Any normalizer/handler error → `500` response + `WEBHOOK_PROCESSING_FAILED` audit event with `event_id`, `event_type`, error reason (never PHI — Rule 6).

---

## 8. Kafka Provisioning Events

Six new event types in the `identity` topic:

| Event Type | Payload |
|---|---|
| `group.created` | `{ tenantId, groupId, displayName, externalId, source }` |
| `group.updated` | `{ tenantId, groupId, displayName, memberCount }` — `memberCount` is a snapshot integer captured inside the transaction before commit; no subsequent race is possible |
| `group.deleted` | `{ tenantId, groupId, externalId }` |
| `group.member.added` | `{ tenantId, groupId, userId, addedBy }` |
| `group.member.removed` | `{ tenantId, groupId, userId, removedBy }` |
| `user.deprovisioned` | `{ tenantId, userId, externalId, source, deprovisionedAt }` |

All emitted **after** DB transaction commits (best-effort). Consumers include: access control invalidation, downstream analytics projections, notification workflows.

**No PHI in payloads** — only IDs and metadata (Rule 6). Raw user attributes never enter Kafka.

---

## 9. SCIM Filter Expansion

### `parseSCIMFilter(filterStr: string): SCIMFilter`

**Supported operators:**

| Operator | SCIM Syntax | Example |
|---|---|---|
| `eq` | `attr eq "value"` | `userName eq "alice@example.com"` |
| `ne` | `attr ne "value"` | `active ne "true"` |
| `co` | `attr co "value"` | `displayName co "Engineering"` |
| `sw` | `attr sw "value"` | `userName sw "alice"` |
| `pr` | `attr pr` | `externalId pr` (attribute is present / not null) |

**Supported attributes:** `userName`, `emails.value`, `displayName`, `externalId`, `active`, `scimExternalId`

**Error behavior:** Unknown attribute → `400 Bad Request` with SCIM error schema (`scimType: "invalidFilter"`). Invalid syntax → same.

**SQL translation:** All 5 operators are translated to SQL to ensure correct `totalResults` pagination counts. SCIM clients (Okta, Azure AD) use `totalResults` to drive pagination; in-memory post-filtering would produce a `totalResults` higher than the actual match count, causing clients to request phantom pages indefinitely.

| Operator | SQL translation |
|---|---|
| `eq` | `WHERE col = $value` |
| `ne` | `WHERE col <> $value` |
| `co` | `WHERE col ILIKE ${'%' + value + '%'}` (parameterized; no ReDoS risk with ILIKE) |
| `sw` | `WHERE col ILIKE ${value + '%'}` |
| `pr` | `WHERE col IS NOT NULL` |

All values are passed as Drizzle parameterized query parameters (Rule 4 — no string concatenation into SQL).

---

## 10. Compliance Notes

| Rule | How Phase 56 Satisfies It |
|------|--------------------------|
| Rule 1 | `WORKOS_WEBHOOK_SECRET` fetched from Vault, never hardcoded; HMAC comparison uses `crypto.timingSafeEqual` (timing-safe) |
| Rule 2 | SCIM tokens validated server-side; tenant derived from `scim_tokens.tenantId` via `directory_id` lookup, never from client input; explicit RLS policies on `groups` and `group_members` |
| Rule 3 | WORM audit events for all state changes: user deprovisioned, group created/deleted, webhook signature failures; `workos_events` has WORM triggers preventing replay-guard tampering |
| Rule 4 | All SCIM payloads validated with Zod schemas (strict mode) before handler invocation; all filter operators translated to parameterized SQL (no string concatenation) |
| Rule 5 | `WORKOS_WEBHOOK_SECRET` in Vault, rotated on schedule |
| Rule 6 | No PHI in Kafka payloads, no PHI in audit event details; user record retained (not deleted) on deprovisioning — cryptographic erasure for Right to Erasure |
| Rule 8 | No new runtime dependencies introduced; all existing pinned-version constraints inherited |

---

## 11. Testing Strategy

- **Unit tests** (`packages/auth/src/scim/__tests__/`): all 10 handler operations, all 5 filter operators, all 8 WorkOS event normalization paths, all three Drizzle stores CRUD + idempotency
- **Integration test** (`apps/api/src/__tests__/webhooks-workos.test.ts`): HMAC verification pass/fail, duplicate event guard, event dispatch to normalizer
- **Coverage target:** 80% line (Compliance Gate item 5); 100% on deprovisioning cascade and HMAC verification paths (security-sensitive per Compliance Gate item 5)
- **No PHI in test fixtures** — use synthetic IDs and display names throughout

---

## 12. Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| WorkOS direct only vs. both paths? | Both — SCIM server for direct IdP integrations; WorkOS webhooks for managed Directory Sync |
| Drizzle stores or in-memory for Phase 56? | Drizzle stores — Phase 56 is the persistence phase |
| Delete groups or soft-delete? | Hard delete (CASCADE on group_members) — group membership is transient; audit event provides the trail |
| Filter: SQL or in-memory? | All operators → SQL (ILIKE for `co`/`sw`, `<>` for `ne`, `IS NOT NULL` for `pr`) — required for correct `totalResults` pagination |
