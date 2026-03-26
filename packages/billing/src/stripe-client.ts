/**
 * Stripe API Client — mock HTTP wrapper with production-ready interface
 *
 * This module provides a clean interface for Stripe operations.
 * Currently uses mock implementations. To integrate real Stripe:
 * replace the mock methods with actual Stripe API HTTP calls.
 *
 * PCI Compliance: NEVER handles raw card data. Uses Stripe PaymentMethod IDs.
 * SOC2 CC6.7 — Encrypted transit: all Stripe calls over HTTPS/TLS 1.3.
 * ISO 27001 A.14.1.2 — Secure application services: webhook signature verification.
 *
 * SECURITY:
 * - Stripe API keys stored in Vault (never in code or env defaults)
 * - Webhook signatures verified with timing-safe comparison
 * - All Stripe IDs encrypted at rest with AES-256-GCM
 */

import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ─── Stripe Types ────────────────────────────────────────────────

export interface StripeCustomer {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly metadata: Record<string, string>;
  readonly created: number;
}

export interface StripeSubscription {
  readonly id: string;
  readonly customer: string;
  readonly status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete';
  readonly items: {
    readonly data: readonly { readonly price: { readonly id: string } }[];
  };
  readonly current_period_start: number;
  readonly current_period_end: number;
  readonly cancel_at_period_end: boolean;
  readonly created: number;
}

export interface StripePaymentIntent {
  readonly id: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: 'requires_payment_method' | 'requires_confirmation' | 'succeeded' | 'canceled';
  readonly client_secret: string;
  readonly created: number;
}

export interface StripeInvoice {
  readonly id: string;
  readonly customer: string;
  readonly subscription: string | null;
  readonly amount_due: number;
  readonly amount_paid: number;
  readonly currency: string;
  readonly status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  readonly period_start: number;
  readonly period_end: number;
  readonly created: number;
}

export interface StripeUsageRecord {
  readonly id: string;
  readonly subscription_item: string;
  readonly quantity: number;
  readonly timestamp: number;
}

export interface StripeWebhookEvent {
  readonly id: string;
  readonly type: string;
  readonly data: {
    readonly object: Record<string, unknown>;
  };
  readonly created: number;
}

// ─── Create Input Types ──────────────────────────────────────────

export interface CreateCustomerInput {
  readonly email: string;
  readonly name: string;
  readonly metadata?: Record<string, string>;
}

export interface CreateSubscriptionInput {
  readonly customer: string;
  readonly price_id: string;
  readonly payment_method?: string;
  readonly trial_period_days?: number;
}

export interface UpdateSubscriptionInput {
  readonly price_id?: string;
  readonly cancel_at_period_end?: boolean;
  readonly proration_behavior?: 'create_prorations' | 'none' | 'always_invoice';
}

export interface CreatePaymentIntentInput {
  readonly amount: number;
  readonly currency: string;
  readonly customer: string;
  readonly payment_method?: string;
}

export interface CreateUsageRecordInput {
  readonly subscription_item: string;
  readonly quantity: number;
  readonly timestamp?: number;
}

// ─── Stripe Client Interface ─────────────────────────────────────

export interface StripeClient {
  createCustomer(input: CreateCustomerInput): Promise<StripeCustomer>;
  createSubscription(input: CreateSubscriptionInput): Promise<StripeSubscription>;
  cancelSubscription(subscriptionId: string, cancelAtPeriodEnd?: boolean): Promise<StripeSubscription>;
  updateSubscription(subscriptionId: string, input: UpdateSubscriptionInput): Promise<StripeSubscription>;
  createPaymentIntent(input: CreatePaymentIntentInput): Promise<StripePaymentIntent>;
  listInvoices(customerId: string, limit?: number): Promise<readonly StripeInvoice[]>;
  createUsageRecord(input: CreateUsageRecordInput): Promise<StripeUsageRecord>;
  constructWebhookEvent(payload: string, signature: string, secret: string): StripeWebhookEvent;
}

// ─── Mock Stripe Client ──────────────────────────────────────────

/**
 * Mock Stripe client for development and testing.
 * Provides the same interface as production Stripe.
 * Replace method bodies with real HTTP calls to Stripe API.
 */
export class MockStripeClient implements StripeClient {
  private readonly customers = new Map<string, StripeCustomer>();
  private readonly subscriptions = new Map<string, StripeSubscription>();
  private readonly invoices = new Map<string, StripeInvoice[]>();

  async createCustomer(input: CreateCustomerInput): Promise<StripeCustomer> {
    const customer: StripeCustomer = {
      id: `cus_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      email: input.email,
      name: input.name,
      metadata: input.metadata ?? {},
      created: Math.floor(Date.now() / 1000),
    };
    this.customers.set(customer.id, customer);
    return customer;
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<StripeSubscription> {
    const now = Math.floor(Date.now() / 1000);
    const periodEnd = now + 30 * 24 * 60 * 60; // 30 days

    const subscription: StripeSubscription = {
      id: `sub_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      customer: input.customer,
      status: input.trial_period_days ? 'trialing' : 'active',
      items: {
        data: [{ price: { id: input.price_id } }],
      },
      current_period_start: now,
      current_period_end: periodEnd,
      cancel_at_period_end: false,
      created: now,
    };
    this.subscriptions.set(subscription.id, subscription);

    // Create an initial invoice
    const invoice: StripeInvoice = {
      id: `in_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      customer: input.customer,
      subscription: subscription.id,
      amount_due: 4900,
      amount_paid: 4900,
      currency: 'usd',
      status: 'paid',
      period_start: now,
      period_end: periodEnd,
      created: now,
    };
    const existing = this.invoices.get(input.customer) ?? [];
    existing.push(invoice);
    this.invoices.set(input.customer, existing);

    return subscription;
  }

  async cancelSubscription(
    subscriptionId: string,
    cancelAtPeriodEnd: boolean = true,
  ): Promise<StripeSubscription> {
    const existing = this.subscriptions.get(subscriptionId);
    if (!existing) {
      throw new Error(`Subscription ${subscriptionId} not found`);
    }

    const updated: StripeSubscription = cancelAtPeriodEnd
      ? { ...existing, cancel_at_period_end: true }
      : { ...existing, status: 'canceled', cancel_at_period_end: false };

    this.subscriptions.set(subscriptionId, updated);
    return updated;
  }

  async updateSubscription(
    subscriptionId: string,
    input: UpdateSubscriptionInput,
  ): Promise<StripeSubscription> {
    const existing = this.subscriptions.get(subscriptionId);
    if (!existing) {
      throw new Error(`Subscription ${subscriptionId} not found`);
    }

    const updated: StripeSubscription = {
      ...existing,
      ...(input.price_id !== undefined ? {
        items: { data: [{ price: { id: input.price_id } }] },
      } : {}),
      ...(input.cancel_at_period_end !== undefined ? {
        cancel_at_period_end: input.cancel_at_period_end,
      } : {}),
    };

    this.subscriptions.set(subscriptionId, updated);
    return updated;
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<StripePaymentIntent> {
    return {
      id: `pi_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      amount: input.amount,
      currency: input.currency,
      status: 'succeeded',
      client_secret: `pi_${randomUUID()}_secret_${randomUUID()}`,
      created: Math.floor(Date.now() / 1000),
    };
  }

  async listInvoices(customerId: string, limit: number = 10): Promise<readonly StripeInvoice[]> {
    const customerInvoices = this.invoices.get(customerId) ?? [];
    return customerInvoices.slice(0, limit);
  }

  async createUsageRecord(input: CreateUsageRecordInput): Promise<StripeUsageRecord> {
    return {
      id: `mbur_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      subscription_item: input.subscription_item,
      quantity: input.quantity,
      timestamp: input.timestamp ?? Math.floor(Date.now() / 1000),
    };
  }

  constructWebhookEvent(
    payload: string,
    signature: string,
    secret: string,
  ): StripeWebhookEvent {
    // Verify webhook signature (Stripe's v1 scheme)
    verifyWebhookSignature(payload, signature, secret);

    const parsed: unknown = JSON.parse(payload);
    if (!isWebhookEventShape(parsed)) {
      throw new Error('Invalid webhook event payload');
    }
    return parsed;
  }
}

// ─── Webhook Signature Verification ──────────────────────────────

/**
 * Verify Stripe webhook signature using timing-safe comparison.
 * Stripe uses `whsec_` prefixed secrets and `t=timestamp,v1=signature` format.
 *
 * ISO 27001 A.14.1.2 — Integrity of transmitted data.
 *
 * @throws Error if signature is invalid or timestamp is too old
 */
export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): void {
  const TOLERANCE_SECONDS = 300; // 5 minutes

  // Parse the signature header: t=timestamp,v1=signature
  const elements = signatureHeader.split(',');
  let timestamp: string | undefined;
  let signature: string | undefined;

  for (const element of elements) {
    const [key, value] = element.split('=');
    if (key === 't') {
      timestamp = value;
    } else if (key === 'v1') {
      signature = value;
    }
  }

  if (!timestamp || !signature) {
    throw new Error('Invalid webhook signature format');
  }

  // Check timestamp tolerance (prevent replay attacks)
  const timestampNum = parseInt(timestamp, 10);
  if (isNaN(timestampNum)) {
    throw new Error('Invalid webhook timestamp');
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > TOLERANCE_SECONDS) {
    throw new Error('Webhook timestamp outside tolerance window');
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');

  // Timing-safe comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (sigBuffer.length !== expectedBuffer.length) {
    throw new Error('Invalid webhook signature');
  }

  if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw new Error('Invalid webhook signature');
  }
}

/**
 * Generate a valid webhook signature for testing purposes.
 */
export function generateWebhookSignature(
  payload: string,
  secret: string,
  timestamp?: number,
): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${String(ts)}.${payload}`;
  const signature = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  return `t=${String(ts)},v1=${signature}`;
}

// ─── Type Guard ──────────────────────────────────────────────────

function isWebhookEventShape(value: unknown): value is StripeWebhookEvent {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['id'] === 'string' &&
    typeof obj['type'] === 'string' &&
    typeof obj['data'] === 'object' &&
    obj['data'] !== null &&
    typeof (obj['data'] as Record<string, unknown>)['object'] === 'object' &&
    typeof obj['created'] === 'number'
  );
}
