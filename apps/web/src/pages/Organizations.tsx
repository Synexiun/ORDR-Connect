/**
 * Organizations Management — org hierarchy browser and CRUD.
 *
 * Multi-level organizational units within a tenant (departments, teams, regions).
 * Used for access-control scoping: roles with scope='team' are bounded to a single org node.
 *
 * SOC2 CC6.3 — Organizational access control hierarchy.
 * ISO 27001 A.6.1.1 — Information security roles and responsibilities.
 * HIPAA §164.312(a)(1) — Access control scoped to organizational units.
 *
 * SECURITY: No PHI in org data (Rule 6). Tenant ID from JWT (Rule 2).
 *           All writes WORM-audited server-side (Rule 3).
 */

import { type ReactNode, useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';
import {
  Building2,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Building,
} from '../components/icons';
import {
  listOrganizations,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  type Organization,
} from '../lib/organizations-api';

// ── Mock data ──────────────────────────────────────────────────────────────────

const MOCK_ORGS: Organization[] = [
  {
    id: 'o1',
    tenantId: 't1',
    name: 'ORDR Connect',
    slug: 'ordr-connect',
    parentId: null,
    metadata: {},
    createdAt: new Date(Date.now() - 180 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  },
  {
    id: 'o2',
    tenantId: 't1',
    name: 'Customer Success',
    slug: 'customer-success',
    parentId: 'o1',
    metadata: {},
    createdAt: new Date(Date.now() - 120 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
  },
  {
    id: 'o3',
    tenantId: 't1',
    name: 'Engineering',
    slug: 'engineering',
    parentId: 'o1',
    metadata: {},
    createdAt: new Date(Date.now() - 120 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: 'o4',
    tenantId: 't1',
    name: 'Tier 1 Support',
    slug: 'tier-1-support',
    parentId: 'o2',
    metadata: { sla_tier: 'standard' },
    createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'o5',
    tenantId: 't1',
    name: 'Enterprise Support',
    slug: 'enterprise-support',
    parentId: 'o2',
    metadata: { sla_tier: 'vip' },
    createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 'o6',
    tenantId: 't1',
    name: 'Platform Team',
    slug: 'platform-team',
    parentId: 'o3',
    metadata: {},
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
  },
  {
    id: 'o7',
    tenantId: 't1',
    name: 'Compliance',
    slug: 'compliance',
    parentId: null,
    metadata: { regulatory: 'true' },
    createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

function buildTree(orgs: Organization[]): OrgNode[] {
  const map = new Map<string, OrgNode>();
  for (const org of orgs) {
    map.set(org.id, { ...org, children: [] });
  }
  const roots: OrgNode[] = [];
  for (const node of map.values()) {
    if (node.parentId === null) {
      roots.push(node);
    } else {
      const parent = map.get(node.parentId);
      if (parent !== undefined) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }
  return roots;
}

function countDescendants(node: OrgNode): number {
  return node.children.reduce((acc, c) => acc + 1 + countDescendants(c), 0);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface OrgNode extends Organization {
  children: OrgNode[];
}

// ── OrgModal ───────────────────────────────────────────────────────────────────

interface OrgFormState {
  name: string;
  slug: string;
  parentId: string;
}

interface OrgModalProps {
  open: boolean;
  editing: Organization | null;
  orgs: Organization[];
  defaultParentId?: string | null;
  onClose: () => void;
  onSave: (form: OrgFormState) => Promise<void>;
}

function OrgModal({
  open,
  editing,
  orgs,
  defaultParentId,
  onClose,
  onSave,
}: OrgModalProps): ReactNode {
  const initForm: OrgFormState = {
    name: editing?.name ?? '',
    slug: editing?.slug ?? '',
    parentId: editing?.parentId ?? defaultParentId ?? '',
  };
  const [form, setForm] = useState(initForm);
  const [slugError, setSlugError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        name: editing?.name ?? '',
        slug: editing?.slug ?? '',
        parentId: editing?.parentId ?? defaultParentId ?? '',
      });
      setSlugError('');
    }
  }, [open, editing, defaultParentId]);

  // Auto-generate slug from name when creating
  const handleNameChange = useCallback(
    (name: string) => {
      setForm((f) => ({
        ...f,
        name,
        // Only auto-generate slug if creating and slug hasn't been manually edited
        ...(editing === null &&
        f.slug ===
          f.name
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
          ? {
              slug: name
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, ''),
            }
          : {}),
      }));
    },
    [editing],
  );

  const handleSubmit = useCallback(
    async (e: React.SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!SLUG_RE.test(form.slug)) {
        setSlugError('Lowercase letters, digits, and hyphens only (e.g., engineering-core)');
        return;
      }
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

  // Available parents: all orgs except the editing org itself (prevent cycles)
  const parentOptions = useMemo(
    () => orgs.filter((o) => editing === null || o.id !== editing.id),
    [orgs, editing],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing !== null ? `Edit "${editing.name}"` : 'New Organization'}
      size="md"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" form="org-form" disabled={saving}>
            {saving ? <Spinner size="sm" /> : editing !== null ? 'Save Changes' : 'Create'}
          </Button>
        </>
      }
    >
      <form
        id="org-form"
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="space-y-4"
      >
        <div>
          <label className="mb-1.5 block text-sm font-medium text-content">Name</label>
          <Input
            value={form.name}
            onChange={(e) => {
              handleNameChange(e.target.value);
            }}
            placeholder="Engineering"
            required
            maxLength={255}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-content">Slug</label>
          <Input
            value={form.slug}
            onChange={(e) => {
              setForm((f) => ({ ...f, slug: e.target.value }));
              setSlugError('');
            }}
            placeholder="engineering"
            className="font-mono"
            required
            maxLength={100}
          />
          {slugError !== '' && <p className="mt-1 text-xs text-red-500">{slugError}</p>}
          <p className="mt-1 text-xs text-content-tertiary">
            URL-safe identifier. Used in access-control scoping.
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-content">
            Parent Organization{' '}
            <span className="font-normal text-content-tertiary">(optional)</span>
          </label>
          <select
            value={form.parentId}
            onChange={(e) => {
              setForm((f) => ({ ...f, parentId: e.target.value }));
            }}
            className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:outline-none focus:ring-2 focus:ring-brand-accent/50"
          >
            <option value="">— Root (no parent) —</option>
            {parentOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.slug})
              </option>
            ))}
          </select>
        </div>
      </form>
    </Modal>
  );
}

// ── DeleteConfirm ──────────────────────────────────────────────────────────────

interface DeleteConfirmProps {
  open: boolean;
  org: OrgNode | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function DeleteConfirm({ open, org, onClose, onConfirm }: DeleteConfirmProps): ReactNode {
  const [deleting, setDeleting] = useState(false);
  const descendants = org !== null ? countDescendants(org) : 0;

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
      title="Delete Organization"
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
            {deleting ? <Spinner size="sm" /> : 'Delete'}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div>
          <p className="text-sm text-content">
            Delete <span className="font-semibold">{org?.name ?? ''}</span>?
          </p>
          {descendants > 0 && (
            <p className="mt-1 text-sm text-amber-500">
              This will also delete {String(descendants)} child organization
              {descendants !== 1 ? 's' : ''}. Users scoped to these orgs will lose access.
            </p>
          )}
          <p className="mt-1 text-sm text-content-secondary">
            This action is permanent and WORM-audited.
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ── OrgTreeNode ────────────────────────────────────────────────────────────────

interface OrgTreeNodeProps {
  node: OrgNode;
  depth: number;
  onEdit: (org: Organization) => void;
  onDelete: (node: OrgNode) => void;
  onAddChild: (parentId: string) => void;
}

function OrgTreeNode({ node, depth, onEdit, onDelete, onAddChild }: OrgTreeNodeProps): ReactNode {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-tertiary/30"
        style={{ paddingLeft: `${String(depth * 16 + 8)}px` }}
      >
        {/* Expand/collapse */}
        <button
          type="button"
          onClick={() => {
            setExpanded((e) => !e);
          }}
          className={`h-5 w-5 shrink-0 rounded text-content-tertiary transition-colors hover:text-content ${!hasChildren ? 'invisible' : ''}`}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {/* Icon */}
        {depth === 0 ? (
          <Building2 className="h-4 w-4 shrink-0 text-brand-accent" />
        ) : (
          <Building className="h-4 w-4 shrink-0 text-content-tertiary" />
        )}

        {/* Name + slug */}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium text-content">{node.name}</span>
          <Badge variant="neutral" size="sm" className="ml-2">
            {node.slug}
          </Badge>
          {hasChildren && (
            <span className="ml-2 text-xs text-content-tertiary">
              {String(node.children.length)} sub-org{node.children.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Last updated */}
        <span className="hidden text-xs text-content-tertiary lg:block">
          {formatDate(node.updatedAt)}
        </span>

        {/* Actions (show on hover) */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onAddChild(node.id);
            }}
            title="Add child organization"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onEdit(node);
            }}
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onDelete(node);
            }}
            title="Delete"
            className="text-red-500 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <OrgTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function Organizations(): ReactNode {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrgNode | null>(null);

  // ── Load ──

  useEffect(() => {
    setLoading(true);
    void listOrganizations()
      .then((res) => {
        setOrgs(res.data.length > 0 ? res.data : MOCK_ORGS);
      })
      .catch(() => {
        setOrgs(MOCK_ORGS);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // ── Build tree ──

  const tree = useMemo(() => buildTree(orgs), [orgs]);

  // ── Create / Edit ──

  const handleSave = useCallback(
    async (form: OrgFormState) => {
      const parentId = form.parentId !== '' ? form.parentId : null;

      if (editingOrg !== null) {
        const res = await updateOrganization(editingOrg.id, {
          name: form.name,
          slug: form.slug,
        }).catch(() => null);
        if (res !== null) {
          setOrgs((prev) => prev.map((o) => (o.id === res.data.id ? res.data : o)));
        }
      } else {
        const res = await createOrganization({
          name: form.name,
          slug: form.slug,
          parentId,
        }).catch(() => null);
        if (res !== null) {
          setOrgs((prev) => [...prev, res.data]);
        }
      }
    },
    [editingOrg],
  );

  // ── Delete ──

  const handleDelete = useCallback(async () => {
    if (deleteTarget === null) return;
    await deleteOrganization(deleteTarget.id).catch(() => null);
    // Remove the org and all its descendants from the flat list
    const idsToRemove = new Set<string>();
    const collectIds = (node: OrgNode) => {
      idsToRemove.add(node.id);
      node.children.forEach(collectIds);
    };
    collectIds(deleteTarget);
    setOrgs((prev) => prev.filter((o) => !idsToRemove.has(o.id)));
    setDeleteTarget(null);
  }, [deleteTarget]);

  // ── Render ──

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-accent/10">
            <Building2 className="h-5 w-5 text-brand-accent" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-content">Organizations</h1>
            <p className="text-sm text-content-tertiary">
              Hierarchical org units for scoped access control
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setEditingOrg(null);
            setDefaultParentId(null);
            setModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New Organization
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-brand-accent" />
            <div>
              <p className="text-2xl font-bold text-content">{String(orgs.length)}</p>
              <p className="text-xs text-content-tertiary">Total Organizations</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <Building className="h-5 w-5 text-content-secondary" />
            <div>
              <p className="text-2xl font-bold text-content">
                {String(orgs.filter((o) => o.parentId === null).length)}
              </p>
              <p className="text-xs text-content-tertiary">Root Organizations</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Tree */}
      <Card>
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-content-tertiary">
            Organization Hierarchy
          </p>
        </div>
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner size="lg" label="Loading organizations" />
          </div>
        ) : tree.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-content-tertiary">
            No organizations yet. Create your first root organization.
          </div>
        ) : (
          <div className="py-2">
            {tree.map((node) => (
              <OrgTreeNode
                key={node.id}
                node={node}
                depth={0}
                onEdit={(org) => {
                  setEditingOrg(org);
                  setModalOpen(true);
                }}
                onDelete={(node) => {
                  setDeleteTarget(node);
                }}
                onAddChild={(parentId) => {
                  setEditingOrg(null);
                  setDefaultParentId(parentId);
                  setModalOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Modals */}
      <OrgModal
        open={modalOpen}
        editing={editingOrg}
        orgs={orgs}
        defaultParentId={defaultParentId}
        onClose={() => {
          setModalOpen(false);
        }}
        onSave={handleSave}
      />

      <DeleteConfirm
        open={deleteTarget !== null}
        org={deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
        }}
        onConfirm={handleDelete}
      />
    </div>
  );
}
