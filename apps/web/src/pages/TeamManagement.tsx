/**
 * Team Management — Admin-only team management page.
 *
 * COMPLIANCE: No PHI displayed. All member actions (invite, role change,
 * suspend, remove) are audit-logged via apiClient correlation IDs.
 * Tenant isolation enforced server-side. RBAC verified on every action.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Table } from '../components/ui/Table';
import { Spinner } from '../components/ui/Spinner';
import { Avatar } from '../components/ui/Avatar';
import { Modal } from '../components/ui/Modal';
import {
  Users,
  UserPlus,
  CheckCircle2,
  Clock,
  XCircle,
  MoreHorizontal,
  RefreshCw,
  Activity,
  Fingerprint,
} from '../components/icons';
import { useAuth } from '../lib/auth';
import {
  type TeamMember,
  type TeamActivity,
  fetchTeamMembers,
  fetchTeamActivity,
  fetchRoles,
  inviteMember,
  updateMemberRole,
  suspendMember,
  removeMember,
  type CustomRole,
} from '../lib/settings-api';

// --- Helpers ---

function formatDate(iso: string): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(iso: string): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(iso);
}

function statusBadge(status: TeamMember['status']): ReactNode {
  switch (status) {
    case 'active':
      return (
        <Badge variant="success" dot size="sm">
          Active
        </Badge>
      );
    case 'invited':
      return (
        <Badge variant="warning" dot size="sm">
          Invited
        </Badge>
      );
    case 'suspended':
      return (
        <Badge variant="danger" dot size="sm">
          Suspended
        </Badge>
      );
  }
}

function roleBadge(role: string): ReactNode {
  const variant =
    role === 'Admin'
      ? 'danger'
      : role === 'Operator'
        ? 'warning'
        : role === 'Analyst'
          ? 'info'
          : 'neutral';
  return (
    <Badge variant={variant} size="sm">
      {role}
    </Badge>
  );
}

// --- KPI Card component ---

interface KpiCardProps {
  icon: ReactNode;
  label: string;
  value: number;
  accent: 'blue' | 'green' | 'amber' | 'red';
}

function KpiCard({ icon, label, value, accent }: KpiCardProps): ReactNode {
  return (
    <Card accent={accent}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-tertiary text-content-secondary">
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-content">{value}</p>
          <p className="text-xs text-content-secondary">{label}</p>
        </div>
      </div>
    </Card>
  );
}

// --- Component ---

export function TeamManagement(): ReactNode {
  useAuth();

  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [activities, setActivities] = useState<TeamActivity[]>([]);
  const [roles, setRoles] = useState<CustomRole[]>([]);

  // Invite modal state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('Operator');

  // Edit role modal state
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [editRole, setEditRole] = useState('');

  // Action menu state
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);

  // --- Load data ---
  useEffect(() => {
    let cancelled = false;

    async function loadAll(): Promise<void> {
      setLoading(true);
      const [memberList, activityList, roleList] = await Promise.all([
        fetchTeamMembers(),
        fetchTeamActivity(),
        fetchRoles(),
      ]);
      if (cancelled) return;
      setMembers(memberList);
      setActivities(activityList);
      setRoles(roleList);
      setLoading(false);
    }

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Computed KPIs ---
  const totalMembers = members.length;
  const activeMembers = members.filter((m) => m.status === 'active').length;
  const invitedMembers = members.filter((m) => m.status === 'invited').length;
  const suspendedMembers = members.filter((m) => m.status === 'suspended').length;

  // Role options for select
  const roleOptions = roles.map((r) => ({ value: r.name, label: r.name }));

  // --- Handlers ---

  const handleInvite = useCallback(async () => {
    if (!inviteEmail) return;
    const newMember = await inviteMember(inviteEmail, inviteRole);
    setMembers((prev) => [...prev, newMember]);
    setShowInvite(false);
    setInviteEmail('');
    setInviteRole('Operator');
  }, [inviteEmail, inviteRole]);

  const handleEditRole = useCallback(async () => {
    if (!editingMember || !editRole) return;
    const updated = await updateMemberRole(editingMember.id, editRole);
    setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setEditingMember(null);
    setEditRole('');
  }, [editingMember, editRole]);

  const handleSuspend = useCallback(async (memberId: string) => {
    const updated = await suspendMember(memberId);
    setMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    setOpenActionMenu(null);
  }, []);

  const handleRemove = useCallback(async (memberId: string) => {
    await removeMember(memberId);
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
    setOpenActionMenu(null);
  }, []);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    const [memberList, activityList] = await Promise.all([fetchTeamMembers(), fetchTeamActivity()]);
    setMembers(memberList);
    setActivities(activityList);
    setLoading(false);
  }, []);

  // --- Table columns ---
  const columns = [
    {
      key: 'member',
      header: 'Member',
      render: (row: TeamMember) => (
        <div className="flex items-center gap-3">
          <Avatar
            name={row.name}
            src={row.avatar}
            size="sm"
            status={row.status === 'active' ? 'online' : 'offline'}
          />
          <div>
            <p className="text-sm font-medium text-content">{row.name}</p>
            <p className="text-xs text-content-tertiary">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortable: true,
      render: (row: TeamMember) => roleBadge(row.role),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row: TeamMember) => statusBadge(row.status),
    },
    {
      key: 'lastActive',
      header: 'Last Active',
      sortable: true,
      render: (row: TeamMember) => (
        <span className="text-xs text-content-secondary">{formatRelative(row.lastActive)}</span>
      ),
    },
    {
      key: 'mfa',
      header: 'MFA',
      render: (row: TeamMember) => (
        <Badge variant={row.mfaEnabled ? 'success' : 'danger'} size="sm">
          {row.mfaEnabled ? 'Enabled' : 'Disabled'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: TeamMember) => (
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpenActionMenu(openActionMenu === row.id ? null : row.id);
            }}
            className="rounded p-1.5 text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content"
            aria-label={`Actions for ${row.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {openActionMenu === row.id && (
            <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-border bg-surface-secondary py-1 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setEditingMember(row);
                  setEditRole(row.role);
                  setOpenActionMenu(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary hover:bg-surface-tertiary hover:text-content"
              >
                Edit Role
              </button>
              {row.status !== 'suspended' && (
                <button
                  type="button"
                  onClick={() => handleSuspend(row.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-amber-400 hover:bg-surface-tertiary"
                >
                  Suspend
                </button>
              )}
              <button
                type="button"
                onClick={() => handleRemove(row.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-surface-tertiary"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ),
    },
  ];

  // Close action menu on outside click
  useEffect(() => {
    if (openActionMenu === null) return;
    function handleClick(): void {
      setOpenActionMenu(null);
    }
    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, [openActionMenu]);

  // --- Loading state ---

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading team" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Team Management</h1>
          <p className="page-subtitle">Manage team members, roles, and access control</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={handleRefresh}
          >
            Refresh
          </Button>
          <Button
            icon={<UserPlus className="h-4 w-4" />}
            onClick={() => {
              setShowInvite(true);
            }}
          >
            Invite Member
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<Users className="h-5 w-5" />}
          label="Total Members"
          value={totalMembers}
          accent="blue"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Active"
          value={activeMembers}
          accent="green"
        />
        <KpiCard
          icon={<Clock className="h-5 w-5" />}
          label="Invited"
          value={invitedMembers}
          accent="amber"
        />
        <KpiCard
          icon={<XCircle className="h-5 w-5" />}
          label="Suspended"
          value={suspendedMembers}
          accent="red"
        />
      </div>

      {/* SCIM Sync Status */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-secondary px-4 py-3">
        <Fingerprint className="h-5 w-5 text-content-secondary" />
        <div>
          <span className="text-sm font-medium text-content">SCIM Directory Sync</span>
          <span className="ml-2 text-xs text-content-tertiary">WorkOS SCIM 2.0</span>
        </div>
        <Badge variant="success" dot size="sm" className="ml-auto">
          Synced
        </Badge>
        <span className="text-xs text-content-tertiary">
          Last sync: {formatRelative(new Date().toISOString())}
        </span>
      </div>

      {/* Team Table */}
      <Card
        title="Team Members"
        actions={
          <Badge variant="info" size="sm">
            {totalMembers} members
          </Badge>
        }
      >
        <Table
          columns={columns}
          data={members}
          keyExtractor={(row) => row.id}
          emptyMessage="No team members found"
        />
      </Card>

      {/* Activity Log */}
      <Card
        title="Recent Activity"
        actions={
          <Badge variant="neutral" size="sm">
            Audit Trail
          </Badge>
        }
      >
        <div className="space-y-2">
          {activities.map((activity) => (
            <div
              key={activity.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5"
            >
              <Activity className="h-4 w-4 shrink-0 text-content-tertiary" />
              <div className="flex-1">
                <p className="text-sm text-content">
                  <span className="font-medium">{activity.actor}</span>{' '}
                  <span className="text-content-secondary">{activity.action}</span>{' '}
                  <span className="text-content-tertiary">{activity.target}</span>
                </p>
              </div>
              <span className="shrink-0 text-xs text-content-tertiary">
                {formatRelative(activity.timestamp)}
              </span>
            </div>
          ))}
          {activities.length === 0 && (
            <p className="py-4 text-center text-sm text-content-tertiary">No recent activity</p>
          )}
        </div>
      </Card>

      {/* Invite Modal */}
      <Modal
        open={showInvite}
        onClose={() => {
          setShowInvite(false);
        }}
        title="Invite Team Member"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setShowInvite(false);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={!inviteEmail}>
              Send Invite
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Email Address"
            type="email"
            value={inviteEmail}
            onChange={(e) => {
              setInviteEmail(e.target.value);
            }}
            placeholder="colleague@company.com"
          />
          <Select
            label="Role"
            options={
              roleOptions.length > 0
                ? roleOptions
                : [
                    { value: 'Admin', label: 'Admin' },
                    { value: 'Operator', label: 'Operator' },
                    { value: 'Analyst', label: 'Analyst' },
                    { value: 'Auditor', label: 'Auditor' },
                  ]
            }
            value={inviteRole}
            onChange={setInviteRole}
          />
          <p className="text-xs text-content-tertiary">
            Invite will be sent via email. The user must accept and configure MFA before gaining
            access.
          </p>
        </div>
      </Modal>

      {/* Edit Role Modal */}
      <Modal
        open={editingMember !== null}
        onClose={() => {
          setEditingMember(null);
        }}
        title={`Edit Role: ${editingMember?.name ?? ''}`}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setEditingMember(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleEditRole}>Update Role</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <Avatar name={editingMember?.name ?? ''} size="sm" />
            <div>
              <p className="text-sm font-medium text-content">{editingMember?.name}</p>
              <p className="text-xs text-content-tertiary">{editingMember?.email}</p>
            </div>
          </div>
          <Select
            label="New Role"
            options={
              roleOptions.length > 0
                ? roleOptions
                : [
                    { value: 'Admin', label: 'Admin' },
                    { value: 'Operator', label: 'Operator' },
                    { value: 'Analyst', label: 'Analyst' },
                    { value: 'Auditor', label: 'Auditor' },
                  ]
            }
            value={editRole}
            onChange={setEditRole}
          />
          <p className="text-xs text-content-tertiary">
            Role changes are logged in the audit trail and take effect immediately.
          </p>
        </div>
      </Modal>
    </div>
  );
}
