/**
 * Tickets — Support ticket list with KPI row, filters, and create form.
 *
 * COMPLIANCE:
 * - No PHI in ticket metadata or list views (Rule 6)
 * - API calls use correlation IDs (Rule 3)
 * - Input validated before submission (Rule 4)
 * - Error responses return safe generic messages (Rule 7)
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Textarea } from '../components/ui/Textarea';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { TicketStatusBadge } from '../components/tickets/TicketStatusBadge';
import {
  Plus,
  AlertCircle,
  Clock,
  Target,
  Activity,
  MessageSquare,
  User,
} from '../components/icons';
import {
  fetchTickets,
  fetchStats,
  createTicket,
  type Ticket,
  type TicketStats,
  type TicketPriority,
  type TicketCategory,
} from '../lib/tickets-api';

// --- Constants ---

const statusOptions = [
  { value: 'all', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const priorityOptions = [
  { value: 'all', label: 'All Priorities' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const categoryOptions = [
  { value: 'all', label: 'All Categories' },
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature Request' },
  { value: 'question', label: 'Question' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'billing', label: 'Billing' },
];

const priorityBadge: Record<TicketPriority, 'danger' | 'warning' | 'info' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
};

const categoryBadge: Record<TicketCategory, 'danger' | 'warning' | 'info' | 'neutral' | 'success'> =
  {
    bug: 'danger',
    feature: 'info',
    question: 'neutral',
    compliance: 'warning',
    billing: 'success',
  };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// --- Component ---

export function Tickets(): ReactNode {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Create ticket modal
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<TicketCategory>('bug');
  const [newPriority, setNewPriority] = useState<TicketPriority>('medium');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ticketData, statsData] = await Promise.all([fetchTickets(), fetchStats()]);
      setTickets(ticketData);
      setStats(statsData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Apply filters
  const filtered = tickets.filter((t) => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (
        !t.title.toLowerCase().includes(q) &&
        !t.id.toLowerCase().includes(q) &&
        !t.reporter.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim() || !newDescription.trim()) return;
    setCreating(true);
    try {
      const ticket = await createTicket({
        title: newTitle.trim(),
        category: newCategory,
        priority: newPriority,
        description: newDescription.trim(),
      });
      setTickets((prev) => [ticket, ...prev]);
      setShowCreate(false);
      setNewTitle('');
      setNewCategory('bug');
      setNewPriority('medium');
      setNewDescription('');
    } finally {
      setCreating(false);
    }
  }, [newTitle, newCategory, newPriority, newDescription]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading tickets" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Support Tickets</h1>
          <p className="page-subtitle mt-1">
            {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} total
          </p>
        </div>
        <Button
          size="sm"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => {
            setShowCreate(true);
          }}
        >
          Create Ticket
        </Button>
      </div>

      {/* KPI Row */}
      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card accent="blue">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/15">
                <AlertCircle className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Open Tickets</p>
                <p className="text-xl font-bold text-content">{stats.open}</p>
              </div>
            </div>
          </Card>
          <Card accent="amber">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15">
                <Activity className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-content-tertiary">In Progress</p>
                <p className="text-xl font-bold text-content">{stats.inProgress}</p>
              </div>
            </div>
          </Card>
          <Card accent="purple">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/15">
                <Clock className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Avg Response Time</p>
                <p className="text-xl font-bold text-content">{stats.avgResponseTime}</p>
              </div>
            </div>
          </Card>
          <Card accent="green">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15">
                <Target className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-content-tertiary">SLA Compliance</p>
                <p className="text-xl font-bold text-content">{stats.slaCompliance}%</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card padding={false}>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              placeholder="Search tickets..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              aria-label="Search tickets"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
            <Select options={priorityOptions} value={priorityFilter} onChange={setPriorityFilter} />
            <Select options={categoryOptions} value={categoryFilter} onChange={setCategoryFilter} />
          </div>
        </div>
      </Card>

      {/* Ticket Table */}
      {filtered.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-content-secondary">No tickets match your filters.</p>
        </div>
      ) : (
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                    ID
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                    Title
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                    Status
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                    Priority
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                    Category
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                    Assignee
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                    Updated
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                    Msgs
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((ticket) => (
                  <tr
                    key={ticket.id}
                    onClick={() => navigate(`/tickets/${ticket.id}`)}
                    className="cursor-pointer transition-colors hover:bg-surface-tertiary"
                  >
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="font-mono text-xs text-content-tertiary">{ticket.id}</span>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3">
                      <span className="font-medium text-content">{ticket.title}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <TicketStatusBadge status={ticket.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge variant={priorityBadge[ticket.priority]} size="sm">
                        {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge variant={categoryBadge[ticket.category]} size="sm">
                        {ticket.category.charAt(0).toUpperCase() + ticket.category.slice(1)}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {ticket.assignee !== null ? (
                        <span className="flex items-center gap-1.5 text-xs text-content-secondary">
                          <User className="h-3 w-3" />
                          {ticket.assignee}
                        </span>
                      ) : (
                        <span className="text-xs text-content-tertiary">Unassigned</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="text-xs text-content-tertiary">
                        {formatDate(ticket.updatedAt)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="flex items-center gap-1 text-xs text-content-tertiary">
                        <MessageSquare className="h-3 w-3" />
                        {ticket.messageCount}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create Ticket Modal */}
      <Modal
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
        }}
        title="Create Support Ticket"
        size="lg"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowCreate(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCreate()}
              disabled={!newTitle.trim() || !newDescription.trim() || creating}
              loading={creating}
            >
              Create Ticket
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            placeholder="Brief summary of the issue"
            value={newTitle}
            onChange={(e) => {
              setNewTitle(e.target.value);
            }}
          />
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Category"
              options={[
                { value: 'bug', label: 'Bug' },
                { value: 'feature', label: 'Feature Request' },
                { value: 'question', label: 'Question' },
                { value: 'compliance', label: 'Compliance' },
                { value: 'billing', label: 'Billing' },
              ]}
              value={newCategory}
              onChange={(v) => {
                setNewCategory(v as TicketCategory);
              }}
            />
            <Select
              label="Priority"
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
                { value: 'critical', label: 'Critical' },
              ]}
              value={newPriority}
              onChange={(v) => {
                setNewPriority(v as TicketPriority);
              }}
            />
          </div>
          <Textarea
            label="Description"
            placeholder="Describe the issue in detail..."
            value={newDescription}
            onChange={(e) => {
              setNewDescription(e.target.value);
            }}
            rows={5}
            maxLength={2000}
          />
        </div>
      </Modal>
    </div>
  );
}
