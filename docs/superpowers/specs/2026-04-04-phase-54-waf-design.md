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
- The global `rateLimitMiddleware` applies `api:{tenantId}` at 1,000 req/min as a ceiling — this stays in place

**Remaining Rule 4 gaps:**
1. `InMemoryRateLimiter` is not shared across K8s pod replicas — limits reset per pod, making them bypassable by round-robin
2. No per-endpoint limits — all authenticated endpoints share the same 1,000 req/min ceiling
3. No per-agent limits — Rule 4 requires per-agent limiting for AI agent actions

## Architecture

### Rate Limit Tiers

Four named tiers are exposed via the `rateLimit(tier)` factory. The `auth` path is deliberately excluded — auth rate limiting is already handled correctly inside `rateLimitMiddleware` using the `auth:{ip}` key and must not be duplicated.

| Tier | Key pattern | Window | Limit | Use cases |
|------|-------------|--------|-------|-----------|
| `write` | `rl:write:{tenantId}` | 1 min | 100 | POST/PUT/PATCH on domain data |
| `read` | `rl:read:{tenantId}` | 1 min | 500 | GET on domain data |
| `bulk` | `rl:bulk:{tenantId}` | 1 min | 20 | Exports, DSR submissions, batch imports |
| `agent` | `rl:agent:{tenantId}:{agentId}` | 1 min | 200 | Agent-runtime tool calls and decisions |

All tiers use `tenantId` from the server-side JWT claim — never from client input. The `agent` tier additionally appends `agentId` (see Per-Agent Key Construction below).

**Key naming:** New tier keys use the `rl:` prefix to namespace them away from the existing global keys (`api:{tenantId}`, `auth:{ip}`, `anon:{ip}`). This prevents any bucket collision.

**Key hashing:** The existing `rateLimitMiddleware` does not hash keys (the code comment describes intent, not current behaviour). New tier keys follow the same pattern — no hashing applied. If hashing is added in a future phase, it must be applied uniformly across all keys.

### Redis Wiring

The existing `configureRateLimit(instance: RateLimiter): void` signature is **unchanged**. `server.ts` is responsible for constructing the correct implementation and passing it in:

```typescript
// server.ts — production (REDIS_URL present)
import Redis from 'ioredis';
import { RedisRateLimiter, InMemoryRateLimiter } from '@ordr/auth';
import { configureRateLimit } from './middleware/rate-limit.js';

const redisUrl = process.env['REDIS_URL'];
const rateLimiter = redisUrl
  ? new RedisRateLimiter(new Redis(redisUrl))
  : new InMemoryRateLimiter();
configureRateLimit(rateLimiter);
```

When `REDIS_URL` is absent (local dev, test), `InMemoryRateLimiter` is used automatically. No new environment variables are required.

The `RedisLikeClient` interface is already defined in `packages/auth/src/rate-limiter.ts` and `ioredis.Redis` satisfies it.

### `rateLimit(tier)` Factory

A new export from `apps/api/src/middleware/rate-limit.ts`:

```typescript
export type RateLimitTier = 'write' | 'read' | 'bulk' | 'agent';
export function rateLimit(tier: RateLimitTier): MiddlewareHandler<Env>
```

Returns a Hono middleware that:
1. Reads `tenantContext` from the Hono context (set by `requireAuth()` upstream)
2. Constructs the Redis key for the given tier
3. Calls `limiter.check(key, tierConfig)` using the shared configured limiter instance
4. Returns 429 with `Retry-After` on rejection; attaches `X-RateLimit-*` headers on pass
5. Is a no-op if `limiter` is null (preserves test isolation — no `configureRateLimit` call needed in unit tests)

### Per-Agent Key Construction

The `agent` tier reads `agentId` via `c.req.param('agentId')` first, then `c.req.header('X-Agent-Id')` as fallback. If neither is present, it falls back to the `write` tier limit using `rl:write:{tenantId}`.

**Constraint:** For `c.req.param('agentId')` to resolve correctly, agent-runtime routes must include `:agentId` in their Hono path definition (e.g., `router.post('/:agentId/actions', ...)`). Routes that do not follow this pattern must pass the agent ID via the `X-Agent-Id` request header instead.

### Route Tier Assignments

Routes opt in by adding `rateLimit(tier)` after `requireAuth()`. The global ceiling middleware in `app.ts` catches any route without a tier assignment.

**Minimum 6 route groups must receive explicit tiers. Representative assignments:**

| Route group | Tier |
|-------------|------|
| `POST /api/v1/auth/*` | **Not changed** — already handled by `auth:{ip}` logic inside `rateLimitMiddleware` |
| `POST /api/v1/customers`, `PUT /api/v1/customers/:id` | `write` |
| `GET /api/v1/customers`, `GET /api/v1/agents` | `read` |
| `POST /api/v1/marketplace/agents/install` | `write` |
| `POST /api/v1/dsr` | `bulk` |
| `POST /api/v1/developers/agents/submit` | `write` |
| Agent-runtime action endpoints (`:agentId` in path) | `agent` |

### Body Size Limit

Hono's `bodyLimit` middleware is added globally in `app.ts` at 1 MB, matching the NGINX ingress limit. This closes the gap where the application has no app-layer body size enforcement.

There are currently **no file upload routes in the codebase** — the 10 MB override note is forward-looking guidance for when such routes are added. No route files require the override in Phase 54.

## File Structure

| File | Change |
|------|--------|
| `apps/api/src/middleware/rate-limit.ts` | Add `RateLimitTier` type, `TIER_CONFIGS` map, `rateLimit(tier)` factory. `configureRateLimit` signature unchanged. |
| `apps/api/src/middleware/__tests__/rate-limit.test.ts` | New file — unit tests for all 4 tiers: key construction, window config, 429 shape, header values, agent fallback to `write` when agentId absent, no-op when unconfigured, mock `RedisLikeClient` for key pattern verification |
| `apps/api/src/app.ts` | Add `bodyLimit` global middleware (1 MB) |
| `apps/api/src/server.ts` | Construct `RedisRateLimiter` or `InMemoryRateLimiter` based on `REDIS_URL`; pass to `configureRateLimit`; add `ioredis` import |
| Route files (≥6) | Add `rateLimit(tier)` middleware after `requireAuth()` on representative write/read/bulk/agent endpoints |

## Testing Strategy

- **Unit tests** (`rate-limit.test.ts`): Use `InMemoryRateLimiter` directly for 4-tier tests. Mock `RedisLikeClient` (verify `eval` called with correct key + args) for Redis path. Test agent fallback, no-op behaviour, 429 response shape, and `X-RateLimit-*` headers.
- **Integration tests**: Existing route tests do not call `configureRateLimit`, so `rateLimitMiddleware` and `rateLimit(tier)` are both no-ops in their context — no existing tests are broken.
- **No new integration tests** for the live Redis path (no Redis server available in CI).

## Compliance Mapping

| Rule | Requirement | How addressed |
|------|-------------|---------------|
| CLAUDE.md Rule 4 | Per-tenant rate limiting | Already met; Redis wiring makes it K8s-safe |
| CLAUDE.md Rule 4 | Per-endpoint rate limiting | `rateLimit(tier)` factory applied to ≥6 route groups |
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
- Key hashing for rate limit keys — Rule 4 intent not yet implemented in current code; uniform application across all keys is a future phase concern
