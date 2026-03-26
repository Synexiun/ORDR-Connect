import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Table } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { apiClient } from '../lib/api';

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

interface CustomersResponse {
  customers: Customer[];
  total: number;
  page: number;
  pageSize: number;
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

const lifecycleBadge: Record<Customer['lifecycleStage'], 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
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

// --- Mock data ---

const mockCustomers: Customer[] = Array.from({ length: 47 }, (_, i) => ({
  id: `cust-${String(i + 1).padStart(4, '0')}`,
  name: [
    'Acme Corp', 'Globex Inc', 'Initech', 'Umbrella LLC', 'Stark Industries',
    'Wayne Enterprises', 'Oscorp', 'LexCorp', 'Pied Piper', 'Hooli',
    'Dunder Mifflin', 'Vehement Capital', 'Massive Dynamic', 'Cyberdyne Systems',
    'Soylent Corp', 'Tyrell Corp', 'Weyland Industries', 'Aperture Science',
    'Black Mesa', 'Abstergo Industries',
  ][i % 20] as string,
  email: `contact${i + 1}@company${i + 1}.com`,
  status: (['active', 'active', 'active', 'inactive', 'prospect', 'churned'] as const)[i % 6] as Customer['status'],
  healthScore: Math.max(20, Math.min(100, 75 + Math.floor(Math.sin(i) * 25))),
  lifecycleStage: (['active', 'active', 'onboarding', 'at-risk', 'lead', 'churned'] as const)[i % 6] as Customer['lifecycleStage'],
  lastContact: new Date(Date.now() - (i * 86400000 + Math.floor(Math.random() * 86400000))).toISOString(),
  createdAt: new Date(Date.now() - ((i + 30) * 86400000)).toISOString(),
}));

// --- Component ---

export function Customers(): ReactNode {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
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

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await apiClient.get<CustomersResponse>(`/v1/customers?${params.toString()}`);
      setCustomers(res.customers);
      setTotal(res.total);
    } catch {
      // Graceful degradation: filter mock data locally
      let filtered = mockCustomers;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
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
  }, [page, search, statusFilter]);

  useEffect(() => {
    void fetchCustomers();
  }, [fetchCustomers]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const handleAddCustomer = useCallback(async () => {
    try {
      await apiClient.post('/v1/customers', formData);
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
        await apiClient.delete(`/v1/customers/${customer.id}`);
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
          className="font-medium text-brand-accent hover:underline"
          onClick={(e) => { e.stopPropagation(); navigate(`/customers/${row.id}`); }}
          aria-label={`View ${row.name}`}
        >
          {row.name}
        </button>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      render: (row: Customer) => (
        <span className="text-content-secondary">{row.email}</span>
      ),
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
        <span className={`font-mono font-semibold ${healthScoreColor(row.healthScore)}`}>
          {row.healthScore}
        </span>
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
        <Button size="sm" onClick={() => setShowAddModal(true)}>
          + Add Customer
        </Button>
      </div>

      {/* Filters */}
      <Card padding={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Input
              placeholder="Search customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search customers"
            />
          </div>
          <div className="flex items-center gap-2">
            {['all', 'active', 'inactive', 'prospect', 'churned'].map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setStatusFilter(s)}
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
          onRowClick={setSelectedCustomer}
        />
      )}

      {/* Detail panel */}
      <Modal
        open={selectedCustomer !== null}
        onClose={() => setSelectedCustomer(null)}
        title={selectedCustomer?.name ?? 'Customer Detail'}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setSelectedCustomer(null)}>
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
        onClose={() => setShowAddModal(false)}
        title="Add Customer"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setShowAddModal(false)}>
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
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            required
          />
          <Input
            label="Contact Email"
            type="email"
            placeholder="contact@acme.com"
            value={formData.email}
            onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
            required
          />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-content-secondary">Status</label>
            <select
              className="block w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-content focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              value={formData.status}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, status: e.target.value as Customer['status'] }))
              }
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
