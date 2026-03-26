import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table } from '../components/ui/Table';
import { Spinner } from '../components/ui/Spinner';
import { apiClient } from '../lib/api';

// --- Types ---

interface PartnerProfile {
  id: string;
  name: string;
  email: string;
  company: string;
  tier: 'silver' | 'gold' | 'platinum';
  status: 'pending' | 'active' | 'suspended';
  revenueSharePct: number;
}

interface EarningsSummary {
  totalCents: number;
  pendingCents: number;
  paidCents: number;
  currency: string;
}

interface PayoutItem {
  id: string;
  amountCents: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  paidAt: string | null;
  createdAt: string;
}

interface PublishedAgentSummary {
  id: string;
  name: string;
  version: string;
  downloads: number;
  rating: number;
  status: string;
}

interface MonthlyEarning {
  month: string;
  amountCents: number;
}

// --- Constants ---

const tierBadge: Record<PartnerProfile['tier'], 'neutral' | 'warning' | 'success'> = {
  silver: 'neutral',
  gold: 'warning',
  platinum: 'success',
};

const payoutBadge: Record<PayoutItem['status'], 'info' | 'warning' | 'success' | 'danger'> = {
  pending: 'info',
  processing: 'warning',
  paid: 'success',
  failed: 'danger',
};

// --- Helpers ---

function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// --- Mock data ---

const mockProfile: PartnerProfile = {
  id: 'partner-001',
  name: 'Jane Smith',
  email: 'jane@partnercorp.com',
  company: 'PartnerCorp',
  tier: 'gold',
  status: 'active',
  revenueSharePct: 20,
};

const mockEarnings: EarningsSummary = {
  totalCents: 458200,
  pendingCents: 85000,
  paidCents: 373200,
  currency: 'USD',
};

const mockPayouts: PayoutItem[] = [
  { id: 'pay-001', amountCents: 125000, currency: 'USD', periodStart: new Date(Date.now() - 60 * 86400000).toISOString(), periodEnd: new Date(Date.now() - 30 * 86400000).toISOString(), status: 'paid', paidAt: new Date(Date.now() - 25 * 86400000).toISOString(), createdAt: new Date(Date.now() - 28 * 86400000).toISOString() },
  { id: 'pay-002', amountCents: 148200, currency: 'USD', periodStart: new Date(Date.now() - 30 * 86400000).toISOString(), periodEnd: new Date().toISOString(), status: 'paid', paidAt: new Date(Date.now() - 2 * 86400000).toISOString(), createdAt: new Date(Date.now() - 3 * 86400000).toISOString() },
  { id: 'pay-003', amountCents: 100000, currency: 'USD', periodStart: new Date(Date.now() - 90 * 86400000).toISOString(), periodEnd: new Date(Date.now() - 60 * 86400000).toISOString(), status: 'paid', paidAt: new Date(Date.now() - 55 * 86400000).toISOString(), createdAt: new Date(Date.now() - 58 * 86400000).toISOString() },
  { id: 'pay-004', amountCents: 85000, currency: 'USD', periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(), status: 'pending', paidAt: null, createdAt: new Date().toISOString() },
];

const mockPublishedAgents: PublishedAgentSummary[] = [
  { id: 'agent-001', name: 'Smart Collections', version: '1.2.0', downloads: 847, rating: 4.5, status: 'published' },
  { id: 'agent-002', name: 'Payment Reminder', version: '1.0.0', downloads: 234, rating: 4.0, status: 'published' },
  { id: 'agent-003', name: 'Risk Scorer', version: '2.0.0', downloads: 56, rating: 3.5, status: 'published' },
];

const mockMonthlyEarnings: MonthlyEarning[] = [
  { month: 'Oct', amountCents: 65000 },
  { month: 'Nov', amountCents: 78000 },
  { month: 'Dec', amountCents: 92000 },
  { month: 'Jan', amountCents: 100000 },
  { month: 'Feb', amountCents: 125000 },
  { month: 'Mar', amountCents: 148200 },
];

// --- Component ---

export function PartnerDashboard(): ReactNode {
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);
  const [publishedAgents, setPublishedAgents] = useState<PublishedAgentSummary[]>([]);
  const [monthlyEarnings, setMonthlyEarnings] = useState<MonthlyEarning[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRes, earningsRes, payoutsRes] = await Promise.allSettled([
        apiClient.get<{ data: PartnerProfile }>('/v1/partners/me'),
        apiClient.get<{ data: EarningsSummary }>('/v1/partners/earnings'),
        apiClient.get<{ data: PayoutItem[] }>('/v1/partners/payouts'),
      ]);

      setProfile(profileRes.status === 'fulfilled' ? profileRes.value.data : mockProfile);
      setEarnings(earningsRes.status === 'fulfilled' ? earningsRes.value.data : mockEarnings);
      setPayouts(payoutsRes.status === 'fulfilled' ? payoutsRes.value.data : mockPayouts);
      setPublishedAgents(mockPublishedAgents);
      setMonthlyEarnings(mockMonthlyEarnings);
    } catch {
      setProfile(mockProfile);
      setEarnings(mockEarnings);
      setPayouts(mockPayouts);
      setPublishedAgents(mockPublishedAgents);
      setMonthlyEarnings(mockMonthlyEarnings);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading partner dashboard" />
      </div>
    );
  }

  const currency = earnings?.currency ?? 'USD';

  const payoutColumns = [
    {
      key: 'period',
      header: 'Period',
      render: (row: PayoutItem) => (
        <span className="text-xs text-content">
          {new Date(row.periodStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {' \u2013 '}
          {new Date(row.periodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (row: PayoutItem) => (
        <span className="font-mono text-sm font-semibold text-content">
          {formatCurrency(row.amountCents, row.currency)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: PayoutItem) => (
        <Badge variant={payoutBadge[row.status]} dot size="sm">{row.status}</Badge>
      ),
    },
    {
      key: 'paidAt',
      header: 'Paid At',
      render: (row: PayoutItem) => (
        <span className="text-xs text-content-secondary">
          {row.paidAt
            ? new Date(row.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '\u2014'}
        </span>
      ),
    },
  ];

  // Calculate max for chart scaling
  const maxEarning = Math.max(...monthlyEarnings.map((e) => e.amountCents), 1);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Partner Dashboard</h1>
          <p className="mt-1 text-sm text-content-secondary">
            {profile?.company ?? 'Partner'} \u00B7{' '}
            <Badge variant={tierBadge[profile?.tier ?? 'silver']} size="sm">
              {profile?.tier ?? 'silver'}
            </Badge>
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData}>
          Refresh
        </Button>
      </div>

      {/* Earnings summary KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="kpi-card">
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">Total Earnings</p>
          <p className="mt-2 text-2xl font-bold text-content">
            {formatCurrency(earnings?.totalCents ?? 0, currency)}
          </p>
          <p className="mt-1 text-xs text-content-secondary">
            {profile?.revenueSharePct ?? 0}% revenue share
          </p>
        </div>
        <div className="kpi-card">
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">Pending</p>
          <p className="mt-2 text-2xl font-bold text-amber-400">
            {formatCurrency(earnings?.pendingCents ?? 0, currency)}
          </p>
          <p className="mt-1 text-xs text-content-secondary">Awaiting payout</p>
        </div>
        <div className="kpi-card">
          <p className="text-xs font-medium uppercase tracking-wider text-content-secondary">Paid</p>
          <p className="mt-2 text-2xl font-bold text-emerald-400">
            {formatCurrency(earnings?.paidCents ?? 0, currency)}
          </p>
          <p className="mt-1 text-xs text-content-secondary">Total disbursed</p>
        </div>
      </div>

      {/* Revenue chart (simple bar chart) */}
      <Card title="Monthly Earnings">
        <div className="flex items-end gap-2" style={{ height: '120px' }}>
          {monthlyEarnings.map((entry) => (
            <div key={entry.month} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-2xs font-medium text-content-secondary">
                {formatCurrency(entry.amountCents, currency)}
              </span>
              <div
                className="w-full rounded-t bg-brand-accent transition-all"
                style={{ height: `${String((entry.amountCents / maxEarning) * 80)}px` }}
              />
              <span className="text-2xs text-content-tertiary">{entry.month}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Published agents + Payout history */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Published agents with install counts */}
        <Card title="Published Agents">
          <div className="space-y-2">
            {publishedAgents.length === 0 ? (
              <p className="text-sm text-content-secondary">No agents published yet.</p>
            ) : (
              publishedAgents.map((agent) => (
                <div key={agent.id} className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-content">{agent.name}</span>
                      <Badge variant="info" size="sm">v{agent.version}</Badge>
                    </div>
                    <p className="mt-0.5 text-2xs text-content-tertiary">
                      {agent.downloads} installs \u00B7 {'★'.repeat(Math.floor(agent.rating))} {agent.rating.toFixed(1)}
                    </p>
                  </div>
                  <Badge variant="success" size="sm">{agent.status}</Badge>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Payout history table */}
        <Card title="Payout History">
          {payouts.length === 0 ? (
            <p className="text-sm text-content-secondary">No payouts yet.</p>
          ) : (
            <Table
              columns={payoutColumns}
              data={payouts}
              keyExtractor={(p) => p.id}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
