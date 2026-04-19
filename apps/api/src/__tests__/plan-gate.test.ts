/**
 * Plan Gate Middleware tests
 *
 * Verifies:
 * - featureGate: 401 when no tenant context, 403 when no subscription,
 *                403 when feature not in plan, 200 when feature is in plan
 * - planGate:    403 when plan below minimum tier, 200 when at or above tier
 * - quotaGate:   401 when no tenant context, 403 when no subscription,
 *                429 when quota exceeded, 200 when within quota
 *
 * SOC2 CC6.1 — Plan-based access control verified at middleware layer.
 * ISO 27001 A.12.1.3 — Capacity management quota enforcement verified.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types.js';
import { createTenantId } from '@ordr/core';
import { requestId } from '../middleware/request-id.js';
import { featureGate, planGate, quotaGate, configureBillingGate } from '../middleware/plan-gate.js';
import { SubscriptionManager, MockStripeClient } from '@ordr/billing';
import { InMemoryAuditStore, AuditLogger } from '@ordr/audit';
import { FieldEncryptor } from '@ordr/crypto';
import type { Subscription } from '@ordr/billing';
import type { SubscriptionStore } from '@ordr/billing';
import type { BillingCustomer, PaymentMethod, UsageSummary, UsageResource } from '@ordr/billing';

// ─── Controllable mock stores ────────────────────────────────────

/* eslint-disable @typescript-eslint/require-await --
   In-memory mock implements async interface without real I/O.
*/
class MockSubStore implements SubscriptionStore {
  subscription: Subscription | null = null;

  async findCustomerByTenantId(_tenantId: string): Promise<BillingCustomer | null> {
    return null;
  }
  async saveCustomer(_customer: BillingCustomer): Promise<void> {}
  async findSubscriptionByTenantId(_tenantId: string): Promise<Subscription | null> {
    return this.subscription;
  }
  async saveSubscription(sub: Subscription): Promise<void> {
    this.subscription = sub;
  }
  async updateSubscription(
    _id: string,
    _data: Partial<Subscription>,
  ): Promise<Subscription | null> {
    return null;
  }
  async findPaymentMethodsByTenantId(_tenantId: string): Promise<readonly PaymentMethod[]> {
    return [];
  }
  async getUsageSummary(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<UsageSummary> {
    return {
      tenant_id: tenantId,
      period_start: periodStart,
      period_end: periodEnd,
      agents: this.usageOverride.agents ?? 0,
      contacts: this.usageOverride.contacts ?? 0,
      messages: this.usageOverride.messages ?? 0,
      api_calls: this.usageOverride.api_calls ?? 0,
    };
  }

  usageOverride: Partial<Record<UsageResource, number>> = {};
}
/* eslint-enable @typescript-eslint/require-await */

// ─── Test Fixtures ───────────────────────────────────────────────

const TENANT_ID = 'tenant-test';

const PROFESSIONAL_SUB: Subscription = {
  id: 'sub-1',
  tenant_id: TENANT_ID,
  stripe_subscription_id: 'stripe-sub-1',
  plan_tier: 'professional',
  status: 'active',
  current_period_start: new Date('2026-01-01'),
  current_period_end: new Date('2026-12-31'),
  cancel_at_period_end: false,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

const STARTER_SUB: Subscription = {
  ...PROFESSIONAL_SUB,
  id: 'sub-2',
  plan_tier: 'starter',
};

const FREE_SUB: Subscription = {
  ...PROFESSIONAL_SUB,
  id: 'sub-3',
  plan_tier: 'free',
};

// ─── Helpers ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeApp(mw: any, withTenantContext = true) {
  const app = new Hono<Env>();
  app.use('*', requestId);
  if (withTenantContext) {
    app.use('*', async (c, next) => {
      c.set('tenantContext', {
        tenantId: createTenantId(TENANT_ID),
        userId: 'user-1',
        roles: ['tenant_admin'],
        permissions: [],
      });
      await next();
    });
  }
  app.use('*', mw as Parameters<Hono<Env>['use']>[1]);
  app.get('/test', (c) => c.json({ ok: true }));
  app.post('/test', (c) => c.json({ ok: true }));
  return app;
}

// ─── Test Setup ──────────────────────────────────────────────────

let store: MockSubStore;
let manager: SubscriptionManager;

beforeEach(() => {
  store = new MockSubStore();
  const auditLogger = new AuditLogger(new InMemoryAuditStore());
  const fieldEncryptor = new FieldEncryptor(Buffer.from('test-key-32-bytes-for-unit-tests!'));
  manager = new SubscriptionManager({
    store,
    stripe: new MockStripeClient(),
    auditLogger,
    fieldEncryptor,
  });
  configureBillingGate(manager);
});

// ─── featureGate ─────────────────────────────────────────────────

describe('featureGate', () => {
  it('returns 401 when no tenant context', async () => {
    const app = makeApp(featureGate('analytics'), false);
    const res = await app.request('/test');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_FAILED');
  });

  it('returns 403 when tenant has no subscription', async () => {
    const app = makeApp(featureGate('analytics'));
    const res = await app.request('/test');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 when feature not in plan (free plan missing analytics)', async () => {
    store.subscription = FREE_SUB;
    const app = makeApp(featureGate('analytics'));
    const res = await app.request('/test');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('analytics');
  });

  it('returns 200 when feature is in plan (professional has analytics)', async () => {
    store.subscription = PROFESSIONAL_SUB;
    const app = makeApp(featureGate('analytics'));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('returns 403 when feature requires higher tier (free plan missing sso)', async () => {
    store.subscription = FREE_SUB;
    const app = makeApp(featureGate('sso'));
    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('returns 200 for ai_agents on starter plan', async () => {
    store.subscription = STARTER_SUB;
    const app = makeApp(featureGate('ai_agents'));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });
});

// ─── planGate ────────────────────────────────────────────────────

describe('planGate', () => {
  it('returns 401 when no tenant context', async () => {
    const app = makeApp(planGate('starter'), false);
    const res = await app.request('/test');
    expect(res.status).toBe(401);
  });

  it('returns 403 when tenant has no subscription', async () => {
    const app = makeApp(planGate('starter'));
    const res = await app.request('/test');
    expect(res.status).toBe(403);
  });

  it('returns 403 when plan is below minimum tier', async () => {
    store.subscription = FREE_SUB;
    const app = makeApp(planGate('professional'));
    const res = await app.request('/test');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('professional');
  });

  it('returns 200 when plan exactly meets minimum tier', async () => {
    store.subscription = PROFESSIONAL_SUB;
    const app = makeApp(planGate('professional'));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('returns 200 when plan exceeds minimum tier', async () => {
    store.subscription = { ...PROFESSIONAL_SUB, plan_tier: 'enterprise' };
    const app = makeApp(planGate('starter'));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });

  it('returns 200 for free tier requirement on any plan', async () => {
    store.subscription = STARTER_SUB;
    const app = makeApp(planGate('free'));
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });
});

// ─── quotaGate ───────────────────────────────────────────────────

describe('quotaGate', () => {
  it('returns 401 when no tenant context', async () => {
    const app = makeApp(quotaGate('messages'), false);
    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when tenant has no subscription', async () => {
    const app = makeApp(quotaGate('messages'));
    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('returns 200 when usage is within quota', async () => {
    store.subscription = PROFESSIONAL_SUB;
    // professional has max_messages_month: 50_000, usage is 0
    const app = makeApp(quotaGate('messages'));
    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('returns 429 when messages quota is exceeded', async () => {
    store.subscription = FREE_SUB; // free: max_messages_month = 500
    store.usageOverride = { messages: 500 }; // at limit (>= 500 means over)
    const app = makeApp(quotaGate('messages'));
    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; details: { resource: string } } };
    expect(body.error.code).toBe('RATE_LIMIT');
    expect(body.error.details.resource).toBe('messages');
  });

  it('returns 429 when contacts quota is exceeded', async () => {
    store.subscription = FREE_SUB; // free: max_contacts = 100
    store.usageOverride = { contacts: 100 };
    const app = makeApp(quotaGate('contacts'));
    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(429);
  });

  it('returns 200 when usage is just under quota', async () => {
    store.subscription = FREE_SUB; // max_messages_month = 500
    store.usageOverride = { messages: 499 };
    const app = makeApp(quotaGate('messages'));
    const res = await app.request('/test', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
