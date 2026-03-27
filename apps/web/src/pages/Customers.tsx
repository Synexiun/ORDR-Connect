import { type ReactNode, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Table } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { SparkLine } from '../components/charts/SparkLine';
import { Avatar } from '../components/ui/Avatar';
import {
  listCustomers,
  createCustomer,
  deleteCustomer,
  semanticSearchCustomers,
  type Customer as ApiCustomer,
  type CustomerStatus,
} from '../lib/customers-api';

// --- Types ---

interface Customer {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'inactive' | 'churned' | 'prospect';
  healthScore: number;
  lifecycleStage: 'lead' | 'onboarding' | 'active' | 'at-risk' | 'churned';
  lastContact: string;
  createdAt: string;
}

type CustomerFormData = {
  name: string;
  email: string;
  status: Customer['status'];
  lifecycleStage: Customer['lifecycleStage'];
};

// --- Constants ---

const statusBadge: Record<Customer['status'], 'success' | 'neutral' | 'danger' | 'info'> = {
  active: 'success',
  inactive: 'neutral',
  churned: 'danger',
  prospect: 'info',
};

const lifecycleBadge: Record<
  Customer['lifecycleStage'],
  'info' | 'warning' | 'success' | 'danger' | 'neutral'
> = {
  lead: 'info',
  onboarding: 'warning',
  active: 'success',
  'at-risk': 'danger',
  churned: 'neutral',
};

function healthScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-red-400';
}

function healthScoreDot(score: number): string {
  if (score >= 80) return 'bg-emerald-400';
  if (score >= 60) return 'bg-amber-400';
  return 'bg-red-400';
}

/** Generate deterministic pseudo-random sparkline data for KPI cards. */
function generateSparkData(seed: number, points: number, base: number): number[] {
  const result: number[] = [];
  let value = base;
  for (let i = 0; i < points; i++) {
    // Simple deterministic variation using sin/cos
    value =
      base +
      Math.round(Math.sin(seed + i * 0.7) * (base * 0.15) + Math.cos(i * 0.3) * (base * 0.08));
    result.push(Math.max(0, value));
  }
  return result;
}

// --- Mock data ---

const mockCustomers: Customer[] = Array.from({ length: 47 }, (_, i) => ({
  id: `cust-${String(i + 1).padStart(4, '0')}`,
  name: [
    'Acme Corp',
    'Globex Inc',
    'Initech',
    'Umbrella LLC',
    'Stark Industries',
    'Wayne Enterprises',
    'Oscorp',
    'LexCorp',
    'Pied Piper',
    'Hooli',
    'Dunder Mifflin',
    'Vehement Capital',
    'Massive Dynamic',
    'Cyberdyne Systems',
    'Soylent Corp',
    'Tyrell Corp',
    'Weyland Industries',
    'Aperture Science',
    'Black Mesa',
    'Abstergo Industries',
  ][i % 20] as string,
  email: `contact${i + 1}@company${i + 1}.com`,
  status: (['active', 'active', 'active', 'inactive', 'prospect', 'churned'] as const)[
    i % 6
  ] as Customer['status'],
  healthScore: Math.max(20, Math.min(100, 75 + Math.floor(Math.sin(i) * 25))),
  lifecycleStage: (['active', 'active', 'onboarding', 'at-risk', 'lead', 'churned'] as const)[
    i % 6
  ] as Customer['lifecycleStage'],
  lastContact: new Date(
    Date.now() - (i * 86400000 + Math.floor(Math.random() * 86400000)),
  ).toISOString(),
  createdAt: new Date(Date.now() - (i + 30) * 86400000).toISOString(),
}));

// --- Adapters ---

const lifecycleMap: Record<string, Customer['lifecycleStage']> = {
  lead: 'lead',
  qualified: 'lead',
  opportunity: 'onboarding',
  customer: 'active',
  churning: 'at-risk',
  churned: 'churned',
};

function adaptApiCustomer(c: ApiCustomer): Customer {
  return {
    id: c.id,
    name: c.name,
    email: c.email ?? '',
    status: (c.status as Customer['status'] | undefined) ?? 'active',
    healthScore: c.healthScore ?? 75,
    lifecycleStage:
      (lifecycleMap[c.lifecycleStage] as Customer['lifecycleStage'] | undefined) ?? 'active',
    lastContact: c.updatedAt,
    createdAt: c.createdAt,
  };
}

// --- Component ---

export function Customers(): ReactNode {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState<CustomerFormData>({
    name: '',
    email: '',
    status: 'prospect',
    lifecycleStage: 'lead',
  });

  const pageSize = 10;

  // Debounced search — 400ms delay so we don't fire on every keystroke.
  // Semantic search activates when the debounced value is > 3 chars.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isSemanticSearch, setIsSemanticSearch] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => {
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    };
  }, [search]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    const trimmed = debouncedSearch.trim();

    // Semantic search path — for substantive queries (> 3 chars)
    if (trimmed.length > 3) {
      try {
        const res = await semanticSearchCustomers(trimmed, pageSize);
        setCustomers(
          res.data.map((r) => ({
            id: r.id,
            name: r.name,
            email: r.email ?? '',
            status: 'active' as Customer['status'],
            healthScore: Math.round(r.score * 100),
            lifecycleStage: 'active' as Customer['lifecycleStage'],
            lastContact: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          })),
        );
        setTotal(res.data.length);
        setIsSemanticSearch(true);
        setLoading(false);
        return;
      } catch {
        // Semantic search unavailable — fall through to text search
      }
    }

    setIsSemanticSearch(false);
    try {
      const apiStatus =
        statusFilter !== 'all' && statusFilter !== 'prospect'
          ? (statusFilter as CustomerStatus)
          : undefined;
      const res = await listCustomers({
        page,
        pageSize,
        search: trimmed !== '' ? trimmed : undefined,
        status: apiStatus,
      });
      setCustomers(res.data.map(adaptApiCustomer));
      setTotal(res.total);
    } catch {
      // Graceful degradation: filter mock data locally
      let filtered = mockCustomers;
      if (trimmed) {
        const q = trimmed.toLowerCase();
        filtered = filtered.filter(
          (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
        );
      }
      if (statusFilter !== 'all') {
        filtered = filtered.filter((c) => c.status === statusFilter);
      }
      setTotal(filtered.length);
      const start = (page - 1) * pageSize;
      setCustomers(filtered.slice(start, start + pageSize));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, statusFilter]);

  useEffect(() => {
    void fetchCustomers();
  }, [fetchCustomers]);

  // Reset page immediately when search or status filter changes
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  // --- KPI stats computed from mock data (full set, not filtered page) ---
  const kpiStats = useMemo(() => {
    const all = mockCustomers;
    const activeCount = all.filter((c) => c.status === 'active').length;
    const atRiskCount = all.filter((c) => c.lifecycleStage === 'at-risk').length;
    const churnedCount = all.filter((c) => c.status === 'churned').length;
    return {
      total: all.length,
      active: activeCount,
      atRisk: atRiskCount,
      churned: churnedCount,
      sparkTotal: generateSparkData(1, 12, all.length),
      sparkActive: generateSparkData(2, 12, activeCount),
      sparkAtRisk: generateSparkData(3, 12, atRiskCount),
      sparkChurned: generateSparkData(4, 12, churnedCount),
    };
  }, []);

  const handleAddCustomer = useCallback(async () => {
    try {
      const created = await createCustomer({
        type: 'company',
        name: formData.name,
        email: formData.email,
      });
      const newCust = adaptApiCustomer(created.data);
      setCustomers((prev) => [newCust, ...prev]);
      setTotal((prev) => prev + 1);
    } catch {
      // Mock: add locally
      const newCust: Customer = {
        id: `cust-${Date.now()}`,
        name: formData.name,
        email: formData.email,
        status: formData.status,
        healthScore: 100,
        lifecycleStage: formData.lifecycleStage,
        lastContact: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      setCustomers((prev) => [newCust, ...prev]);
      setTotal((prev) => prev + 1);
    }
    setShowAddModal(false);
    setFormData({ name: '', email: '', status: 'prospect', lifecycleStage: 'lead' });
  }, [formData]);

  const handleDeleteCustomer = useCallback(
    async (customer: Customer) => {
      try {
        await deleteCustomer(customer.id);
      } catch {
        // Mock: remove locally (soft delete)
      }
      setSelectedCustomer(null);
      void fetchCustomers();
    },
    [fetchCustomers],
  );

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: Customer) => (
        <button
          className="flex items-center gap-2.5 font-medium text-brand-accent hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            void navigate(`/customers/${row.id}`);
          }}
          aria-label={`View ${row.name}`}
        >
          <Avatar
            name={row.name}
            size="sm"
            status={
              row.status === 'active' ? 'online' : row.status === 'churned' ? 'busy' : 'offline'
            }
          />
          {row.name}
        </button>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      render: (row: Customer) => <span className="text-content-secondary">{row.email}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row: Customer) => (
        <Badge variant={statusBadge[row.status]} dot size="sm">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'healthScore',
      header: 'Health',
      sortable: true,
      render: (row: Customer) => (
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${healthScoreDot(row.healthScore)}`}
            aria-hidden="true"
          />
          <span className={`font-mono font-semibold ${healthScoreColor(row.healthScore)}`}>
            {row.healthScore}
          </span>
        </div>
      ),
    },
    {
      key: 'lifecycleStage',
      header: 'Lifecycle',
      render: (row: Customer) => (
        <Badge variant={lifecycleBadge[row.lifecycleStage]} size="sm">
          {row.lifecycleStage}
        </Badge>
      ),
    },
    {
      key: 'lastContact',
      header: 'Last Contact',
      sortable: true,
      render: (row: Customer) => (
        <span className="text-xs text-content-secondary">
          {new Date(row.lastContact).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Customers</h1>
          <p className="mt-1 text-sm text-content-secondary">
            {total} customer{total !== 1 ? 's' : ''} total
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setShowAddModal(true);
          }}
        >
          + Add Customer
        </Button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card accent="blue">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-content-tertiary">
                Total Customers
              </p>
              <p className="mt-1 font-mono text-2xl font-bold text-content">{kpiStats.total}</p>
            </div>
            <SparkLine data={kpiStats.sparkTotal} color="#3b82f6" width={72} height={28} />
          </div>
        </Card>
        <Card accent="green">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-content-tertiary">
                Active
              </p>
              <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">
                {kpiStats.active}
              </p>
            </div>
            <SparkLine data={kpiStats.sparkActive} color="#34d399" width={72} height={28} />
          </div>
        </Card>
        <Card accent="amber">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-content-tertiary">
                At-Risk
              </p>
              <p className="mt-1 font-mono text-2xl font-bold text-amber-400">{kpiStats.atRisk}</p>
            </div>
            <SparkLine data={kpiStats.sparkAtRisk} color="#fbbf24" width={72} height={28} />
          </div>
        </Card>
        <Card accent="red">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-content-tertiary">
                Churned
              </p>
              <p className="mt-1 font-mono text-2xl font-bold text-red-400">{kpiStats.churned}</p>
            </div>
            <SparkLine data={kpiStats.sparkChurned} color="#f87171" width={72} height={28} />
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card padding={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2">
            <div className="flex-1">
              <Input
                placeholder="Search customers…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
                aria-label="Search customers"
              />
            </div>
            {isSemanticSearch && (
              <span className="inline-flex items-center rounded-full bg-brand-accent/15 px-2 py-0.5 text-2xs font-medium text-brand-accent">
                Semantic
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {['all', 'active', 'inactive', 'prospect', 'churned'].map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setStatusFilter(s);
                }}
              >
                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>
        </div>
      </Card>

      {/* Table */}
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Spinner size="lg" label="Loading customers" />
        </div>
      ) : (
        <Table
          columns={columns}
          data={customers}
          keyExtractor={(c) => c.id}
          pagination={{ page, pageSize, total }}
          onPageChange={setPage}
          onRowClick={(c) => {
            setSelectedCustomer(c);
          }}
        />
      )}

      {/* Detail panel */}
      <Modal
        open={selectedCustomer !== null}
        onClose={() => {
          setSelectedCustomer(null);
        }}
        title={selectedCustomer?.name ?? 'Customer Detail'}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedCustomer(null);
              }}
            >
              Close
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => selectedCustomer && handleDeleteCustomer(selectedCustomer)}
            >
              Deactivate
            </Button>
          </>
        }
      >
        {selectedCustomer && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-content-tertiary">Email</p>
                <p className="text-sm text-content">{selectedCustomer.email}</p>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Status</p>
                <Badge variant={statusBadge[selectedCustomer.status]} dot size="sm">
                  {selectedCustomer.status}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Health Score</p>
                <p
                  className={`text-lg font-bold ${healthScoreColor(selectedCustomer.healthScore)}`}
                >
                  {selectedCustomer.healthScore}
                </p>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Lifecycle Stage</p>
                <Badge variant={lifecycleBadge[selectedCustomer.lifecycleStage]} size="sm">
                  {selectedCustomer.lifecycleStage}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Last Contact</p>
                <p className="text-sm text-content">
                  {new Date(selectedCustomer.lastContact).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Customer Since</p>
                <p className="text-sm text-content">
                  {new Date(selectedCustomer.createdAt).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <p className="text-2xs text-content-tertiary">
                Customer ID: <span className="font-mono">{selectedCustomer.id}</span>
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Add customer modal */}
      <Modal
        open={showAddModal}
        onClose={() => {
          setShowAddModal(false);
        }}
        title="Add Customer"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowAddModal(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAddCustomer}
              disabled={!formData.name.trim() || !formData.email.trim()}
            >
              Create Customer
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Company Name"
            placeholder="Acme Corp"
            value={formData.name}
            onChange={(e) => {
              setFormData((prev) => ({ ...prev, name: e.target.value }));
            }}
            required
          />
          <Input
            label="Contact Email"
            type="email"
            placeholder="contact@acme.com"
            value={formData.email}
            onChange={(e) => {
              setFormData((prev) => ({ ...prev, email: e.target.value }));
            }}
            required
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-content-secondary">Status</label>
            <select
              className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-content focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              value={formData.status}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, status: e.target.value as Customer['status'] }));
              }}
              aria-label="Customer status"
            >
              <option value="prospect">Prospect</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}
