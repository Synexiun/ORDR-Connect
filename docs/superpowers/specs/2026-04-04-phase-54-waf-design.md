# Phase 54 — Application-Layer WAF Design

**Date:** 2026-04-04
**Status:** Approved

## Goal

Close three Rule 4 compliance gaps in the existing rate limiting layer: wire Redis as the production backing store, add per-endpoint rate limit tiers, and add per-agent rate limiting. No cloud WAF (AWS WAF Terraform) is in scope — that remains a human task alongside Phase 50 staging deployment.

## Context

The codebase already has a strong security foundation:
- `apps/api/src/middleware/threat-detection.ts` — 9-stage threat pipeline (honeypot, IP block, attack patterns, DLP, anomaly detection, scoring, enforcement, audit)
- `apps/api/src/middleware/rate-limit.ts` — sliding-window middleware with `InMemoryRateLimiter` (single-instance only)
- `packages/auth/src/rate-limiter.ts` — both `InMemoryRateLimiter` and `RedisRateLimiter` already implemented; `RedisLikeClient` interface defined
- NGINX ingress: 50 RPS + 1 MB body size limit at the K8s edge
- The global rate limiter (`rateLimitMiddleware`) applies `api:{tenantId}` at 1,000 req/min as a ceiling — this stays in place

**Remaining Rule 4 gaps:**
1. `InMemoryRateLimiter` is not shared across K8s pod replicas — limits reset per pod, making them bypassable by round-robin
2. No per-endpoint limits — all authenticated endpoints share the same 1,000 req/min ceiling
3. No per-agent limits — Rule 4 requires per-agent limiting for AI agent actions

## Architecture

### Rate Limit Tiers

Five named tiers map to bucket configurations:

| Tier | Key pattern | Window | Limit | Use cases |
|------|-------------|--------|-------|-----------|
| `auth` | `rl:auth:{ip}` | 15 min | 5 | Login, token refresh, MFA verify |
| `write` | `rl:write:{tenantId}` | 1 min | 100 | POST/PUT/PATCH on domain data |
| `read` | `rl:read:{tenantId}` | 1 min | 500 | GET on domain data |
| `bulk` | `rl:bulk:{tenantId}` | 1 min | 20 | Exports, DSR submissions, batch imports |
| `agent` | `rl:agent:{tenantId}:{agentId}` | 1 min | 200 | Agent-runtime tool calls and decisions |

The `auth` tier uses IP as the bucket key (pre-auth, no tenantId available). All other tiers use `tenantId` from the server-side JWT claim — never from client input. The `agent` tier appends `agentId` from the path param (`:agentId`) or `X-Agent-Id` header; if neither is present, it falls back to the `write` tier limit at `rl:write:{tenantId}`.

### Redis Wiring

`configureRateLimit()` gains an optional `redis` field accepting a `RedisLikeClient`. When present, a `RedisRateLimiter` is used; when absent (dev/test), `InMemoryRateLimiter` is used. `REDIS_URL` is read from the environment in `apps/api/src/server.ts` — no new env vars beyond what already exists.

The global `rateLimitMiddleware` (already in `app.ts`) continues to use the same configured limiter with its existing `api:{tenantId}` bucket as a ceiling. Per-route tiers provide tighter limits on top of it.

### `rateLimit(tier)` Factory

A new export from `apps/api/src/middleware/rate-limit.ts`:

```typescript
export function rateLimit(tier: RateLimitTier): MiddlewareHandler<Env>
```

Returns a Hono middleware that:
1. Reads `tenantContext` from the Hono context (set by `requireAuth()` upstream)
2. Constructs the key for the given tier
3. Calls `limiter.check(key, tierConfig)` using the shared configured limiter
4. Returns 429 with `Retry-After` on rejection; attaches `X-RateLimit-*` headers on pass
5. Is a no-op if `limiter` is null (no `configureRateLimit` called — preserves test isolation)

### Route Tier Assignments

Routes opt in by adding `rateLimit(tier)` after `requireAuth()`. The global ceiling middleware in `app.ts` catches any route without a tier assignment.

**Representative assignments (not exhaustive — implementer applies the pattern consistently):**

| Route group | Tier |
|-------------|------|
| `POST /api/v1/auth/*` | Already handled by global `auth:{ip}` logic in existing middleware |
| `POST /api/v1/customers`, `PUT /api/v1/customers/:id` | `write` |
| `GET /api/v1/customers`, `GET /api/v1/agents` | `read` |
| `POST /api/v1/marketplace/agents/install` | `write` |
| `POST /api/v1/dsr` | `bulk` |
| `POST /api/v1/developers/agents/submit` | `write` |
| Agent-runtime endpoints (path contains `/agent-actions/` or similar) | `agent` |

Minimum 6 route groups must have explicit tiers to demonstrate the pattern.

### Body Size Limit

Hono's `bodyLimit` middleware is added globally in `app.ts` at 1 MB, matching the ingress limit. This closes the gap where the app has no app-layer body size enforcement (currently relying solely on NGINX). File upload endpoints may override to 10 MB via a route-level `bodyLimit`.

## File Structure

| File | Change |
|------|--------|
| `apps/api/src/middleware/rate-limit.ts` | Add `RateLimitTier` type, `TIER_CONFIGS` map, `rateLimit(tier)` factory; update `configureRateLimit` to accept optional Redis client |
| `apps/api/src/middleware/__tests__/rate-limit.test.ts` | New file — unit tests for all 5 tiers, Redis key construction, fallback to write tier when agentId absent, no-op when unconfigured |
| `apps/api/src/app.ts` | Add `bodyLimit` global middleware (1 MB); import updated `configureRateLimit` signature (no functional change) |
| `apps/api/src/server.ts` | Initialize `ioredis` Redis client from `REDIS_URL` (or `null` in dev), pass to `configureRateLimit`; add `redis` to the deps type |
| Route files (≥6) | Add `rateLimit(tier)` middleware after `requireAuth()` on representative write/read/bulk/agent endpoints |

## Testing Strategy

- **Unit tests** (`rate-limit.test.ts`): Use `InMemoryRateLimiter` directly. Test each tier's key construction, window config, 429 response shape, header values, and agent fallback. Mock `RedisLikeClient` to verify the Lua eval call pattern without a real Redis server.
- **Integration tests**: Existing route tests do not call `configureRateLimit`, so the middleware is a no-op in their context — no existing tests broken.
- **No new integration tests** for Redis path (real Redis not available in CI without a running instance).

## Compliance Mapping

| Rule | Requirement | How addressed |
|------|-------------|---------------|
| CLAUDE.md Rule 4 | Per-tenant rate limiting | Already met; Redis wiring makes it K8s-safe |
| CLAUDE.md Rule 4 | Per-endpoint rate limiting | `rateLimit(tier)` factory applied to route groups |
| CLAUDE.md Rule 4 | Per-agent rate limiting | `agent` tier with `rl:agent:{tenantId}:{agentId}` key |
| CLAUDE.md Rule 4 | Sliding window | Existing algorithm; unchanged |
| CLAUDE.md Rule 4 | Request size limits | `bodyLimit(1MB)` global middleware |
| SOC2 CC6.6 | Throttle abusive callers | Multi-tier + Redis ensures cross-pod enforcement |

## Out of Scope

- Cloud WAF (AWS WAF managed rule groups, Cloudflare) — human task, requires AWS credentials
- IP denylist persistence to database — IPIntelligence block list is in-memory; persistence is Phase 55+ material
- Per-user (non-tenant) rate limiting — not required by Rule 4
- Rate limit dashboard UI — operational concern, not compliance-blocking
- Geographic blocking — not in Rule 4; infrastructure-level concern
