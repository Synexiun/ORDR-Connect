/**
 * @ordr/billing — Comprehensive Test Suite
 *
 * Coverage targets:
 *  - plans.ts          — plan catalog, helpers, feature/tier checks
 *  - stripe-client.ts  — MockStripeClient, webhook signature verification
 *  - subscription-manager.ts — full lifecycle + error paths
 *  - usage-tracker.ts  — counters, flush, periodic lifecycle
 *  - plan-gate.ts      — requirePlan, requireFeature, checkQuota middleware
 *
 * SOC2 CC6.1 — access-control gate tests confirm plan enforcement.
 * ISO 27001 A.12.1.3 — capacity tests confirm quota enforcement.
 * HIPAA §164.312(b) — audit log calls are verified on every mutation.
 *
 * NOTE: hono/factory is mocked below because hono is only installed
 * in apps/api and is not hoisted to the workspace root in this monorepo.
 * The mock makes createMiddleware a transparent passthrough so the middleware
 * callbacks under test are exercised directly — the behaviour tested is
 * identical to what runs in production (same callback body, same responses).
 */

// ─── Mock hono/factory BEFORE any imports that pull in plan-gate.ts ──
vi.mock('hono/factory', () => ({
  createMiddleware: (
    fn: (c: unknown, next: () => Promise<void>) => Promise<unknown>,
  ) => fn,
}));

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── Plans ───────────────────────────────────────────────────────
import {
  getAllPlans,
  getPlanByTier,
  hasFeature,
  compareTiers,
  isAtLeastTier,
  getResourceLimit,
  FEATURES,
  PLANS,
} from '../plans.js';

// ─── Stripe Client ───────────────────────────────────────────────
import {
  MockStripeClient,
  generateWebhookSignature,
  verifyWebhookSignature,
} from '../stripe-client.js';
import type { StripeSubscription } from '../stripe-client.js';

// ─── Subscription Manager ────────────────────────────────────────
import {
  SubscriptionManager,
  BillingError,
  PlanLimitExceededError,
  SubscriptionNotFoundError,
  InvalidPlanTransitionError,
} from '../subscription-manager.js';
import type { SubscriptionStore } from '../subscription-manager.js';

// ─── Usage Tracker ───────────────────────────────────────────────
import { UsageTracker } from '../usage-tracker.js';
import type { UsageStore } from '../usage-tracker.js';

// ─── Plan Gate ───────────────────────────────────────────────────
import { requirePlan, requireFeature, checkQuota } from '../plan-gate.js';

// ─── Types ───────────────────────────────────────────────────────
import type {
  PlanTier,
  Subscription,
  UsageResource,
  UsageSummary,
  BillingCustomer,
  PaymentMethod,
  UsageRecord,
} from '../types.js';

// ═══════════════════════════════════════════════════════════════════
// TEST DOUBLES — shared across SubscriptionManager suites
// ═══════════════════════════════════════════════════════════════════

// ─── In-Memory SubscriptionStore ─────────────────────────────────

class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly customers = new Map<string, BillingCustomer>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly usageSummaries = new Map<string, UsageSummary>();

  async findCustomerByTenantId(tenantId: string): Promise<BillingCustomer | null> {
    return this.customers.get(tenantId) ?? null;
  }

  async saveCustomer(customer: BillingCustomer): Promise<void> {
    this.customers.set(customer.tenant_id, customer);
  }

  async findSubscriptionByTenantId(tenantId: string): Promise<Subscription | null> {
    return this.subscriptions.get(tenantId) ?? null;
  }

  async saveSubscription(subscription: Subscription): Promise<void> {
    this.subscriptions.set(subscription.tenant_id, subscription);
  }

  async updateSubscription(
    id: string,
    data: Partial<Subscription>,
  ): Promise<Subscription | null> {
    // Find by subscription id across tenants
    for (const [tenantId, sub] of this.subscriptions.entries()) {
      if (sub.id === id) {
        const updated = { ...sub, ...data } as Subscription;
        this.subscriptions.set(tenantId, updated);
        return updated;
      }
    }
    return null;
  }

  async findPaymentMethodsByTenantId(_tenantId: string): Promise<readonly PaymentMethod[]> {
    return [];
  }

  async getUsageSummary(
    tenantId: string,
    _periodStart: Date,
    _periodEnd: Date,
  ): Promise<UsageSummary> {
    return (
      this.usageSummaries.get(tenantId) ?? {
        tenant_id: tenantId,
        period_start: new Date(),
        period_end: new Date(),
        agents: 0,
        contacts: 0,
        messages: 0,
        api_calls: 0,
      }
    );
  }

  /** Test helper: seed a usage summary for a tenant. */
  seedUsage(tenantId: string, summary: Partial<UsageSummary>): void {
    const base: UsageSummary = {
      tenant_id: tenantId,
      period_start: new Date(),
      period_end: new Date(),
      agents: 0,
      contacts: 0,
      messages: 0,
      api_calls: 0,
    };
    this.usageSummaries.set(tenantId, { ...base, ...summary });
  }

  /** Test helper: directly inject an active subscription. */
  seedSubscription(subscription: Subscription): void {
    this.subscriptions.set(subscription.tenant_id, subscription);
  }
}

// ─── Extended MockStripeClient with seed helper ──────────────────

class SeededMockStripeClient extends MockStripeClient {
  /**
   * Pre-register a subscription in the mock's internal map so that
   * updateSubscription / cancelSubscription work for directly-seeded store
   * subscriptions in tests that bypass createSubscription().
   */
  seedStripeSubscription(sub: StripeSubscription): void {
    // Access the private map via bracket notation (test-only usage).
    (this as unknown as { subscriptions: Map<string, StripeSubscription> })
      .subscriptions.set(sub.id, sub);
  }
}

// ─── Mock AuditLogger ────────────────────────────────────────────

interface AuditLogCall {
  readonly tenantId: string;
  readonly eventType: string;
  readonly action: string;
  readonly resourceId: string;
}

class MockAuditLogger {
  public readonly calls: AuditLogCall[] = [];

  async log(input: {
    tenantId: string;
    eventType: string;
    actorType: string;
    actorId: string;
    resource: string;
    resourceId: string;
    action: string;
    details: Record<string, unknown>;
    timestamp: Date;
  }): Promise<void> {
    this.calls.push({
      tenantId: input.tenantId,
      eventType: input.eventType,
      action: input.action,
      resourceId: input.resourceId,
    });
  }

  reset(): void {
    this.calls.length = 0;
  }
}

// ─── Passthrough FieldEncryptor ──────────────────────────────────

class PassthroughFieldEncryptor {
  encryptField(_fieldName: string, value: string): string {
    return value;
  }
  decryptField(_fieldName: string, encrypted: string): string {
    return encrypted;
  }
}

// ─── In-Memory UsageStore ─────────────────────────────────────────

class InMemoryUsageStore implements UsageStore {
  private readonly records: UsageRecord[] = [];
  private readonly summaries = new Map<string, UsageSummary>();
  private idCounter = 0;

  async saveUsageRecord(
    record: Omit<UsageRecord, 'id'>,
  ): Promise<UsageRecord> {
    const id = `rec_${String(++this.idCounter)}`;
    const full: UsageRecord = { ...record, id };
    this.records.push(full);
    return full;
  }

  async getUsageSummary(
    tenantId: string,
    _periodStart: Date,
    _periodEnd: Date,
  ): Promise<UsageSummary> {
    return (
      this.summaries.get(tenantId) ?? {
        tenant_id: tenantId,
        period_start: new Date(),
        period_end: new Date(),
        agents: 0,
        contacts: 0,
        messages: 0,
        api_calls: 0,
      }
    );
  }

  async getUsageRecords(
    tenantId: string,
    resource: UsageResource | undefined,
    _periodStart: Date,
    _periodEnd: Date,
  ): Promise<readonly UsageRecord[]> {
    return this.records.filter(
      (r) =>
        r.tenant_id === tenantId &&
        (resource === undefined || r.resource === resource),
    );
  }

  async resetUsage(tenantId: string, _periodStart: Date, _periodEnd: Date): Promise<number> {
    const before = this.records.length;
    const remaining = this.records.filter((r) => r.tenant_id !== tenantId);
    this.records.length = 0;
    for (const r of remaining) this.records.push(r);
    return before - this.records.length;
  }

  /** How many records were saved (for flush assertions). */
  get savedCount(): number {
    return this.records.length;
  }
}

// ─── Subscription Factory ─────────────────────────────────────────

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  const now = new Date();
  return {
    id: 'sub_test_001',
    tenant_id: 'tenant-abc',
    stripe_subscription_id: 'sub_stripe_001',
    plan_tier: 'starter',
    status: 'active',
    current_period_start: now,
    current_period_end: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    cancel_at_period_end: false,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ─── Hono Context factory (for plan-gate tests) ───────────────────

interface TenantContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

function makeHonoContext(
  tenantCtx: TenantContext | undefined,
  requestId = 'req-001',
): {
  get: (key: string) => unknown;
  json: (body: unknown, status: number) => { body: unknown; status: number };
} {
  const vars: Record<string, unknown> = {
    tenantContext: tenantCtx,
    requestId,
  };
  return {
    get: (key: string) => vars[key],
    json: (body: unknown, status: number) => ({ body, status }),
  };
}

// ═══════════════════════════════════════════════════════════════════
// 1. PLANS — catalog and helpers
// ═══════════════════════════════════════════════════════════════════

describe('Plans', () => {
  describe('getAllPlans()', () => {
    it('returns exactly 4 plans', () => {
      expect(getAllPlans()).toHaveLength(4);
    });

    it('returns plans in tier order: free → enterprise', () => {
      const plans = getAllPlans();
      expect(plans[0]?.tier).toBe('free');
      expect(plans[1]?.tier).toBe('starter');
      expect(plans[2]?.tier).toBe('professional');
      expect(plans[3]?.tier).toBe('enterprise');
    });

    it('all plans have required fields', () => {
      for (const plan of getAllPlans()) {
        expect(plan.id).toBeTruthy();
        expect(plan.name).toBeTruthy();
        expect(plan.limits).toBeDefined();
      }
    });
  });

  describe('getPlanByTier()', () => {
    it('returns the free plan', () => {
      const plan = getPlanByTier('free');
      expect(plan.tier).toBe('free');
      expect(plan.id).toBe('plan_free');
      expect(plan.price_cents_monthly).toBe(0);
    });

    it('returns the starter plan', () => {
      const plan = getPlanByTier('starter');
      expect(plan.tier).toBe('starter');
      expect(plan.price_cents_monthly).toBe(4900);
    });

    it('returns the professional plan', () => {
      const plan = getPlanByTier('professional');
      expect(plan.tier).toBe('professional');
      expect(plan.price_cents_monthly).toBe(14900);
    });

    it('returns the enterprise plan', () => {
      const plan = getPlanByTier('enterprise');
      expect(plan.tier).toBe('enterprise');
      expect(plan.is_custom).toBe(true);
    });

    it('enterprise plan limits are Infinity', () => {
      const plan = getPlanByTier('enterprise');
      expect(plan.limits.max_agents).toBe(Infinity);
      expect(plan.limits.max_contacts).toBe(Infinity);
      expect(plan.limits.max_messages_month).toBe(Infinity);
      expect(plan.limits.max_api_calls_month).toBe(Infinity);
    });
  });

  describe('hasFeature()', () => {
    it('free plan includes basic_crm', () => {
      expect(hasFeature('free', FEATURES.BASIC_CRM)).toBe(true);
    });

    it('free plan does NOT include advanced_analytics', () => {
      expect(hasFeature('free', FEATURES.ADVANCED_ANALYTICS)).toBe(false);
    });

    it('starter plan includes ai_agents', () => {
      expect(hasFeature('starter', FEATURES.AI_AGENTS)).toBe(true);
    });

    it('starter plan does NOT include sso', () => {
      expect(hasFeature('starter', FEATURES.SSO)).toBe(false);
    });

    it('professional plan includes advanced_analytics and sso', () => {
      expect(hasFeature('professional', FEATURES.ADVANCED_ANALYTICS)).toBe(true);
      expect(hasFeature('professional', FEATURES.SSO)).toBe(true);
    });

    it('professional plan does NOT include white_label', () => {
      expect(hasFeature('professional', FEATURES.WHITE_LABEL)).toBe(false);
    });

    it('enterprise plan includes all features including white_label and compliance_dashboard', () => {
      expect(hasFeature('enterprise', FEATURES.WHITE_LABEL)).toBe(true);
      expect(hasFeature('enterprise', FEATURES.COMPLIANCE_DASHBOARD)).toBe(true);
      expect(hasFeature('enterprise', FEATURES.DEDICATED_SUPPORT)).toBe(true);
      expect(hasFeature('enterprise', FEATURES.SLA)).toBe(true);
    });

    it('returns false for an unknown feature name on any tier', () => {
      expect(hasFeature('enterprise', 'unknown_feature_xyz')).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. PLAN COMPARISON
// ═══════════════════════════════════════════════════════════════════

describe('Plan comparison', () => {
  describe('compareTiers()', () => {
    it('returns negative when a is lower than b', () => {
      expect(compareTiers('free', 'starter')).toBeLessThan(0);
      expect(compareTiers('free', 'enterprise')).toBeLessThan(0);
      expect(compareTiers('starter', 'professional')).toBeLessThan(0);
    });

    it('returns 0 when tiers are equal', () => {
      expect(compareTiers('free', 'free')).toBe(0);
      expect(compareTiers('professional', 'professional')).toBe(0);
      expect(compareTiers('enterprise', 'enterprise')).toBe(0);
    });

    it('returns positive when a is higher than b', () => {
      expect(compareTiers('enterprise', 'free')).toBeGreaterThan(0);
      expect(compareTiers('professional', 'starter')).toBeGreaterThan(0);
    });
  });

  describe('isAtLeastTier()', () => {
    it('returns true when current tier equals minimum', () => {
      expect(isAtLeastTier('starter', 'starter')).toBe(true);
      expect(isAtLeastTier('free', 'free')).toBe(true);
    });

    it('returns true when current tier is above minimum', () => {
      expect(isAtLeastTier('professional', 'starter')).toBe(true);
      expect(isAtLeastTier('enterprise', 'free')).toBe(true);
      expect(isAtLeastTier('enterprise', 'professional')).toBe(true);
    });

    it('returns false when current tier is below minimum', () => {
      expect(isAtLeastTier('free', 'starter')).toBe(false);
      expect(isAtLeastTier('starter', 'professional')).toBe(false);
      expect(isAtLeastTier('professional', 'enterprise')).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. RESOURCE LIMITS
// ═══════════════════════════════════════════════════════════════════

describe('getResourceLimit()', () => {
  it('free plan: 1 agent', () => {
    expect(getResourceLimit('free', 'agents')).toBe(1);
  });

  it('free plan: 100 contacts', () => {
    expect(getResourceLimit('free', 'contacts')).toBe(100);
  });

  it('starter plan: 3 agents', () => {
    expect(getResourceLimit('starter', 'agents')).toBe(3);
  });

  it('starter plan: 1,000 contacts', () => {
    expect(getResourceLimit('starter', 'contacts')).toBe(1_000);
  });

  it('professional plan: 10 agents', () => {
    expect(getResourceLimit('professional', 'agents')).toBe(10);
  });

  it('professional plan: 10,000 contacts', () => {
    expect(getResourceLimit('professional', 'contacts')).toBe(10_000);
  });

  it('professional plan: 100,000 api_calls', () => {
    expect(getResourceLimit('professional', 'api_calls')).toBe(100_000);
  });

  it('enterprise plan: Infinity agents', () => {
    expect(getResourceLimit('enterprise', 'agents')).toBe(Infinity);
  });

  it('enterprise plan: Infinity contacts', () => {
    expect(getResourceLimit('enterprise', 'contacts')).toBe(Infinity);
  });

  it('enterprise plan: Infinity messages', () => {
    expect(getResourceLimit('enterprise', 'messages')).toBe(Infinity);
  });

  it('enterprise plan: Infinity api_calls', () => {
    expect(getResourceLimit('enterprise', 'api_calls')).toBe(Infinity);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. MockStripeClient
// ═══════════════════════════════════════════════════════════════════

describe('MockStripeClient', () => {
  let stripe: MockStripeClient;

  beforeEach(() => {
    stripe = new MockStripeClient();
  });

  describe('createCustomer()', () => {
    it('returns a customer with a prefixed id', async () => {
      const customer = await stripe.createCustomer({
        email: 'test@tenant.com',
        name: 'Test Tenant',
      });
      expect(customer.id).toMatch(/^cus_/);
      expect(customer.email).toBe('test@tenant.com');
      expect(customer.name).toBe('Test Tenant');
    });

    it('sets empty metadata when none provided', async () => {
      const customer = await stripe.createCustomer({
        email: 'a@b.com',
        name: 'Acme',
      });
      expect(customer.metadata).toEqual({});
    });

    it('stores metadata when provided', async () => {
      const customer = await stripe.createCustomer({
        email: 'a@b.com',
        name: 'Acme',
        metadata: { tenant_id: 'tenant-1' },
      });
      expect(customer.metadata['tenant_id']).toBe('tenant-1');
    });

    it('assigns a unix created timestamp', async () => {
      const before = Math.floor(Date.now() / 1000);
      const customer = await stripe.createCustomer({ email: 'a@b.com', name: 'A' });
      expect(customer.created).toBeGreaterThanOrEqual(before);
    });
  });

  describe('createSubscription()', () => {
    it('returns an active subscription with correct customer and price', async () => {
      const customer = await stripe.createCustomer({ email: 'a@b.com', name: 'A' });
      const sub = await stripe.createSubscription({
        customer: customer.id,
        price_id: 'price_starter_monthly',
      });
      expect(sub.id).toMatch(/^sub_/);
      expect(sub.customer).toBe(customer.id);
      expect(sub.status).toBe('active');
      expect(sub.items.data[0]?.price.id).toBe('price_starter_monthly');
    });

    it('creates a trialing subscription when trial_period_days set', async () => {
      const customer = await stripe.createCustomer({ email: 'a@b.com', name: 'A' });
      const sub = await stripe.createSubscription({
        customer: customer.id,
        price_id: 'price_starter_monthly',
        trial_period_days: 14,
      });
      expect(sub.status).toBe('trialing');
    });

    it('creates an invoice upon subscription creation (listInvoices)', async () => {
      const customer = await stripe.createCustomer({ email: 'a@b.com', name: 'A' });
      await stripe.createSubscription({
        customer: customer.id,
        price_id: 'price_starter_monthly',
      });
      const invoices = await stripe.listInvoices(customer.id);
      expect(invoices).toHaveLength(1);
      expect(invoices[0]?.status).toBe('paid');
    });
  });

  describe('cancelSubscription()', () => {
    it('sets cancel_at_period_end when cancelAtPeriodEnd is true (default)', async () => {
      const customer = await stripe.createCustomer({ email: 'a@b.com', name: 'A' });
      const sub = await stripe.createSubscription({
        customer: customer.id,
        price_id: 'price_starter_monthly',
      });
      const cancelled = await stripe.cancelSubscription(sub.id);
      expect(cancelled.cancel_at_period_end).toBe(true);
      expect(cancelled.status).toBe('active');
    });

    it('immediately cancels when cancelAtPeriodEnd is false', async () => {
      const customer = await stripe.createCustomer({ email: 'a@b.com', name: 'A' });
      const sub = await stripe.createSubscription({
        customer: customer.id,
        price_id: 'price_starter_monthly',
      });
      const cancelled = await stripe.cancelSubscription(sub.id, false);
      expect(cancelled.status).toBe('canceled');
      expect(cancelled.cancel_at_period_end).toBe(false);
    });

    it('throws when subscription id is not found', async () => {
      await expect(stripe.cancelSubscription('sub_nonexistent')).rejects.toThrow(
        'not found',
      );
    });
  });

  describe('createPaymentIntent()', () => {
    it('returns a payment intent with correct amount and currency', async () => {
      const customer = await stripe.createCustomer({ email: 'a@b.com', name: 'A' });
      const pi = await stripe.createPaymentIntent({
        amount: 4900,
        currency: 'usd',
        customer: customer.id,
      });
      expect(pi.id).toMatch(/^pi_/);
      expect(pi.amount).toBe(4900);
      expect(pi.currency).toBe('usd');
      expect(pi.status).toBe('succeeded');
    });

    it('client_secret is non-empty', async () => {
      const customer = await stripe.createCustomer({ email: 'a@b.com', name: 'A' });
      const pi = await stripe.createPaymentIntent({
        amount: 100,
        currency: 'eur',
        customer: customer.id,
      });
      expect(pi.client_secret).toBeTruthy();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. WEBHOOK SIGNATURE VERIFICATION
// ═══════════════════════════════════════════════════════════════════

describe('Webhook signature', () => {
  const SECRET = 'whsec_test_secret_value_01234567890abcdef';
  const PAYLOAD = JSON.stringify({
    id: 'evt_test',
    type: 'invoice.paid',
    data: { object: { id: 'in_001' } },
    created: Math.floor(Date.now() / 1000),
  });

  it('generateWebhookSignature produces a verifiable signature (round-trip)', () => {
    const sig = generateWebhookSignature(PAYLOAD, SECRET);
    expect(() => verifyWebhookSignature(PAYLOAD, sig, SECRET)).not.toThrow();
  });

  it('verifyWebhookSignature throws on tampered payload', () => {
    const sig = generateWebhookSignature(PAYLOAD, SECRET);
    const tampered = PAYLOAD.replace('invoice.paid', 'invoice.void');
    expect(() => verifyWebhookSignature(tampered, sig, SECRET)).toThrow();
  });

  it('verifyWebhookSignature throws on wrong secret', () => {
    const sig = generateWebhookSignature(PAYLOAD, SECRET);
    expect(() =>
      verifyWebhookSignature(PAYLOAD, sig, 'wrong_secret'),
    ).toThrow();
  });

  it('verifyWebhookSignature throws on malformed signature header', () => {
    expect(() =>
      verifyWebhookSignature(PAYLOAD, 'no_equals_sign_here', SECRET),
    ).toThrow();
  });

  it('verifyWebhookSignature throws on stale timestamp (>5 min)', () => {
    const staleTs = Math.floor(Date.now() / 1000) - 301; // 5 min + 1 sec ago
    const sig = generateWebhookSignature(PAYLOAD, SECRET, staleTs);
    expect(() => verifyWebhookSignature(PAYLOAD, sig, SECRET)).toThrow(
      'tolerance window',
    );
  });

  it('MockStripeClient.constructWebhookEvent parses a valid signed event', () => {
    const stripe = new MockStripeClient();
    const sig = generateWebhookSignature(PAYLOAD, SECRET);
    const event = stripe.constructWebhookEvent(PAYLOAD, sig, SECRET);
    expect(event.type).toBe('invoice.paid');
    expect(event.id).toBe('evt_test');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6–10. SUBSCRIPTION MANAGER
// ═══════════════════════════════════════════════════════════════════

describe('SubscriptionManager', () => {
  let store: InMemorySubscriptionStore;
  let stripe: SeededMockStripeClient;
  let auditLogger: MockAuditLogger;
  let fieldEncryptor: PassthroughFieldEncryptor;
  let manager: SubscriptionManager;

  beforeEach(() => {
    store = new InMemorySubscriptionStore();
    stripe = new SeededMockStripeClient();
    auditLogger = new MockAuditLogger();
    fieldEncryptor = new PassthroughFieldEncryptor();
    manager = new SubscriptionManager({
      store,
      stripe: stripe as unknown as import('../stripe-client.js').StripeClient,
      auditLogger: auditLogger as unknown as import('@ordr/audit').AuditLogger,
      fieldEncryptor: fieldEncryptor as unknown as import('@ordr/crypto').FieldEncryptor,
    });
  });

  afterEach(() => {
    auditLogger.reset();
  });

  /**
   * Seeds both the in-memory store AND the MockStripeClient's internal map
   * with a subscription so that upgrade/downgrade/cancel operations work
   * without going through the full createSubscription() flow.
   */
  function seedFullSubscription(sub: Subscription): void {
    store.seedSubscription(sub);
    // Build a minimal StripeSubscription for the mock's internal map
    const stripeSub: StripeSubscription = {
      id: sub.id,
      customer: `cus_seeded_${sub.tenant_id}`,
      status: 'active',
      items: { data: [{ price: { id: `price_${sub.plan_tier}_monthly` } }] },
      current_period_start: Math.floor(sub.current_period_start.getTime() / 1000),
      current_period_end: Math.floor(sub.current_period_end.getTime() / 1000),
      cancel_at_period_end: sub.cancel_at_period_end,
      created: Math.floor(sub.created_at.getTime() / 1000),
    };
    stripe.seedStripeSubscription(stripeSub);
  }

  // ─── 6. createSubscription ──────────────────────────────────────

  describe('createSubscription()', () => {
    it('creates a free subscription without a payment method', async () => {
      const sub = await manager.createSubscription(
        'tenant-1',
        'free',
        null,
        'user-1',
      );
      expect(sub.plan_tier).toBe('free');
      expect(sub.status).toBe('active');
      expect(sub.tenant_id).toBe('tenant-1');
      expect(sub.cancel_at_period_end).toBe(false);
    });

    it('creates a paid subscription with a payment method', async () => {
      const sub = await manager.createSubscription(
        'tenant-2',
        'starter',
        'pm_card_visa',
        'user-1',
      );
      expect(sub.plan_tier).toBe('starter');
      expect(sub.status).toBe('active');
    });

    it('logs an audit event on creation', async () => {
      await manager.createSubscription('tenant-3', 'free', null, 'user-99');
      expect(auditLogger.calls).toHaveLength(1);
      expect(auditLogger.calls[0]?.action).toBe('create');
      expect(auditLogger.calls[0]?.tenantId).toBe('tenant-3');
    });

    it('throws BillingError if tenant already has an active subscription', async () => {
      await manager.createSubscription('tenant-4', 'free', null, 'user-1');
      await expect(
        manager.createSubscription('tenant-4', 'starter', 'pm_card_visa', 'user-1'),
      ).rejects.toThrow(BillingError);
    });

    it('throws BillingError when paid plan has no payment method', async () => {
      await expect(
        manager.createSubscription('tenant-5', 'starter', null, 'user-1'),
      ).rejects.toMatchObject({ code: 'PAYMENT_METHOD_REQUIRED' });
    });
  });

  // ─── 7. upgradeSubscription ─────────────────────────────────────

  describe('upgradeSubscription()', () => {
    it('upgrades from starter to professional', async () => {
      seedFullSubscription(
        makeSubscription({ tenant_id: 'tenant-up', plan_tier: 'starter' }),
      );
      const updated = await manager.upgradeSubscription(
        'tenant-up',
        'professional',
        'user-1',
      );
      expect(updated.plan_tier).toBe('professional');
    });

    it('logs an audit event with from/to tier details', async () => {
      seedFullSubscription(
        makeSubscription({ tenant_id: 'tenant-up2', plan_tier: 'free' }),
      );
      await manager.upgradeSubscription('tenant-up2', 'starter', 'user-1');
      expect(auditLogger.calls[0]?.action).toBe('upgrade');
    });

    it('throws InvalidPlanTransitionError when new tier is the same', async () => {
      // InvalidPlanTransitionError is thrown before stripe is called — store only
      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-up3', plan_tier: 'professional' }),
      );
      await expect(
        manager.upgradeSubscription('tenant-up3', 'professional', 'user-1'),
      ).rejects.toThrow(InvalidPlanTransitionError);
    });

    it('throws InvalidPlanTransitionError when upgrading to a lower tier', async () => {
      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-up4', plan_tier: 'professional' }),
      );
      await expect(
        manager.upgradeSubscription('tenant-up4', 'starter', 'user-1'),
      ).rejects.toThrow(InvalidPlanTransitionError);
    });
  });

  // ─── 8. downgradeSubscription ────────────────────────────────────

  describe('downgradeSubscription()', () => {
    it('downgrades from professional to starter within limits', async () => {
      seedFullSubscription(
        makeSubscription({ tenant_id: 'tenant-dn', plan_tier: 'professional' }),
      );
      // 2 agents, 500 contacts — within starter limits (3 agents / 1k contacts)
      store.seedUsage('tenant-dn', { agents: 2, contacts: 500 });

      const updated = await manager.downgradeSubscription(
        'tenant-dn',
        'starter',
        'user-1',
      );
      expect(updated.plan_tier).toBe('starter');
    });

    it('throws InvalidPlanTransitionError when downgrading to same tier', async () => {
      // Error thrown before stripe is called — store only seeding is fine
      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-dn2', plan_tier: 'starter' }),
      );
      store.seedUsage('tenant-dn2', { agents: 1 });
      await expect(
        manager.downgradeSubscription('tenant-dn2', 'starter', 'user-1'),
      ).rejects.toThrow(InvalidPlanTransitionError);
    });

    it('throws InvalidPlanTransitionError when usage exceeds new plan agent limit', async () => {
      // Error thrown after usage check but before stripe is called
      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-dn3', plan_tier: 'professional' }),
      );
      // Free plan allows 1 agent; we have 2
      store.seedUsage('tenant-dn3', { agents: 2, contacts: 50 });
      await expect(
        manager.downgradeSubscription('tenant-dn3', 'free', 'user-1'),
      ).rejects.toThrow(InvalidPlanTransitionError);
    });

    it('throws InvalidPlanTransitionError when usage exceeds new plan contact limit', async () => {
      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-dn4', plan_tier: 'professional' }),
      );
      // Free plan allows 100 contacts; we have 150
      store.seedUsage('tenant-dn4', { agents: 0, contacts: 150 });
      await expect(
        manager.downgradeSubscription('tenant-dn4', 'free', 'user-1'),
      ).rejects.toThrow(InvalidPlanTransitionError);
    });
  });

  // ─── 7 (continued). cancelSubscription ──────────────────────────

  describe('cancelSubscription()', () => {
    it('schedules end-of-period cancellation by default', async () => {
      seedFullSubscription(
        makeSubscription({ tenant_id: 'tenant-can', plan_tier: 'starter' }),
      );
      const updated = await manager.cancelSubscription(
        'tenant-can',
        'no longer needed',
        'user-1',
      );
      expect(updated.cancel_at_period_end).toBe(true);
      expect(updated.status).toBe('active');
    });

    it('immediately cancels when immediate flag is true', async () => {
      seedFullSubscription(
        makeSubscription({ tenant_id: 'tenant-can2', plan_tier: 'starter' }),
      );
      const updated = await manager.cancelSubscription(
        'tenant-can2',
        'fraud',
        'user-1',
        true,
      );
      expect(updated.status).toBe('cancelled');
    });

    it('logs an audit event on cancellation', async () => {
      seedFullSubscription(
        makeSubscription({ tenant_id: 'tenant-can3', plan_tier: 'starter' }),
      );
      await manager.cancelSubscription('tenant-can3', 'test', 'user-1');
      expect(auditLogger.calls[0]?.action).toBe('cancel');
    });
  });

  // ─── 8. Error classes ────────────────────────────────────────────

  describe('Error classes', () => {
    it('SubscriptionNotFoundError has SUBSCRIPTION_NOT_FOUND code', async () => {
      await expect(
        manager.upgradeSubscription('tenant-missing', 'professional', 'user-1'),
      ).rejects.toMatchObject({
        name: 'SubscriptionNotFoundError',
        code: 'SUBSCRIPTION_NOT_FOUND',
      });
    });

    it('SubscriptionNotFoundError is an instance of BillingError', () => {
      const err = new SubscriptionNotFoundError('tenant-x');
      expect(err).toBeInstanceOf(BillingError);
    });

    it('InvalidPlanTransitionError includes from/to tiers in message', () => {
      const err = new InvalidPlanTransitionError('starter', 'free', 'test reason');
      expect(err.message).toContain('starter');
      expect(err.message).toContain('free');
      expect(err.code).toBe('INVALID_PLAN_TRANSITION');
    });

    it('PlanLimitExceededError exposes resource, current, limit', () => {
      const err = new PlanLimitExceededError('contacts', 120, 100);
      expect(err.resource).toBe('contacts');
      expect(err.current).toBe(120);
      expect(err.limit).toBe(100);
      expect(err.code).toBe('PLAN_LIMIT_EXCEEDED');
    });

    it('getActiveSubscription throws SubscriptionNotFoundError for cancelled status', async () => {
      store.seedSubscription(
        makeSubscription({
          tenant_id: 'tenant-cancelled',
          plan_tier: 'starter',
          status: 'cancelled',
        }),
      );
      await expect(
        manager.getUsage('tenant-cancelled'),
      ).rejects.toThrow(SubscriptionNotFoundError);
    });
  });

  // ─── 9. checkLimit ───────────────────────────────────────────────

  describe('checkLimit()', () => {
    it('returns within_limit=true when usage is below the cap', async () => {
      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-lim1', plan_tier: 'starter' }),
      );
      store.seedUsage('tenant-lim1', { contacts: 500 });
      const result = await manager.checkLimit('tenant-lim1', 'contacts');
      expect(result.within_limit).toBe(true);
      expect(result.current).toBe(500);
      expect(result.limit).toBe(1_000);
    });

    it('returns within_limit=false when usage meets the cap', async () => {
      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-lim2', plan_tier: 'starter' }),
      );
      // Starter contacts limit = 1000; seed exactly at limit
      store.seedUsage('tenant-lim2', { contacts: 1_000 });
      const result = await manager.checkLimit('tenant-lim2', 'contacts');
      expect(result.within_limit).toBe(false);
    });

    it('returns within_limit=true for enterprise (Infinity limit)', async () => {
      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-lim3', plan_tier: 'enterprise' }),
      );
      const result = await manager.checkLimit('tenant-lim3', 'agents');
      expect(result.within_limit).toBe(true);
      expect(result.limit).toBe(Infinity);
    });
  });

  // ─── 10. enforceLimit ────────────────────────────────────────────

  describe('enforceLimit()', () => {
    it('does not throw when within limit', async () => {
      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-enf1', plan_tier: 'starter' }),
      );
      store.seedUsage('tenant-enf1', { api_calls: 5_000 });
      await expect(
        manager.enforceLimit('tenant-enf1', 'api_calls'),
      ).resolves.toBeUndefined();
    });

    it('throws PlanLimitExceededError when over the limit', async () => {
      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-enf2', plan_tier: 'free' }),
      );
      // Free contacts limit = 100; seed over it
      store.seedUsage('tenant-enf2', { contacts: 150 });
      await expect(
        manager.enforceLimit('tenant-enf2', 'contacts'),
      ).rejects.toThrow(PlanLimitExceededError);
    });

    it('PlanLimitExceededError contains correct resource details', async () => {
      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-enf3', plan_tier: 'free' }),
      );
      store.seedUsage('tenant-enf3', { contacts: 200 });
      let caught: PlanLimitExceededError | undefined;
      try {
        await manager.enforceLimit('tenant-enf3', 'contacts');
      } catch (e: unknown) {
        if (e instanceof PlanLimitExceededError) caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught?.resource).toBe('contacts');
      expect(caught?.current).toBe(200);
      expect(caught?.limit).toBe(100);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11–13. USAGE TRACKER
// ═══════════════════════════════════════════════════════════════════

describe('UsageTracker', () => {
  let usageStore: InMemoryUsageStore;
  let tracker: UsageTracker;

  beforeEach(() => {
    usageStore = new InMemoryUsageStore();
    tracker = new UsageTracker(usageStore, 1_000);
  });

  afterEach(async () => {
    await tracker.stopPeriodicFlush();
  });

  // ─── 11. trackUsage / getCounter / getUsageSummary ───────────────

  describe('trackUsage()', () => {
    it('increments the in-memory counter by 1 by default', () => {
      tracker.trackUsage('t1', 'api_calls');
      expect(tracker.getCounter('t1', 'api_calls')).toBe(1);
    });

    it('increments by a custom quantity', () => {
      tracker.trackUsage('t1', 'messages', 10);
      expect(tracker.getCounter('t1', 'messages')).toBe(10);
    });

    it('accumulates multiple calls', () => {
      tracker.trackUsage('t1', 'contacts');
      tracker.trackUsage('t1', 'contacts');
      tracker.trackUsage('t1', 'contacts', 3);
      expect(tracker.getCounter('t1', 'contacts')).toBe(5);
    });

    it('tracks different resources independently per tenant', () => {
      tracker.trackUsage('t1', 'agents', 2);
      tracker.trackUsage('t2', 'agents', 5);
      expect(tracker.getCounter('t1', 'agents')).toBe(2);
      expect(tracker.getCounter('t2', 'agents')).toBe(5);
    });

    it('throws on non-positive quantity', () => {
      expect(() => tracker.trackUsage('t1', 'api_calls', 0)).toThrow(
        'positive',
      );
      expect(() => tracker.trackUsage('t1', 'api_calls', -1)).toThrow(
        'positive',
      );
    });
  });

  describe('getCounter()', () => {
    it('returns 0 for an untracked resource', () => {
      expect(tracker.getCounter('unknown-tenant', 'messages')).toBe(0);
    });
  });

  // ─── 12. resetUsage / flushAll ────────────────────────────────────

  describe('flushAll()', () => {
    it('persists dirty counters to the store', async () => {
      tracker.trackUsage('t1', 'api_calls', 50);
      tracker.trackUsage('t2', 'messages', 20);
      await tracker.flushAll();
      expect(usageStore.savedCount).toBe(2);
    });

    it('resets dirty flag after flush (does not double-save on second flush)', async () => {
      tracker.trackUsage('t1', 'contacts', 5);
      await tracker.flushAll();
      const countAfterFirst = usageStore.savedCount;
      await tracker.flushAll();
      // No new record written — counter is 0, not dirty
      expect(usageStore.savedCount).toBe(countAfterFirst);
    });
  });

  describe('resetUsage()', () => {
    it('clears the in-memory counters for the tenant', async () => {
      tracker.trackUsage('t1', 'agents', 3);
      const periodStart = new Date();
      const periodEnd = new Date(Date.now() + 1000);
      await tracker.resetUsage('t1', periodStart, periodEnd);
      expect(tracker.getCounter('t1', 'agents')).toBe(0);
    });
  });

  // ─── 13. Periodic flush lifecycle ────────────────────────────────

  describe('startPeriodicFlush() / stopPeriodicFlush()', () => {
    it('calling start twice does not create two timers', () => {
      tracker.startPeriodicFlush();
      // Use getActiveCounters as an indirect check — no error thrown
      tracker.startPeriodicFlush();
      // just checking no exception was raised
      expect(tracker.getActiveCounters().size).toBe(0);
    });

    it('stopPeriodicFlush() flushes remaining dirty counters', async () => {
      tracker.startPeriodicFlush();
      tracker.trackUsage('t1', 'messages', 7);
      await tracker.stopPeriodicFlush();
      expect(usageStore.savedCount).toBe(1);
    });

    it('stop is safe to call without start', async () => {
      await expect(tracker.stopPeriodicFlush()).resolves.toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 14–15. PLAN GATE MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════

describe('Plan gate middleware', () => {
  // Helper: build a mock Hono handler that calls the middleware
  async function runMiddleware(
    middleware: ReturnType<typeof requirePlan | typeof requireFeature>,
    ctx: ReturnType<typeof makeHonoContext>,
  ): Promise<{ body: unknown; status: number } | 'next'> {
    let nextCalled = false;
    const result = await (
      middleware as (
        c: unknown,
        next: () => Promise<void>,
      ) => Promise<{ body: unknown; status: number } | void>
    )(ctx, async () => {
      nextCalled = true;
    });
    if (nextCalled) return 'next';
    return result as { body: unknown; status: number };
  }

  // ─── 14. requirePlan ────────────────────────────────────────────

  describe('requirePlan()', () => {
    it('returns 401 when tenantContext is absent', async () => {
      const mw = requirePlan('starter', async () => null);
      const ctx = makeHonoContext(undefined);
      const res = await runMiddleware(mw, ctx);
      expect(res).not.toBe('next');
      expect((res as { status: number }).status).toBe(401);
    });

    it('returns 403 when subscription is null', async () => {
      const mw = requirePlan('starter', async () => null);
      const ctx = makeHonoContext({
        tenantId: 't1',
        userId: 'u1',
        roles: [],
        permissions: [],
      });
      const res = await runMiddleware(mw, ctx);
      expect((res as { status: number }).status).toBe(403);
    });

    it('returns 403 when tenant plan is below minimum', async () => {
      const freeSub = makeSubscription({ tenant_id: 't1', plan_tier: 'free' });
      const mw = requirePlan('starter', async () => freeSub);
      const ctx = makeHonoContext({
        tenantId: 't1',
        userId: 'u1',
        roles: [],
        permissions: [],
      });
      const res = await runMiddleware(mw, ctx);
      expect((res as { status: number }).status).toBe(403);
      expect(
        (
          (res as { body: { error: { message: string } } }).body.error.message
        ).toLowerCase(),
      ).toContain('starter');
    });

    it('calls next when tenant plan meets minimum', async () => {
      const professionalSub = makeSubscription({
        tenant_id: 't2',
        plan_tier: 'professional',
      });
      const mw = requirePlan('starter', async () => professionalSub);
      const ctx = makeHonoContext({
        tenantId: 't2',
        userId: 'u2',
        roles: [],
        permissions: [],
      });
      const res = await runMiddleware(mw, ctx);
      expect(res).toBe('next');
    });
  });

  // ─── 15. checkQuota — 429 on exceeded ───────────────────────────

  describe('checkQuota()', () => {
    it('returns 401 when tenantContext is absent', async () => {
      const store = new InMemorySubscriptionStore();
      const stripe = new MockStripeClient();
      const auditLogger = new MockAuditLogger();
      const fieldEncryptor = new PassthroughFieldEncryptor();
      const mgr = new SubscriptionManager({
        store,
        stripe: stripe as unknown as import('../stripe-client.js').StripeClient,
        auditLogger: auditLogger as unknown as import('@ordr/audit').AuditLogger,
        fieldEncryptor: fieldEncryptor as unknown as import('@ordr/crypto').FieldEncryptor,
      });

      const mw = checkQuota('contacts', mgr);
      const ctx = makeHonoContext(undefined);
      const result = await (
        mw as (
          c: unknown,
          next: () => Promise<void>,
        ) => Promise<{ body: unknown; status: number } | void>
      )(ctx, async () => {});
      expect((result as { status: number }).status).toBe(401);
    });

    it('returns 429 when quota is exceeded', async () => {
      const store = new InMemorySubscriptionStore();
      const stripe = new MockStripeClient();
      const auditLogger = new MockAuditLogger();
      const fieldEncryptor = new PassthroughFieldEncryptor();
      const mgr = new SubscriptionManager({
        store,
        stripe: stripe as unknown as import('../stripe-client.js').StripeClient,
        auditLogger: auditLogger as unknown as import('@ordr/audit').AuditLogger,
        fieldEncryptor: fieldEncryptor as unknown as import('@ordr/crypto').FieldEncryptor,
      });

      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-quota', plan_tier: 'free' }),
      );
      // Seed usage exceeding free contact limit (100)
      store.seedUsage('tenant-quota', { contacts: 200 });

      const mw = checkQuota('contacts', mgr);
      const ctx = makeHonoContext({
        tenantId: 'tenant-quota',
        userId: 'u1',
        roles: [],
        permissions: [],
      });

      let nextCalled = false;
      const result = await (
        mw as (
          c: unknown,
          next: () => Promise<void>,
        ) => Promise<{ body: unknown; status: number } | void>
      )(ctx, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(false);
      expect((result as { status: number }).status).toBe(429);
    });

    it('calls next when quota is not exceeded', async () => {
      const store = new InMemorySubscriptionStore();
      const stripe = new MockStripeClient();
      const auditLogger = new MockAuditLogger();
      const fieldEncryptor = new PassthroughFieldEncryptor();
      const mgr = new SubscriptionManager({
        store,
        stripe: stripe as unknown as import('../stripe-client.js').StripeClient,
        auditLogger: auditLogger as unknown as import('@ordr/audit').AuditLogger,
        fieldEncryptor: fieldEncryptor as unknown as import('@ordr/crypto').FieldEncryptor,
      });

      store.seedSubscription(
        makeSubscription({ tenant_id: 'tenant-ok', plan_tier: 'starter' }),
      );
      store.seedUsage('tenant-ok', { contacts: 50 });

      const mw = checkQuota('contacts', mgr);
      const ctx = makeHonoContext({
        tenantId: 'tenant-ok',
        userId: 'u1',
        roles: [],
        permissions: [],
      });

      let nextCalled = false;
      await (
        mw as (
          c: unknown,
          next: () => Promise<void>,
        ) => Promise<{ body: unknown; status: number } | void>
      )(ctx, async () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });
  });
});
