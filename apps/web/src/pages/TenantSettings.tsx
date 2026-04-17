/**
 * TenantSettings — Own-tenant details and name management.
 *
 * Accessible to: tenant_admin (name update), all authenticated users (read).
 * Super-admin plan/status/slug controls are handled separately in admin console.
 *
 * COMPLIANCE:
 * - No PHI displayed — tenant metadata only (Rule 6)
 * - All mutations carry X-Request-Id for WORM audit trail (Rule 3)
 * - Tenant isolation enforced server-side; this page never sends tenant_id (Rule 2)
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import {
  Building2,
  Shield,
  Calendar,
  Clock,
  Edit,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Database,
  Wallet,
  Hash,
} from '../components/icons';
import {
  type Tenant,
  type TenantPlan,
  type TenantStatus,
  type IsolationTier,
  getMyTenant,
  updateMyTenant,
} from '../lib/tenant-api';
import type { BadgeVariant } from '../components/ui/Badge';

// ── Meta maps ─────────────────────────────────────────────────────

const PLAN_META: Record<TenantPlan, { label: string; variant: BadgeVariant }> = {
  free: { label: 'Free', variant: 'neutral' },
  starter: { label: 'Starter', variant: 'info' },
  professional: { label: 'Professional', variant: 'default' },
  enterprise: { label: 'Enterprise', variant: 'success' },
};

const STATUS_META: Record<TenantStatus, { label: string; variant: BadgeVariant; Icon: ReactNode }> =
  {
    active: {
      label: 'Active',
      variant: 'success',
      Icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
    },
    suspended: {
      label: 'Suspended',
      variant: 'warning',
      Icon: <AlertCircle className="h-4 w-4 text-amber-400" />,
    },
    deactivated: {
      label: 'Deactivated',
      variant: 'danger',
      Icon: <XCircle className="h-4 w-4 text-red-400" />,
    },
  };

const ISOLATION_META: Record<IsolationTier, { label: string; description: string }> = {
  shared: { label: 'Shared', description: 'Resources shared with other tenants' },
  schema: {
    label: 'Schema Isolated',
    description: 'Dedicated PostgreSQL schema, shared cluster',
  },
  dedicated: { label: 'Dedicated', description: 'Fully dedicated cluster and infrastructure' },
};

// ── Helpers ───────────────────────────────────────────────────────

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${String(days)} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${String(months)} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${String(years)} year${years === 1 ? '' : 's'} ago`;
}

// ── Edit Name Modal ───────────────────────────────────────────────

interface EditNameModalProps {
  currentName: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}

function EditNameModal({ currentName, onClose, onSave }: EditNameModalProps): ReactNode {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const valid = trimmed.length >= 2 && trimmed.length <= 255;

  const handleSave = useCallback(async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      onClose();
    } catch {
      setError('Failed to update tenant name. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [valid, trimmed, onSave, onClose]);

  return (
    <Modal open onClose={onClose} title="Update Tenant Name">
      <div className="space-y-4">
        <Input
          label="Tenant Name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
          placeholder="e.g. Acme Corp"
          helperText="2–255 characters. Visible to your team members."
          autoFocus
        />
        {error !== null && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!valid || saving} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Info Row ─────────────────────────────────────────────────────

interface InfoRowProps {
  label: string;
  children: ReactNode;
}

function InfoRow({ label, children }: InfoRowProps): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
      <span className="min-w-36 text-sm text-content-secondary">{label}</span>
      <div className="flex flex-1 items-center justify-end gap-2">{children}</div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────

export function TenantSettings(): ReactNode {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEditName, setShowEditName] = useState(false);

  useEffect(() => {
    setLoading(true);
    void getMyTenant().then((t) => {
      setTenant(t);
      setLoading(false);
    });
  }, []);

  const handleSaveName = useCallback(
    async (name: string) => {
      if (tenant === null) return;
      const updated = await updateMyTenant({ name });
      setTenant(updated);
    },
    [tenant],
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading tenant" />
      </div>
    );
  }

  if (tenant === null) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-content-secondary">
        <AlertCircle className="h-8 w-8" />
        <p>Could not load tenant information.</p>
      </div>
    );
  }

  const planMeta = PLAN_META[tenant.plan];
  const statusMeta = STATUS_META[tenant.status];
  const isolationMeta = ISOLATION_META[tenant.isolationTier];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-content">Tenant Settings</h1>
          <p className="mt-1 text-sm text-content-secondary">
            Manage your organisation&apos;s name and review your current plan.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {statusMeta.Icon}
          <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
        </div>
      </div>

      {/* ── Status banner for non-active tenants ───────────── */}
      {tenant.status !== 'active' && (
        <div
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
            tenant.status === 'suspended'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="text-sm">
            <p className="font-medium">
              {tenant.status === 'suspended' ? 'Tenant Suspended' : 'Tenant Deactivated'}
            </p>
            <p className="mt-0.5 text-xs opacity-80">
              {tenant.status === 'suspended'
                ? 'Your tenant has been temporarily suspended. Contact support to restore access.'
                : 'Your tenant has been deactivated. Data is retained per your retention policy. Contact sales to reactivate.'}
            </p>
          </div>
        </div>
      )}

      {/* ── Identity card ───────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-accent/15">
            <Building2 className="h-5 w-5 text-brand-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-content">{tenant.name}</p>
            <p className="text-xs text-content-tertiary">ID: {tenant.id}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setShowEditName(true);
            }}
          >
            <Edit className="mr-1.5 h-3.5 w-3.5" />
            Edit Name
          </Button>
        </div>

        <div className="pt-2">
          <InfoRow label="Tenant Name">
            <span className="text-sm font-medium text-content">{tenant.name}</span>
          </InfoRow>

          <InfoRow label="Slug">
            <div className="flex items-center gap-1.5 font-mono text-sm text-content-secondary">
              <Hash className="h-3.5 w-3.5 text-content-tertiary" />
              {tenant.slug}
            </div>
          </InfoRow>

          <InfoRow label="Plan">
            <Badge variant={planMeta.variant}>{planMeta.label}</Badge>
          </InfoRow>

          <InfoRow label="Isolation Tier">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-content-tertiary" />
              <div className="text-right">
                <p className="text-sm text-content">{isolationMeta.label}</p>
                <p className="text-xs text-content-tertiary">{isolationMeta.description}</p>
              </div>
            </div>
          </InfoRow>

          <InfoRow label="Created">
            <div className="flex items-center gap-1.5 text-sm text-content-secondary">
              <Calendar className="h-3.5 w-3.5 text-content-tertiary" />
              <span>{fmt(tenant.createdAt)}</span>
              <span className="text-xs text-content-tertiary">
                ({fmtRelative(tenant.createdAt)})
              </span>
            </div>
          </InfoRow>

          <InfoRow label="Last Updated">
            <div className="flex items-center gap-1.5 text-sm text-content-secondary">
              <Clock className="h-3.5 w-3.5 text-content-tertiary" />
              <span>{fmt(tenant.updatedAt)}</span>
              <span className="text-xs text-content-tertiary">
                ({fmtRelative(tenant.updatedAt)})
              </span>
            </div>
          </InfoRow>
        </div>
      </Card>

      {/* ── Plan details card ───────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-accent/15">
            <Wallet className="h-5 w-5 text-brand-accent" />
          </div>
          <div>
            <p className="font-semibold text-content">Plan &amp; Entitlements</p>
            <p className="text-xs text-content-secondary">
              Contact sales to upgrade or modify your plan
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              ['free', 'Free'],
              ['starter', 'Starter'],
              ['professional', 'Professional'],
              ['enterprise', 'Enterprise'],
            ] as const
          ).map(([tier, label]) => {
            const active = tenant.plan === tier;
            return (
              <div
                key={tier}
                className={`rounded-lg border p-3 text-center ${
                  active
                    ? 'border-brand-accent/50 bg-brand-accent/10'
                    : 'border-border bg-surface-secondary'
                }`}
              >
                <p
                  className={`text-sm font-medium ${
                    active ? 'text-brand-accent' : 'text-content-secondary'
                  }`}
                >
                  {label}
                </p>
                {active && <p className="mt-0.5 text-xs text-brand-accent/70">Current plan</p>}
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-xs text-content-tertiary">
          To change your plan, isolation tier, or slug, contact your Synexiun account manager or
          email <span className="font-mono text-content-secondary">support@synexiun.com</span>.
        </p>
      </Card>

      {/* ── Compliance card ─────────────────────────────────── */}
      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/15">
            <Shield className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <p className="font-semibold text-content">Compliance Posture</p>
            <p className="text-xs text-content-secondary">Active certifications for this tenant</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs font-medium text-emerald-400">Compliant</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {['SOC 2 Type II', 'ISO 27001:2022', 'HIPAA', 'GDPR'].map((cert) => (
            <span
              key={cert}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300"
            >
              <CheckCircle2 className="h-3 w-3" />
              {cert}
            </span>
          ))}
        </div>

        <p className="mt-4 text-xs text-content-tertiary">
          Audit logs are WORM-protected with SHA-256 hash chain. Retention: 7 years minimum (HIPAA:
          6yr, financial: 7yr).
        </p>
      </Card>

      {/* ── Modals ─────────────────────────────────────────── */}
      {showEditName && (
        <EditNameModal
          currentName={tenant.name}
          onClose={() => {
            setShowEditName(false);
          }}
          onSave={handleSaveName}
        />
      )}
    </div>
  );
}
