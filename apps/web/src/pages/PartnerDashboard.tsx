import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table } from '../components/ui/Table';
import { Spinner } from '../components/ui/Spinner';
import { AreaChart } from '../components/charts/AreaChart';
import { StackedBarChart } from '../components/charts/StackedBarChart';
import {
  getPartnerProfile,
  getEarnings,
  listPayouts,
  getPartnerStats,
  type Partner,
  type EarningsSummary as ApiEarnings,
  type Payout,
} from '../lib/partners-api';
import {
  DollarSign,
  Wallet,
  Award,
  Package,
  Star,
  RefreshCw,
  TrendingUp,
} from '../components/icons';

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

interface ReferralFunnel {
  month: string;
  clicks: number;
  signups: number;
  conversions: number;
}

// --- Constants ---

const tierColors: Record<PartnerProfile['tier'], string> = {
  silver: 'bg-slate-500/15 text-slate-300 border border-slate-500/30',
  gold: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  platinum: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
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

// --- API adapters ---

const partnerTierMap: Record<string, PartnerProfile['tier']> = {
  referral: 'silver',
  reseller: 'gold',
  strategic: 'platinum',
};

function adaptProfile(p: Partner): PartnerProfile {
  return {
    id: p.id,
    name: p.contactName,
    email: '',
    company: p.companyName,
    tier: partnerTierMap[p.tier] ?? 'silver',
    status: p.status === 'inactive' ? 'suspended' : p.status,
    revenueSharePct: Math.round(p.commissionRate * 100),
  };
}

function adaptEarnings(e: ApiEarnings): EarningsSummary {
  return {
    totalCents: Math.round(e.totalEarned * 100),
    pendingCents: Math.round(e.pendingPayout * 100),
    paidCents: Math.round(e.paidOut * 100),
    currency: 'USD',
  };
}

function adaptPayout(p: Payout): PayoutItem {
  return {
    id: p.id,
    amountCents: Math.round(p.amount * 100),
    currency: p.currency,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    status: p.status,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
  };
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
  {
    id: 'pay-001',
    amountCents: 125000,
    currency: 'USD',
    periodStart: new Date(Date.now() - 60 * 86400000).toISOString(),
    periodEnd: new Date(Date.now() - 30 * 86400000).toISOString(),
    status: 'paid',
    paidAt: new Date(Date.now() - 25 * 86400000).toISOString(),
    createdAt: new Date(Date.now() - 28 * 86400000).toISOString(),
  },
  {
    id: 'pay-002',
    amountCents: 148200,
    currency: 'USD',
    periodStart: new Date(Date.now() - 30 * 86400000).toISOString(),
    periodEnd: new Date().toISOString(),
    status: 'paid',
    paidAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'pay-003',
    amountCents: 100000,
    currency: 'USD',
    periodStart: new Date(Date.now() - 90 * 86400000).toISOString(),
    periodEnd: new Date(Date.now() - 60 * 86400000).toISOString(),
    status: 'paid',
    paidAt: new Date(Date.now() - 55 * 86400000).toISOString(),
    createdAt: new Date(Date.now() - 58 * 86400000).toISOString(),
  },
  {
    id: 'pay-004',
    amountCents: 85000,
    currency: 'USD',
    periodStart: new Date().toISOString(),
    periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
    status: 'pending',
    paidAt: null,
    createdAt: new Date().toISOString(),
  },
];

const mockPublishedAgents: PublishedAgentSummary[] = [
  {
    id: 'agent-001',
    name: 'Smart Collections',
    version: '1.2.0',
    downloads: 847,
    rating: 4.5,
    status: 'published',
  },
  {
    id: 'agent-002',
    name: 'Payment Reminder',
    version: '1.0.0',
    downloads: 234,
    rating: 4.0,
    status: 'published',
  },
  {
    id: 'agent-003',
    name: 'Risk Scorer',
    version: '2.0.0',
    downloads: 56,
    rating: 3.5,
    status: 'published',
  },
];

const fallbackMonthlyEarnings: MonthlyEarning[] = [
  { month: 'Oct', amountCents: 65000 },
  { month: 'Nov', amountCents: 78000 },
  { month: 'Dec', amountCents: 92000 },
  { month: 'Jan', amountCents: 100000 },
  { month: 'Feb', amountCents: 125000 },
  { month: 'Mar', amountCents: 148200 },
];

const mockReferralFunnel: ReferralFunnel[] = [
  { month: 'Oct', clicks: 320, signups: 48, conversions: 12 },
  { month: 'Nov', clicks: 410, signups: 62, conversions: 18 },
  { month: 'Dec', clicks: 380, signups: 55, conversions: 15 },
  { month: 'Jan', clicks: 490, signups: 74, conversions: 22 },
  { month: 'Feb', clicks: 560, signups: 88, conversions: 28 },
  { month: 'Mar', clicks: 620, signups: 95, conversions: 34 },
];

// --- Component ---

export function PartnerDashboard(): ReactNode {
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);
  const [publishedAgents, setPublishedAgents] = useState<PublishedAgentSummary[]>([]);
  const [monthlyEarnings, setMonthlyEarnings] = useState<MonthlyEarning[]>([]);
  const [referralFunnel, setReferralFunnel] = useState<ReferralFunnel[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [profileRes, earningsRes, payoutsRes, statsRes] = await Promise.allSettled([
        getPartnerProfile(),
        getEarnings(),
        listPayouts(),
        getPartnerStats(6),
      ]);

      setProfile(
        profileRes.status === 'fulfilled' ? adaptProfile(profileRes.value.data) : mockProfile,
      );
      setEarnings(
        earningsRes.status === 'fulfilled' ? adaptEarnings(earningsRes.value.data) : mockEarnings,
      );
      setPayouts(
        payoutsRes.status === 'fulfilled' ? payoutsRes.value.data.map(adaptPayout) : mockPayouts,
      );
      setPublishedAgents(mockPublishedAgents);

      if (statsRes.status === 'fulfilled') {
        const { monthly, funnel } = statsRes.value.data;
        setMonthlyEarnings(monthly.length > 0 ? monthly : fallbackMonthlyEarnings);
        setReferralFunnel(funnel.length > 0 ? funnel : mockReferralFunnel);
      } else {
        setMonthlyEarnings(fallbackMonthlyEarnings);
        setReferralFunnel(mockReferralFunnel);
      }
    } catch {
      setProfile(mockProfile);
      setEarnings(mockEarnings);
      setPayouts(mockPayouts);
      setPublishedAgents(mockPublishedAgents);
      setMonthlyEarnings(fallbackMonthlyEarnings);
      setReferralFunnel(mockReferralFunnel);
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
  const currentTier = profile?.tier ?? 'silver';

  const payoutColumns = [
    {
      key: 'period',
      header: 'Period',
      render: (row: PayoutItem) => (
        <span className="text-xs text-content">
          {new Date(row.periodStart).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
          {' \u2013 '}
          {new Date(row.periodEnd).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
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
        <Badge variant={payoutBadge[row.status]} dot size="sm">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'paidAt',
      header: 'Paid At',
      render: (row: PayoutItem) => (
        <span className="text-xs text-content-secondary">
          {row.paidAt !== null
            ? new Date(row.paidAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : '\u2014'}
        </span>
      ),
    },
  ];

  // Prepare AreaChart series from monthly earnings (convert cents to dollars)
  const earningsSeries = monthlyEarnings.map((e) => ({
    x: e.month,
    y: Math.round(e.amountCents / 100),
  }));

  // Prepare StackedBarChart data for referral funnel
  const funnelCategories = referralFunnel.map((r) => r.month);
  const funnelSeries = [
    { label: 'Clicks', data: referralFunnel.map((r) => r.clicks), color: '#3b82f6' },
    { label: 'Signups', data: referralFunnel.map((r) => r.signups), color: '#8b5cf6' },
    { label: 'Conversions', data: referralFunnel.map((r) => r.conversions), color: '#10b981' },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Partner Dashboard</h1>
          <div className="mt-1 flex items-center gap-2">
            <p className="text-sm text-content-secondary">{profile?.company ?? 'Partner'}</p>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${tierColors[currentTier]}`}
            >
              <Award className="h-3 w-3" />
              {currentTier}
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          onClick={fetchData}
        >
          Refresh
        </Button>
      </div>

      {/* Earnings KPI cards — accent borders + font-mono values */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="kpi-card-blue">
          <div className="flex items-center justify-between">
            <p className="metric-label">Total Earnings</p>
            <DollarSign className="h-4 w-4 text-kpi-blue" />
          </div>
          <p className="metric-value mt-2">{formatCurrency(earnings?.totalCents ?? 0, currency)}</p>
          <p className="metric-delta-up mt-1">
            <TrendingUp className="h-3 w-3" /> {profile?.revenueSharePct ?? 0}% revenue share
          </p>
        </div>

        <div className="kpi-card-amber">
          <div className="flex items-center justify-between">
            <p className="metric-label">Pending</p>
            <Wallet className="h-4 w-4 text-kpi-amber" />
          </div>
          <p className="metric-value mt-2 !text-amber-400">
            {formatCurrency(earnings?.pendingCents ?? 0, currency)}
          </p>
          <p className="mt-1 text-xs text-content-secondary">Awaiting payout</p>
        </div>

        <div className="kpi-card-green">
          <div className="flex items-center justify-between">
            <p className="metric-label">Paid</p>
            <DollarSign className="h-4 w-4 text-kpi-green" />
          </div>
          <p className="metric-value mt-2 !text-emerald-400">
            {formatCurrency(earnings?.paidCents ?? 0, currency)}
          </p>
          <p className="mt-1 text-xs text-content-secondary">Total disbursed</p>
        </div>
      </div>

      {/* Earnings Trend (AreaChart) + Referral Funnel (StackedBarChart) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title="Earnings Trend"
          accent="blue"
          actions={
            <Badge variant="info" size="sm">
              6 months
            </Badge>
          }
        >
          <AreaChart
            series={earningsSeries}
            height={220}
            color="#3b82f6"
            showGrid
            showDots
            gradientOpacity={0.25}
          />
        </Card>

        <Card
          title="Referral Funnel"
          accent="purple"
          actions={
            <Badge variant="info" size="sm">
              Monthly
            </Badge>
          }
        >
          <StackedBarChart
            categories={funnelCategories}
            series={funnelSeries}
            height={248}
            showGrid
            showLabels
          />
        </Card>
      </div>

      {/* Published agents + Payout history */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Published agents with install counts */}
        <Card
          title="Published Agents"
          accent="green"
          actions={
            <div className="flex items-center gap-2">
              <Package className="h-3.5 w-3.5 text-kpi-green" />
              <Badge variant="success" size="sm">
                {publishedAgents.length} live
              </Badge>
            </div>
          }
        >
          <div className="space-y-2">
            {publishedAgents.length === 0 ? (
              <p className="text-sm text-content-secondary">No agents published yet.</p>
            ) : (
              publishedAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-content">{agent.name}</span>
                      <Badge variant="info" size="sm">
                        v{agent.version}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-content-tertiary">
                      <span className="font-mono">{agent.downloads}</span> installs
                      <span className="text-content-tertiary">{'\u00B7'}</span>
                      <Star className="inline h-2.5 w-2.5 text-amber-400" />
                      <span className="font-mono">{agent.rating.toFixed(1)}</span>
                    </div>
                  </div>
                  <Badge variant="success" size="sm">
                    {agent.status}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Payout history table */}
        <Card
          title="Payout History"
          accent="amber"
          actions={
            <div className="flex items-center gap-2">
              <Wallet className="h-3.5 w-3.5 text-kpi-amber" />
              <Badge variant="warning" size="sm">
                {payouts.length} payouts
              </Badge>
            </div>
          }
        >
          {payouts.length === 0 ? (
            <p className="text-sm text-content-secondary">No payouts yet.</p>
          ) : (
            <Table columns={payoutColumns} data={payouts} keyExtractor={(p) => p.id} />
          )}
        </Card>
      </div>
    </div>
  );
}
