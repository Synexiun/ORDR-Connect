/**
 * Billing — Subscription management and usage overview.
 *
 * Shows the current subscription, usage metrics, and available plans
 * with upgrade/downgrade/cancel actions.
 *
 * SOC2 CC6.1 — Subscription data is tenant-scoped.
 * PCI CC6.1 — No card data rendered; only plan and status metadata.
 * ISO 27001 A.9.1.2 — Plan tier governs feature access.
 * HIPAA §164.312(a)(1) — Usage metrics contain no PHI.
 *
 * COMPLIANCE: Never render payment method IDs, Stripe customer IDs,
 * or any financial credentials on screen.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { PageHeader } from '../components/layout/PageHeader';
import {
  AlertCircle,
  CheckCircle2,
  Users,
  MessageSquare,
  Zap,
  Activity,
} from '../components/icons';
import {
  billingApi,
  type Plan,
  type Subscription,
  type UsageSummary,
  type PlanTier,
} from '../lib/billing-api';
import { useToast } from '../hooks/useToast';

// ── Helpers ───────────────────────────────────────────────────────

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatNumber(n: number): string {
  if (n < 0) return 'Unlimited';
  return n >= 1_000_000 ? '∞' : n.toLocaleString();
}

type BadgeVariant = 'info' | 'warning' | 'success' | 'danger' | 'neutral';

const statusVariant: Record<string, BadgeVariant> = {
  active: 'success',
  trialing: 'info',
  past_due: 'warning',
  cancelled: 'neutral',
};

// ── Sub-components ────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: ReactNode;
}

function KpiCard({ label, value, sub, icon }: KpiCardProps): ReactNode {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-blue-50 p-2 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{value}</p>
          {sub !== undefined && <p className="text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

interface PlanCardProps {
  plan: Plan;
  currentTier: PlanTier | null;
  onUpgrade: (tier: PlanTier) => void;
  onDowngrade: (tier: PlanTier) => void;
  loading: boolean;
}

function PlanCard({
  plan,
  currentTier,
  onUpgrade,
  onDowngrade,
  loading,
}: PlanCardProps): ReactNode {
  const isCurrent = currentTier === plan.tier;
  const currentRank = currentTier !== null ? PLAN_RANK[currentTier] : -1;
  const planRank = PLAN_RANK[plan.tier];
  const canUpgrade = !isCurrent && planRank > currentRank;
  const canDowngrade = !isCurrent && planRank < currentRank;

  return (
    <Card
      className={`flex flex-col p-5 ${isCurrent ? 'ring-2 ring-blue-500' : ''}`}
      data-testid={`plan-card-${plan.tier}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">{plan.name}</h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{plan.description}</p>
        </div>
        {isCurrent && (
          <Badge variant="info" size="sm">
            Current plan
          </Badge>
        )}
      </div>

      <p className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">
        {plan.is_custom ? 'Custom' : formatCents(plan.price_cents_monthly)}
      </p>

      <ul className="mt-4 flex-1 space-y-1.5">
        <li className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <Users className="h-3.5 w-3.5 text-gray-400" />
          {formatNumber(plan.limits.max_agents)} agents
        </li>
        <li className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <Activity className="h-3.5 w-3.5 text-gray-400" />
          {formatNumber(plan.limits.max_contacts)} contacts
        </li>
        <li className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <MessageSquare className="h-3.5 w-3.5 text-gray-400" />
          {formatNumber(plan.limits.max_messages_month)} messages/mo
        </li>
        <li className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <Zap className="h-3.5 w-3.5 text-gray-400" />
          {formatNumber(plan.limits.max_api_calls_month)} API calls/mo
        </li>
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
        {isCurrent && (
          <Button variant="secondary" size="sm" className="w-full" disabled>
            Current plan
          </Button>
        )}
      </div>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────

export function Billing(): ReactNode {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [plansData, subData, usageData] = await Promise.all([
        billingApi.listPlans(),
        billingApi.getSubscription(),
        billingApi.getUsage(),
      ]);
      setPlans(plansData);
      setSubscription(subData);
      setUsage(usageData);
    } catch {
      setError('Failed to load billing data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleUpgrade = useCallback(
    async (tier: PlanTier): Promise<void> => {
      setActionLoading(true);
      try {
        const updated = await billingApi.upgradeSubscription(tier);
        setSubscription(updated);
        toast('Subscription upgraded successfully', 'success');
      } catch {
        toast('Failed to upgrade subscription', 'error');
      } finally {
        setActionLoading(false);
      }
    },
    [toast],
  );

  const handleDowngrade = useCallback(
    async (tier: PlanTier): Promise<void> => {
      setActionLoading(true);
      try {
        const updated = await billingApi.downgradeSubscription(tier);
        setSubscription(updated);
        toast('Subscription downgraded. Takes effect at period end.', 'success');
      } catch {
        toast('Failed to downgrade subscription', 'error');
      } finally {
        setActionLoading(false);
      }
    },
    [toast],
  );

  const handleCancel = useCallback(async (): Promise<void> => {
    setActionLoading(true);
    try {
      const updated = await billingApi.cancelSubscription();
      setSubscription(updated);
      toast('Subscription cancelled. Access continues until period end.', 'success');
    } catch {
      toast('Failed to cancel subscription', 'error');
    } finally {
      setActionLoading(false);
    }
  }, [toast]);

  // ── Render ────────────────────────────────────────────────────

  const currentTier = subscription?.plan_tier ?? null;
  const isActive =
    subscription !== null &&
    (subscription.status === 'active' || subscription.status === 'trialing');

  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Billing" subtitle="Manage your subscription and usage" />

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" label="Loading billing data" />
        </div>
      )}

      {!loading && error !== null && (
        <Card className="flex items-center gap-3 p-6 text-red-600 dark:text-red-400">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </Card>
      )}

      {!loading && error === null && (
        <>
          {/* Current Subscription */}
          {subscription !== null && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Current Subscription
              </h2>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Plan</p>
                  <p className="mt-0.5 font-semibold capitalize text-gray-900 dark:text-white">
                    {subscription.plan_tier}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
                  <Badge
                    variant={statusVariant[subscription.status] ?? 'neutral'}
                    size="sm"
                    className="mt-0.5"
                  >
                    {subscription.cancel_at_period_end ? 'cancelling' : subscription.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {subscription.cancel_at_period_end ? 'Access until' : 'Next renewal'}
                  </p>
                  <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
                    {formatDate(subscription.current_period_end)}
                  </p>
                </div>
                {isActive && !subscription.cancel_at_period_end && (
                  <div className="ml-auto">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        void handleCancel();
                      }}
                      disabled={actionLoading}
                    >
                      Cancel subscription
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Usage KPIs */}
          {usage !== null && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Current Period Usage
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <KpiCard
                  label="Agents"
                  value={String(usage.agents)}
                  icon={<Users className="h-4 w-4" />}
                />
                <KpiCard
                  label="Contacts"
                  value={usage.contacts.toLocaleString()}
                  icon={<Activity className="h-4 w-4" />}
                />
                <KpiCard
                  label="Messages"
                  value={usage.messages.toLocaleString()}
                  icon={<MessageSquare className="h-4 w-4" />}
                />
                <KpiCard
                  label="API Calls"
                  value={usage.api_calls.toLocaleString()}
                  icon={<Zap className="h-4 w-4" />}
                />
              </div>
            </div>
          )}

          {/* Plans */}
          {plans.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
                Available Plans
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {plans.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    currentTier={currentTier}
                    onUpgrade={handleUpgrade}
                    onDowngrade={handleDowngrade}
                    loading={actionLoading}
                  />
                ))}
              </div>
            </div>
          )}

          {plans.length === 0 && subscription === null && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <CheckCircle2 className="h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">No billing information available</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
