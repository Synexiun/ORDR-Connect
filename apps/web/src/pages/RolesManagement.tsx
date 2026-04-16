/**
 * Roles & Permissions Management — custom RBAC/ABAC role administration.
 *
 * Enables admins to define custom roles layered over the system base roles,
 * with fine-grained permissions (resource × action × scope).
 *
 * SOC2 CC6.2 — Documented, audit-logged management of access rights.
 * SOC2 CC6.3 — Principle of least privilege via role-specific permission sets.
 * ISO 27001 A.9.2.3 — Privileged access management.
 * HIPAA §164.312(a)(1) — Fine-grained access control model.
 *
 * SECURITY: No PHI in role data (Rule 6). Tenant ID from JWT (Rule 2).
 *           All writes are audit-logged server-side (Rule 3).
 */

import { type ReactNode, useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge, type BadgeVariant } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { Spinner } from '../components/ui/Spinner';
import {
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  Users,
  X,
  Check,
  UserPlus,
  UserMinus,
  Lock,
} from '../components/icons';
import {
  rolesApi,
  type CustomRole,
  type BaseRole,
  type Permission,
  type PermAction,
  type PermScope,
  type CreateRoleBody,
  type UpdateRoleBody,
} from '../lib/roles-api';

// ── Constants ──────────────────────────────────────────────────────────────────

const BASE_ROLE_META: Record<
  BaseRole,
  { label: string; variant: BadgeVariant; description: string }
> = {
  super_admin: { label: 'Super Admin', variant: 'danger', description: 'Full system access' },
  tenant_admin: { label: 'Tenant Admin', variant: 'warning', description: 'Full tenant access' },
  manager: { label: 'Manager', variant: 'info', description: 'Team management access' },
  agent: { label: 'Agent', variant: 'default', description: 'Standard agent access' },
  viewer: { label: 'Viewer', variant: 'neutral', description: 'Read-only access' },
};

const ACTION_COLORS: Record<PermAction, string> = {
  create: 'text-emerald-500',
  read: 'text-blue-400',
  update: 'text-amber-500',
  delete: 'text-red-500',
  execute: 'text-purple-400',
};

const SCOPE_LABELS: Record<PermScope, string> = {
  own: 'Own',
  team: 'Team',
  tenant: 'Tenant',
  global: 'Global',
};

// Common system resources for the permission builder datalist
const COMMON_RESOURCES = [
  'customers',
  'interactions',
  'tickets',
  'orders',
  'agents',
  'analytics',
  'reports',
  'billing',
  'settings',
  'users',
  'workflows',
  'integrations',
  'feature_flags',
  'audit_logs',
  'sla_policies',
  'dsr_requests',
];

const MOCK_ROLES: CustomRole[] = [
  {
    id: 'r1',
    name: 'Support Lead',
    description: 'Team leads who manage agent queues and escalations.',
    baseRole: 'manager',
    permissions: [
      { resource: 'tickets', action: 'create', scope: 'team' },
      { resource: 'tickets', action: 'update', scope: 'team' },
      { resource: 'tickets', action: 'delete', scope: 'team' },
      { resource: 'agents', action: 'read', scope: 'team' },
      { resource: 'analytics', action: 'read', scope: 'tenant' },
    ],
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: 'r2',
    name: 'Compliance Auditor',
    description: 'Read-only access to audit logs, DSR requests, and compliance reports.',
    baseRole: 'viewer',
    permissions: [
      { resource: 'audit_logs', action: 'read', scope: 'tenant' },
      { resource: 'dsr_requests', action: 'read', scope: 'tenant' },
      { resource: 'reports', action: 'read', scope: 'tenant' },
      { resource: 'sla_policies', action: 'read', scope: 'tenant' },
    ],
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
  {
    id: 'r3',
    name: 'Billing Manager',
    description: 'Access to billing records and subscription management.',
    baseRole: 'agent',
    permissions: [
      { resource: 'billing', action: 'read', scope: 'tenant' },
      { resource: 'billing', action: 'update', scope: 'tenant' },
      { resource: 'customers', action: 'read', scope: 'tenant' },
    ],
    createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ── PermissionRow ──────────────────────────────────────────────────────────────

interface PermRowProps {
  perm: Permission;
  index: number;
  onChange: (index: number, perm: Permission) => void;
  onRemove: (index: number) => void;
}

function PermissionRow({ perm, index, onChange, onRemove }: PermRowProps): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <Input
        list="resource-list"
        value={perm.resource}
        onChange={(e) => {
          onChange(index, { ...perm, resource: e.target.value });
        }}
        placeholder="resource"
        className="flex-1 font-mono text-xs"
        required
      />
      <select
        value={perm.action}
        onChange={(e) => {
          onChange(index, { ...perm, action: e.target.value as PermAction });
        }}
        className="rounded-lg border border-border bg-surface-secondary px-2 py-1.5 text-xs text-content focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
      >
        <option value="create">create</option>
        <option value="read">read</option>
        <option value="update">update</option>
        <option value="delete">delete</option>
        <option value="execute">execute</option>
      </select>
      <select
        value={perm.scope}
        onChange={(e) => {
          onChange(index, { ...perm, scope: e.target.value as PermScope });
        }}
        className="rounded-lg border border-border bg-surface-secondary px-2 py-1.5 text-xs text-content focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
      >
        <option value="own">own</option>
        <option value="team">team</option>
        <option value="tenant">tenant</option>
        <option value="global">global</option>
      </select>
      <button
        type="button"
        onClick={() => {
          onRemove(index);
        }}
        className="rounded p-1 text-content-tertiary hover:bg-red-500/10 hover:text-red-500"
        aria-label="Remove permission"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── RoleModal ──────────────────────────────────────────────────────────────────

interface RoleFormState {
  name: string;
  description: string;
  baseRole: BaseRole;
  permissions: Permission[];
}

interface RoleModalProps {
  open: boolean;
  editing: CustomRole | null;
  onClose: () => void;
  onSave: (form: RoleFormState) => Promise<void>;
}

function RoleModal({ open, editing, onClose, onSave }: RoleModalProps): ReactNode {
  const [form, setForm] = useState<RoleFormState>({
    name: '',
    description: '',
    baseRole: 'agent',
    permissions: [],
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: editing?.name ?? '',
        description: editing?.description ?? '',
        baseRole: editing?.baseRole ?? 'agent',
        permissions: editing?.permissions ? [...editing.permissions] : [],
      });
    }
  }, [open, editing]);

  const handlePermChange = useCallback((index: number, perm: Permission) => {
    setForm((f) => {
      const next = [...f.permissions];
      next[index] = perm;
      return { ...f, permissions: next };
    });
  }, []);

  const handlePermRemove = useCallback((index: number) => {
    setForm((f) => ({ ...f, permissions: f.permissions.filter((_, i) => i !== index) }));
  }, []);

  const handleAddPerm = useCallback(() => {
    setForm((f) => ({
      ...f,
      permissions: [...f.permissions, { resource: '', action: 'read', scope: 'own' }],
    }));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSaving(true);
      try {
        await onSave(form);
        onClose();
      } finally {
        setSaving(false);
      }
    },
    [form, onSave, onClose],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing !== null ? `Edit "${editing.name}"` : 'New Custom Role'}
      size="lg"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" form="role-form" disabled={saving}>
            {saving ? <Spinner size="sm" /> : editing !== null ? 'Save Changes' : 'Create Role'}
          </Button>
        </>
      }
    >
      <datalist id="resource-list">
        {COMMON_RESOURCES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <form
        id="role-form"
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="space-y-4"
      >
        {/* Name */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-content">Role Name</label>
          <Input
            value={form.name}
            onChange={(e) => {
              setForm((f) => ({ ...f, name: e.target.value }));
            }}
            placeholder="Support Lead"
            required
            maxLength={100}
          />
        </div>

        {/* Base Role */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-content">Base Role</label>
          <select
            value={form.baseRole}
            onChange={(e) => {
              setForm((f) => ({ ...f, baseRole: e.target.value as BaseRole }));
            }}
            className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
          >
            {(
              Object.entries(BASE_ROLE_META) as [BaseRole, { label: string; description: string }][]
            ).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label} — {meta.description}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-content-tertiary">
            Custom permissions extend the base role; they do not replace its built-in access.
          </p>
        </div>

        {/* Description */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-content">
            Description <span className="font-normal text-content-tertiary">(optional)</span>
          </label>
          <Textarea
            value={form.description}
            onChange={(e) => {
              setForm((f) => ({ ...f, description: e.target.value }));
            }}
            placeholder="Who uses this role and what can they do?"
            rows={2}
            maxLength={1000}
          />
        </div>

        {/* Permissions */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-content">
              Permissions{' '}
              <span className="font-normal text-content-tertiary">
                ({String(form.permissions.length)})
              </span>
            </label>
            <Button variant="outline" size="sm" type="button" onClick={handleAddPerm}>
              <Plus className="h-3.5 w-3.5" />
              Add Permission
            </Button>
          </div>
          {form.permissions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border py-3 text-center text-xs text-content-tertiary">
              No custom permissions — role uses base role defaults only.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-1">
                <p className="text-xs font-medium text-content-tertiary">Resource</p>
                <p className="w-20 text-xs font-medium text-content-tertiary">Action</p>
                <p className="w-16 text-xs font-medium text-content-tertiary">Scope</p>
                <p className="w-6" />
              </div>
              {form.permissions.map((perm, i) => (
                <PermissionRow
                  key={i}
                  perm={perm}
                  index={i}
                  onChange={handlePermChange}
                  onRemove={handlePermRemove}
                />
              ))}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ── DeleteConfirm ──────────────────────────────────────────────────────────────

interface DeleteConfirmProps {
  open: boolean;
  roleName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function DeleteConfirm({ open, roleName, onClose, onConfirm }: DeleteConfirmProps): ReactNode {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = useCallback(async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
    }
  }, [onConfirm]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete Role"
      size="sm"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={deleting}
          >
            {deleting ? <Spinner size="sm" /> : 'Delete Role'}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div>
          <p className="text-sm text-content">
            Delete role <span className="font-semibold text-content">{roleName}</span>?
          </p>
          <p className="mt-1 text-sm text-content-secondary">
            Users assigned this role will lose its permissions immediately. This action is permanent
            and WORM-audited.
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ── AssignModal ────────────────────────────────────────────────────────────────

interface AssignModalProps {
  open: boolean;
  mode: 'assign' | 'revoke';
  roleName: string;
  onClose: () => void;
  onConfirm: (userId: string) => Promise<void>;
}

function AssignModal({ open, mode, roleName, onClose, onConfirm }: AssignModalProps): ReactNode {
  const [userId, setUserId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setUserId('');
  }, [open]);

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (userId.trim() === '') return;
      setSaving(true);
      try {
        await onConfirm(userId.trim());
        onClose();
      } finally {
        setSaving(false);
      }
    },
    [userId, onConfirm, onClose],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'assign' ? `Assign "${roleName}"` : `Revoke "${roleName}"`}
      size="sm"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={mode === 'assign' ? 'primary' : 'danger'}
            size="sm"
            type="submit"
            form="assign-form"
            disabled={saving || userId.trim() === ''}
          >
            {saving ? <Spinner size="sm" /> : mode === 'assign' ? 'Assign Role' : 'Revoke Role'}
          </Button>
        </>
      }
    >
      <form
        id="assign-form"
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="space-y-3"
      >
        <div>
          <label className="mb-1.5 block text-sm font-medium text-content">User ID</label>
          <Input
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
            }}
            placeholder="usr_xxxxxxxxxxxxxxxx"
            className="font-mono"
            required
          />
          <p className="mt-1 text-xs text-content-tertiary">
            Find User IDs in Team Management or the Audit Log.
          </p>
        </div>
      </form>
    </Modal>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────────

interface DetailPanelProps {
  role: CustomRole;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAssign: () => void;
  onRevoke: () => void;
}

function DetailPanel({
  role,
  onClose,
  onEdit,
  onDelete,
  onAssign,
  onRevoke,
}: DetailPanelProps): ReactNode {
  const base = BASE_ROLE_META[role.baseRole];

  // Group permissions by resource for cleaner display
  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of role.permissions) {
      const existing = map.get(p.resource);
      if (existing !== undefined) {
        existing.push(p);
      } else {
        map.set(p.resource, [p]);
      }
    }
    return map;
  }, [role.permissions]);

  return (
    <div className="flex w-96 shrink-0 flex-col border-l border-border bg-surface">
      {/* Panel header */}
      <div className="flex items-start justify-between border-b border-border px-4 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-brand-accent" />
            <h2 className="text-sm font-semibold text-content">{role.name}</h2>
          </div>
          {role.description !== '' && (
            <p className="mt-1 text-xs text-content-tertiary">{role.description}</p>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-content-tertiary hover:text-content"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Role meta */}
      <div className="border-b border-border px-4 py-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-content-tertiary">Base Role</span>
          <Badge variant={base.variant}>{base.label}</Badge>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-content-tertiary">Permissions</span>
          <span className="font-semibold text-content">{String(role.permissions.length)}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-content-tertiary">Last Updated</span>
          <span className="text-content-secondary">{formatDate(role.updatedAt)}</span>
        </div>
      </div>

      {/* Permissions */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
          Custom Permissions
        </p>
        {grouped.size === 0 ? (
          <p className="text-xs text-content-tertiary">
            No custom permissions — base role defaults only.
          </p>
        ) : (
          <div className="space-y-3">
            {Array.from(grouped.entries()).map(([resource, perms]) => (
              <div key={resource}>
                <p className="mb-1 font-mono text-xs font-semibold text-content">{resource}</p>
                <div className="space-y-1">
                  {perms.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 pl-2">
                      <Check className="h-3 w-3 text-emerald-500" />
                      <span className={`text-xs ${ACTION_COLORS[p.action]}`}>{p.action}</span>
                      <span className="text-xs text-content-tertiary">·</span>
                      <span className="text-xs text-content-secondary">
                        {SCOPE_LABELS[p.scope]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t border-border px-4 py-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={onAssign} className="w-full">
            <UserPlus className="h-4 w-4" />
            Assign
          </Button>
          <Button variant="outline" size="sm" onClick={onRevoke} className="w-full">
            <UserMinus className="h-4 w-4" />
            Revoke
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} className="w-full">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            className="w-full text-red-500 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function RolesManagement(): ReactNode {
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomRole | null>(null);
  const [assignTarget, setAssignTarget] = useState<{
    role: CustomRole;
    mode: 'assign' | 'revoke';
  } | null>(null);

  // ── Load ──

  useEffect(() => {
    setLoading(true);
    void rolesApi
      .list()
      .then((data) => {
        setRoles(data.length > 0 ? data : MOCK_ROLES);
      })
      .catch(() => {
        setRoles(MOCK_ROLES);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedId) ?? null,
    [roles, selectedId],
  );

  // ── Stats ──

  const totalPerms = useMemo(
    () => roles.reduce((acc, r) => acc + r.permissions.length, 0),
    [roles],
  );

  // ── Create / Edit ──

  const handleSave = useCallback(
    async (form: RoleFormState) => {
      if (editingRole !== null) {
        const body: UpdateRoleBody = {
          name: form.name,
          description: form.description,
          permissions: form.permissions,
        };
        const updated = await rolesApi.update(editingRole.id, body).catch(() => null);
        if (updated !== null) {
          setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
          if (selectedId === editingRole.id) setSelectedId(updated.id);
        }
      } else {
        const body: CreateRoleBody = {
          name: form.name,
          description: form.description,
          baseRole: form.baseRole,
          permissions: form.permissions,
        };
        const created = await rolesApi.create(body).catch(() => null);
        if (created !== null) {
          setRoles((prev) => [created, ...prev]);
        }
      }
    },
    [editingRole, selectedId],
  );

  // ── Delete ──

  const handleDelete = useCallback(async () => {
    if (deleteTarget === null) return;
    await rolesApi.remove(deleteTarget.id).catch(() => null);
    setRoles((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    if (selectedId === deleteTarget.id) setSelectedId(null);
    setDeleteTarget(null);
  }, [deleteTarget, selectedId]);

  // ── Assign / Revoke ──

  const handleAssignRevoke = useCallback(
    async (userId: string) => {
      if (assignTarget === null) return;
      if (assignTarget.mode === 'assign') {
        await rolesApi.assign(assignTarget.role.id, userId).catch(() => null);
      } else {
        await rolesApi.revoke(assignTarget.role.id, userId).catch(() => null);
      }
    },
    [assignTarget],
  );

  // ── Render ──

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        {/* Main panel */}
        <div className="flex flex-1 flex-col overflow-auto p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-accent/10">
                <ShieldCheck className="h-5 w-5 text-brand-accent" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-content">Roles & Permissions</h1>
                <p className="text-sm text-content-tertiary">
                  Custom RBAC/ABAC roles layered over system base roles
                </p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingRole(null);
                setModalOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New Role
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <Lock className="h-5 w-5 text-brand-accent" />
                <div>
                  <p className="text-2xl font-bold text-content">{String(roles.length)}</p>
                  <p className="text-xs text-content-tertiary">Custom Roles</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-content-secondary" />
                <div>
                  <p className="text-2xl font-bold text-content">{String(totalPerms)}</p>
                  <p className="text-xs text-content-tertiary">Total Permissions</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Roles list */}
          <Card>
            {loading ? (
              <div className="flex h-48 items-center justify-center">
                <Spinner size="lg" label="Loading roles" />
              </div>
            ) : roles.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-content-tertiary">
                No custom roles defined yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {roles.map((role) => {
                  const base = BASE_ROLE_META[role.baseRole];
                  const isSelected = selectedId === role.id;
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(isSelected ? null : role.id);
                      }}
                      className={`w-full px-4 py-3 text-left transition-colors hover:bg-surface-tertiary/30 ${
                        isSelected ? 'bg-brand-accent/5' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-content">{role.name}</span>
                            <Badge variant={base.variant} size="sm">
                              {base.label}
                            </Badge>
                          </div>
                          {role.description !== '' && (
                            <p className="mt-0.5 truncate text-xs text-content-tertiary">
                              {role.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-content-secondary">
                          <span>{String(role.permissions.length)} permissions</span>
                          <span className="hidden lg:block">{formatDate(role.updatedAt)}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Detail panel */}
        {selectedRole !== null && (
          <DetailPanel
            role={selectedRole}
            onClose={() => {
              setSelectedId(null);
            }}
            onEdit={() => {
              setEditingRole(selectedRole);
              setModalOpen(true);
            }}
            onDelete={() => {
              setDeleteTarget(selectedRole);
            }}
            onAssign={() => {
              setAssignTarget({ role: selectedRole, mode: 'assign' });
            }}
            onRevoke={() => {
              setAssignTarget({ role: selectedRole, mode: 'revoke' });
            }}
          />
        )}
      </div>

      {/* Modals */}
      <RoleModal
        open={modalOpen}
        editing={editingRole}
        onClose={() => {
          setModalOpen(false);
        }}
        onSave={handleSave}
      />

      <DeleteConfirm
        open={deleteTarget !== null}
        roleName={deleteTarget?.name ?? ''}
        onClose={() => {
          setDeleteTarget(null);
        }}
        onConfirm={handleDelete}
      />

      <AssignModal
        open={assignTarget !== null}
        mode={assignTarget?.mode ?? 'assign'}
        roleName={assignTarget?.role.name ?? ''}
        onClose={() => {
          setAssignTarget(null);
        }}
        onConfirm={handleAssignRevoke}
      />
    </div>
  );
}
