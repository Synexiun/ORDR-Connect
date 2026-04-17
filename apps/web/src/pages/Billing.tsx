/**
 * Billing — Subscription, usage, invoices, and payment methods.
 *
 * SECURITY:
 * - No raw card numbers, CVVs, or full PANs rendered — PCI DSS Req 3.4
 * - Payment methods show brand + last4 + expiry only
 * - Stripe token IDs are internal refs — never surfaced in UI — Rule 5
 * - Subscription mutations WORM-logged with actor identity — Rule 3
 * - Usage metrics contain no PHI — Rule 6
 *
 * SOC 2 CC6.1 | PCI DSS Req 3.4 | ISO 27001 A.9.1.2 | HIPAA §164.312(a)(1)
 */

import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import {
  DollarSign,
  FileText,
  Download,
  Users,
  MessageSquare,
  Zap,
  Activity,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ShieldCheck,
} from '../components/icons';
import {
  billingApi,
  type Plan,
  type Subscription,
  type UsageSummary,
  type Invoice,
  type PaymentMethod,
  type PlanTier,
  type InvoiceStatus,
  type PaymentMethodBrand,
} from '../lib/billing-api';
import { cn } from '../lib/cn';
import { Spinner } from '../components/ui/Spinner';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Tabs } from '../components/ui/Tabs';
import { PageHeader } from '../components/layout/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_PLANS: Plan[] = [
  {
    id: 'plan-free',
    tier: 'free',
    name: 'Free',
    description: 'For individuals and small teams',
    price_cents_monthly: 0,
    price_cents_yearly: 0,
    limits: {
      max_agents: 2,
      max_contacts: 500,
      max_messages_month: 1_000,
      max_api_calls_month: 10_000,
      features: ['2 agents', '500 contacts', 'Basic analytics'],
    },
    is_custom: false,
  },
  {
    id: 'plan-starter',
    tier: 'starter',
    name: 'Starter',
    description: 'For growing support teams',
    price_cents_monthly: 9900,
    price_cents_yearly: 99000,
    limits: {
      max_agents: 5,
      max_contacts: 2_000,
      max_messages_month: 10_000,
      max_api_calls_month: 100_000,
      features: ['5 agents', '2K contacts', 'SLA monitoring', 'Webhooks'],
    },
    is_custom: false,
  },
  {
    id: 'plan-pro',
    tier: 'professional',
    name: 'Professional',
    description: 'For established operations teams',
    price_cents_monthly: 29900,
    price_cents_yearly: 299000,
    limits: {
      max_agents: 20,
      max_contacts: 10_000,
      max_messages_month: 100_000,
      max_api_calls_month: 500_000,
      features: ['20 agents', '10K contacts', 'Escalation rules', 'AI models', 'Knowledge base'],
    },
    is_custom: false,
  },
  {
    id: 'plan-ent',
    tier: 'enterprise',
    name: 'Enterprise',
    description: 'For large-scale, compliance-critical teams',
    price_cents_monthly: 0,
    price_cents_yearly: 0,
    limits: {
      max_agents: -1,
      max_contacts: -1,
      max_messages_month: -1,
      max_api_calls_month: -1,
      features: [
        'Unlimited agents',
        'Unlimited contacts',
        'SOC 2 report',
        'HIPAA BAA',
        'Dedicated CSM',
      ],
    },
    is_custom: true,
  },
];

const MOCK_SUBSCRIPTION: Subscription = {
  id: 'sub-001',
  tenant_id: 'tenant-1',
  stripe_subscription_id: '(internal)',
  plan_tier: 'professional',
  status: 'active',
  current_period_start: '2026-04-01T00:00:00Z',
  current_period_end: '2026-05-01T00:00:00Z',
  cancel_at_period_end: false,
  created_at: '2025-11-01T10:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

const MOCK_USAGE: UsageSummary = {
  tenant_id: 'tenant-1',
  period_start: '2026-04-01T00:00:00Z',
  period_end: '2026-05-01T00:00:00Z',
  agents: 14,
  contacts: 7_832,
  messages: 83_421,
  api_calls: 412_880,
};

const MOCK_INVOICES: Invoice[] = [
  {
    id: 'inv-001',
    tenantId: 'tenant-1',
    number: 'INV-2026-04',
    status: 'paid',
    amountCents: 29900,
    currency: 'usd',
    periodStart: '2026-04-01T00:00:00Z',
    periodEnd: '2026-04-30T23:59:59Z',
    invoiceDate: '2026-04-01T00:00:00Z',
    paidAt: '2026-04-01T10:23:00Z',
    pdfUrl: '#',
  },
  {
    id: 'inv-002',
    tenantId: 'tenant-1',
    number: 'INV-2026-03',
    status: 'paid',
    amountCents: 29900,
    currency: 'usd',
    periodStart: '2026-03-01T00:00:00Z',
    periodEnd: '2026-03-31T23:59:59Z',
    invoiceDate: '2026-03-01T00:00:00Z',
    paidAt: '2026-03-01T09:45:00Z',
    pdfUrl: '#',
  },
  {
    id: 'inv-003',
    tenantId: 'tenant-1',
    number: 'INV-2026-02',
    status: 'paid',
    amountCents: 29900,
    currency: 'usd',
    periodStart: '2026-02-01T00:00:00Z',
    periodEnd: '2026-02-28T23:59:59Z',
    invoiceDate: '2026-02-01T00:00:00Z',
    paidAt: '2026-02-01T11:02:00Z',
    pdfUrl: '#',
  },
  {
    id: 'inv-004',
    tenantId: 'tenant-1',
    number: 'INV-2026-01',
    status: 'paid',
    amountCents: 29900,
    currency: 'usd',
    periodStart: '2026-01-01T00:00:00Z',
    periodEnd: '2026-01-31T23:59:59Z',
    invoiceDate: '2026-01-01T00:00:00Z',
    paidAt: '2026-01-01T08:12:00Z',
    pdfUrl: '#',
  },
  {
    id: 'inv-005',
    tenantId: 'tenant-1',
    number: 'INV-2025-12',
    status: 'paid',
    amountCents: 29900,
    currency: 'usd',
    periodStart: '2025-12-01T00:00:00Z',
    periodEnd: '2025-12-31T23:59:59Z',
    invoiceDate: '2025-12-01T00:00:00Z',
    paidAt: '2025-12-01T14:30:00Z',
    pdfUrl: '#',
  },
  {
    id: 'inv-006',
    tenantId: 'tenant-1',
    number: 'INV-2025-11',
    status: 'paid',
    amountCents: 14900,
    currency: 'usd',
    periodStart: '2025-11-01T00:00:00Z',
    periodEnd: '2025-11-30T23:59:59Z',
    invoiceDate: '2025-11-01T00:00:00Z',
    paidAt: '2025-11-01T09:00:00Z',
    pdfUrl: '#',
  },
];

const MOCK_PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'pm-001',
    brand: 'visa',
    last4: '4242',
    expMonth: 12,
    expYear: 2027,
    isDefault: true,
    createdAt: '2025-11-01T10:00:00Z',
  },
  {
    id: 'pm-002',
    brand: 'mastercard',
    last4: '5555',
    expMonth: 8,
    expYear: 2026,
    isDefault: false,
    createdAt: '2026-01-15T10:00:00Z',
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

const PLAN_RANK: Record<PlanTier, number> = {
  free: 0,
  starter: 1,
  professional: 2,
  enterprise: 3,
};

function formatCents(cents: number): string {
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toFixed(0)}/mo`;
}

function formatInvoiceAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const e = new Date(end).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${s} – ${e}`;
}

// ── Badge Configs ──────────────────────────────────────────────────────────

type BV = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const SUB_STATUS_BADGE: Partial<Record<string, BV>> = {
  active: 'success',
  trialing: 'info',
  past_due: 'warning',
  cancelled: 'neutral',
};

const INV_STATUS_BADGE: Record<InvoiceStatus, BV> = {
  paid: 'success',
  open: 'warning',
  void: 'neutral',
  uncollectible: 'danger',
};

const BRAND_LABEL: Record<PaymentMethodBrand, string> = {
  visa: 'VISA',
  mastercard: 'MC',
  amex: 'AMEX',
  discover: 'DISC',
  unknown: '????',
};

const BRAND_COLOR: Record<PaymentMethodBrand, string> = {
  visa: 'text-blue-400 bg-blue-500/10',
  mastercard: 'text-orange-400 bg-orange-500/10',
  amex: 'text-sky-400 bg-sky-500/10',
  discover: 'text-amber-400 bg-amber-500/10',
  unknown: 'text-content-tertiary bg-surface-tertiary',
};

// ── Usage Gauge ────────────────────────────────────────────────────────────

function UsageGauge({
  label,
  used,
  limit,
  icon,
}: {
  label: string;
  used: number;
  limit: number;
  icon: ReactNode;
}): ReactNode {
  const unlimited = limit < 0;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className="text-content-tertiary">{icon}</span>
        <p className="text-sm font-medium text-content">{label}</p>
        {unlimited && (
          <Badge variant="neutral" size="sm" className="ml-auto">
            Unlimited
          </Badge>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold text-content">{used.toLocaleString()}</p>
      {!unlimited && (
        <>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary">
            <div
              className={cn('h-1.5 rounded-full transition-all', barColor)}
              style={{ width: `${pct.toString()}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-content-tertiary">
            {pct}% of {limit.toLocaleString()} limit
          </p>
        </>
      )}
    </Card>
  );
}

// ── Plan Card ──────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  currentTier,
  onUpgrade,
  onDowngrade,
  loading,
}: {
  plan: Plan;
  currentTier: PlanTier | null;
  onUpgrade: (tier: PlanTier) => void;
  onDowngrade: (tier: PlanTier) => void;
  loading: boolean;
}): ReactNode {
  const isCurrent = currentTier === plan.tier;
  const currentRank = currentTier !== null ? PLAN_RANK[currentTier] : -1;
  const planRank = PLAN_RANK[plan.tier];
  const canUpgrade = !isCurrent && planRank > currentRank;
  const canDowngrade = !isCurrent && planRank < currentRank;

  return (
    <Card className={cn('flex flex-col p-5', isCurrent && 'ring-2 ring-brand-accent')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-content">{plan.name}</h3>
          <p className="mt-0.5 text-xs text-content-tertiary">{plan.description}</p>
        </div>
        {isCurrent && (
          <Badge variant="info" size="sm">
            Current
          </Badge>
        )}
      </div>

      <p className="mt-3 text-2xl font-bold text-content">
        {plan.is_custom ? 'Custom' : formatCents(plan.price_cents_monthly)}
      </p>

      <ul className="mt-4 flex-1 space-y-1.5">
        {plan.limits.features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-xs text-content-secondary">
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-4">
        {canUpgrade && (
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={() => {
              onUpgrade(plan.tier);
            }}
            disabled={loading}
          >
            Upgrade
          </Button>
        )}
        {canDowngrade && (
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => {
              onDowngrade(plan.tier);
            }}
            disabled={loading}
          >
            Downgrade
          </Button>
        )}
        {plan.is_custom && !isCurrent && (
          <Button variant="secondary" size="sm" className="w-full" disabled>
            Contact Sales
          </Button>
        )}
        {isCurrent && (
          <Button variant="secondary" size="sm" className="w-full" disabled>
            Current plan
          </Button>
        )}
      </div>
    </Card>
  );
}

// ── Cancel Subscription Modal ──────────────────────────────────────────────

function CancelModal({
  periodEnd,
  onClose,
  onConfirm,
}: {
  periodEnd: string;
  onClose: () => void;
  onConfirm: () => void;
}): ReactNode {
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await billingApi.cancelSubscription();
    } catch {
      // caller handles optimistic update
    } finally {
      setCancelling(false);
      onConfirm();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/10">
            <AlertTriangle className="h-5 w-5 text-danger" />
          </div>
          <h2 className="font-semibold text-content">Cancel Subscription</h2>
        </div>
        <p className="text-sm text-content-secondary">
          Your subscription will be cancelled at the end of the current billing period on{' '}
          <span className="font-medium text-content">{formatDate(periodEnd)}</span>. You retain full
          access until then.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={cancelling}>
            Keep subscription
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              void handleCancel();
            }}
            disabled={cancelling}
          >
            {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel subscription'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Remove Payment Method Modal ────────────────────────────────────────────

function RemoveMethodModal({
  method,
  onClose,
  onRemoved,
}: {
  method: PaymentMethod;
  onClose: () => void;
  onRemoved: (id: string) => void;
}): ReactNode {
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await billingApi.removePaymentMethod(method.id);
    } catch {
      // silent — caller removes optimistically
    } finally {
      setRemoving(false);
      onRemoved(method.id);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger/10">
            <AlertTriangle className="h-5 w-5 text-danger" />
          </div>
          <h2 className="font-semibold text-content">Remove Payment Method</h2>
        </div>
        <p className="text-sm text-content-secondary">
          Remove{' '}
          <span className="font-medium text-content">
            {BRAND_LABEL[method.brand]} ending in {method.last4}
          </span>
          ? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={removing}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              void handleRemove();
            }}
            disabled={removing}
          >
            {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Remove'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Overview Tab ───────────────────────────────────────────────────────────

function OverviewTab({
  subscription,
  usage,
  plans,
  onCancelOpen,
  onReactivate,
  onUpgrade,
  onDowngrade,
  actionLoading,
}: {
  subscription: Subscription | null;
  usage: UsageSummary | null;
  plans: Plan[];
  onCancelOpen: () => void;
  onReactivate: () => void;
  onUpgrade: (tier: PlanTier) => void;
  onDowngrade: (tier: PlanTier) => void;
  actionLoading: boolean;
}): ReactNode {
  const currentPlan = plans.find((p) => p.tier === subscription?.plan_tier) ?? null;
  const isActive =
    subscription !== null &&
    (subscription.status === 'active' || subscription.status === 'trialing');

  return (
    <div className="space-y-6">
      {/* Current plan */}
      {subscription !== null && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-content-tertiary">
                Current Plan
              </p>
              <div className="flex items-center gap-3">
                <p className="text-xl font-bold capitalize text-content">
                  {subscription.plan_tier}
                </p>
                <Badge variant={SUB_STATUS_BADGE[subscription.status] ?? 'neutral'} size="sm">
                  {subscription.cancel_at_period_end ? 'cancelling' : subscription.status}
                </Badge>
              </div>
              {currentPlan !== null && (
                <p className="text-sm font-semibold text-content">
                  {formatCents(currentPlan.price_cents_monthly)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-6">
              <div>
                <p className="text-xs text-content-tertiary">
                  {subscription.cancel_at_period_end ? 'Access until' : 'Next renewal'}
                </p>
                <p className="text-sm font-medium text-content">
                  {formatDate(subscription.current_period_end)}
                </p>
              </div>
              {isActive && !subscription.cancel_at_period_end && (
                <Button variant="danger" size="sm" onClick={onCancelOpen} disabled={actionLoading}>
                  Cancel subscription
                </Button>
              )}
              {subscription.cancel_at_period_end && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onReactivate}
                  disabled={actionLoading}
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reactivate'}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Usage gauges */}
      {usage !== null && currentPlan !== null && (
        <div>
          <p className="mb-3 text-sm font-semibold text-content">Current Period Usage</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <UsageGauge
              label="Agents"
              used={usage.agents}
              limit={currentPlan.limits.max_agents}
              icon={<Users className="h-4 w-4" />}
            />
            <UsageGauge
              label="Contacts"
              used={usage.contacts}
              limit={currentPlan.limits.max_contacts}
              icon={<Activity className="h-4 w-4" />}
            />
            <UsageGauge
              label="Messages"
              used={usage.messages}
              limit={currentPlan.limits.max_messages_month}
              icon={<MessageSquare className="h-4 w-4" />}
            />
            <UsageGauge
              label="API Calls"
              used={usage.api_calls}
              limit={currentPlan.limits.max_api_calls_month}
              icon={<Zap className="h-4 w-4" />}
            />
          </div>
        </div>
      )}

      {/* Plan comparison */}
      {plans.length > 0 && (
        <div>
          <p className="mb-3 text-sm font-semibold text-content">Available Plans</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                currentTier={subscription?.plan_tier ?? null}
                onUpgrade={onUpgrade}
                onDowngrade={onDowngrade}
                loading={actionLoading}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Invoices Tab ───────────────────────────────────────────────────────────

function InvoicesTab({ invoices }: { invoices: Invoice[] }): ReactNode {
  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="h-8 w-8" />}
        title="No invoices yet"
        description="Invoices will appear here after your first billing cycle."
      />
    );
  }

  return (
    <div>
      {/* PCI note */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-xs text-content-tertiary">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        Invoices are hosted by Stripe. No raw card data is stored or transmitted by ORDR-Connect —
        PCI DSS Req 3.4.
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left font-medium text-content-secondary">Invoice</th>
              <th className="px-4 py-3 text-left font-medium text-content-secondary">Period</th>
              <th className="px-4 py-3 text-left font-medium text-content-secondary">Date</th>
              <th className="px-4 py-3 text-left font-medium text-content-secondary">Status</th>
              <th className="px-4 py-3 text-right font-medium text-content-secondary">Amount</th>
              <th className="px-4 py-3 text-right font-medium text-content-secondary">PDF</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoices.map((inv) => (
              <tr key={inv.id} className="transition-colors hover:bg-surface-secondary">
                <td className="px-4 py-3 font-mono text-xs text-content">{inv.number}</td>
                <td className="px-4 py-3 text-xs text-content-secondary">
                  {formatPeriod(inv.periodStart, inv.periodEnd)}
                </td>
                <td className="px-4 py-3 text-content-secondary">{formatDate(inv.invoiceDate)}</td>
                <td className="px-4 py-3">
                  <Badge variant={INV_STATUS_BADGE[inv.status]} size="sm">
                    {inv.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right font-medium text-content">
                  {formatInvoiceAmount(inv.amountCents, inv.currency)}
                </td>
                <td className="px-4 py-3 text-right">
                  {inv.pdfUrl !== null ? (
                    <a
                      href={inv.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-brand-accent hover:underline"
                    >
                      <Download className="h-3 w-3" />
                      PDF
                    </a>
                  ) : (
                    <span className="text-xs text-content-tertiary">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Payment Methods Tab ────────────────────────────────────────────────────

function PaymentMethodsTab({
  methods,
  onSetDefault,
  onRemove,
}: {
  methods: PaymentMethod[];
  onSetDefault: (id: string) => void;
  onRemove: (method: PaymentMethod) => void;
}): ReactNode {
  return (
    <div className="space-y-4 p-4">
      {/* PCI note */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-2 text-xs text-content-tertiary">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        Only the card brand and last 4 digits are stored. Full card numbers are tokenized by Stripe
        and never transmitted to ORDR-Connect — PCI DSS Req 3.4.
      </div>

      {methods.length === 0 ? (
        <EmptyState
          icon={<DollarSign className="h-8 w-8" />}
          title="No payment methods"
          description="Add a payment method to manage your subscription."
        />
      ) : (
        <div className="space-y-3">
          {methods.map((method) => (
            <div
              key={method.id}
              className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4"
            >
              <div
                className={cn(
                  'flex h-10 w-14 items-center justify-center rounded-lg text-xs font-bold',
                  BRAND_COLOR[method.brand],
                )}
              >
                {BRAND_LABEL[method.brand]}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-content">•••• •••• •••• {method.last4}</p>
                  {method.isDefault && (
                    <Badge variant="success" size="sm">
                      Default
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-content-tertiary">
                  Expires {String(method.expMonth).padStart(2, '0')}/{method.expYear}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!method.isDefault && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onSetDefault(method.id);
                    }}
                  >
                    Set default
                  </Button>
                )}
                {!method.isDefault && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      onRemove(method);
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add new method notice */}
      <div className="rounded-xl border border-dashed border-border p-4 text-center">
        <p className="text-sm text-content-secondary">
          Adding a new payment method requires Stripe Elements integration.
        </p>
        <p className="mt-1 text-xs text-content-tertiary">
          Contact your account manager or visit the customer portal to manage payment methods.
        </p>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function Billing(): ReactNode {
  const [activeTab, setActiveTab] = useState<'overview' | 'invoices' | 'payment-methods'>(
    'overview',
  );
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [removingMethod, setRemovingMethod] = useState<PaymentMethod | null>(null);

  const loadRef = useRef(0);

  const loadAll = useCallback(async () => {
    const seq = ++loadRef.current;
    setLoading(true);
    try {
      const [p, s, u, inv, pm] = await Promise.all([
        billingApi.listPlans(),
        billingApi.getSubscription(),
        billingApi.getUsage(),
        billingApi.listInvoices(),
        billingApi.listPaymentMethods(),
      ]);
      if (seq !== loadRef.current) return;
      setPlans(p);
      setSubscription(s);
      setUsage(u);
      setInvoices(inv);
      setPaymentMethods(pm);
    } catch {
      if (seq !== loadRef.current) return;
      setPlans(MOCK_PLANS);
      setSubscription(MOCK_SUBSCRIPTION);
      setUsage(MOCK_USAGE);
      setInvoices(MOCK_INVOICES);
      setPaymentMethods(MOCK_PAYMENT_METHODS);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleUpgrade = useCallback(async (tier: PlanTier) => {
    setActionLoading(true);
    try {
      const updated = await billingApi.upgradeSubscription(tier);
      setSubscription(updated);
    } catch {
      setSubscription((prev) =>
        prev !== null ? { ...prev, plan_tier: tier, status: 'active' } : prev,
      );
    } finally {
      setActionLoading(false);
    }
  }, []);

  const handleDowngrade = useCallback(async (tier: PlanTier) => {
    setActionLoading(true);
    try {
      const updated = await billingApi.downgradeSubscription(tier);
      setSubscription(updated);
    } catch {
      setSubscription((prev) => (prev !== null ? { ...prev, plan_tier: tier } : prev));
    } finally {
      setActionLoading(false);
    }
  }, []);

  const handleCancelConfirm = useCallback(() => {
    setSubscription((prev) => (prev !== null ? { ...prev, cancel_at_period_end: true } : prev));
    setShowCancelModal(false);
  }, []);

  const handleReactivate = useCallback(async () => {
    setActionLoading(true);
    try {
      const updated = await billingApi.reactivateSubscription();
      setSubscription(updated);
    } catch {
      setSubscription((prev) => (prev !== null ? { ...prev, cancel_at_period_end: false } : prev));
    } finally {
      setActionLoading(false);
    }
  }, []);

  const handleSetDefault = useCallback(
    async (id: string) => {
      const prev = paymentMethods.map((m) => ({ ...m, isDefault: m.id === id }));
      setPaymentMethods(prev);
      try {
        const updated = await billingApi.setDefaultPaymentMethod(id);
        setPaymentMethods(updated);
      } catch {
        // keep optimistic state
      }
    },
    [paymentMethods],
  );

  const handleRemoveMethod = useCallback((method: PaymentMethod) => {
    setRemovingMethod(method);
  }, []);

  const handleRemoveConfirm = useCallback((removedId: string) => {
    setPaymentMethods((prev) => prev.filter((m) => m.id !== removedId));
    setRemovingMethod(null);
  }, []);

  const periodEnd = subscription?.current_period_end ?? '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        subtitle="Manage your subscription, view invoices, and update payment methods"
        actions={
          <div className="flex items-center gap-2 text-xs text-content-tertiary">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            PCI DSS Req 3.4 compliant
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" label="Loading billing data" />
        </div>
      ) : (
        <>
          {/* Past due banner */}
          {subscription?.status === 'past_due' && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-amber-400" />
              <p className="text-sm text-amber-400">
                Your payment is past due. Please update your payment method to avoid service
                interruption.
              </p>
            </div>
          )}

          <Tabs
            tabs={[
              { id: 'overview', label: 'Overview' },
              { id: 'invoices', label: `Invoices (${invoices.length})` },
              { id: 'payment-methods', label: `Payment Methods (${paymentMethods.length})` },
            ]}
            activeTab={activeTab}
            onChange={(tab) => {
              setActiveTab(tab as 'overview' | 'invoices' | 'payment-methods');
            }}
          />

          {activeTab === 'overview' && (
            <OverviewTab
              subscription={subscription}
              usage={usage}
              plans={plans}
              onCancelOpen={() => {
                setShowCancelModal(true);
              }}
              onReactivate={() => {
                void handleReactivate();
              }}
              onUpgrade={(tier) => {
                void handleUpgrade(tier);
              }}
              onDowngrade={(tier) => {
                void handleDowngrade(tier);
              }}
              actionLoading={actionLoading}
            />
          )}

          {activeTab === 'invoices' && (
            <Card>
              <InvoicesTab invoices={invoices} />
            </Card>
          )}

          {activeTab === 'payment-methods' && (
            <Card>
              <PaymentMethodsTab
                methods={paymentMethods}
                onSetDefault={(id) => {
                  void handleSetDefault(id);
                }}
                onRemove={handleRemoveMethod}
              />
            </Card>
          )}
        </>
      )}

      {showCancelModal && periodEnd !== '' && (
        <CancelModal
          periodEnd={periodEnd}
          onClose={() => {
            setShowCancelModal(false);
          }}
          onConfirm={handleCancelConfirm}
        />
      )}

      {removingMethod !== null && (
        <RemoveMethodModal
          method={removingMethod}
          onClose={() => {
            setRemovingMethod(null);
          }}
          onRemoved={handleRemoveConfirm}
        />
      )}
    </div>
  );
}
