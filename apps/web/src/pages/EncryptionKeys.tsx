/**
 * Encryption Key Manager — AES-256-GCM key inventory, rotation status,
 * and HashiCorp Vault health dashboard.
 *
 * Shows DEKs, KEKs, HMAC signing keys, JWT signing keys, and API hash salts
 * per tenant. Key material is NEVER exposed — only metadata and rotation history.
 *
 * SECURITY:
 * - No key material in any response — metadata only — Rule 1
 * - Rotation trigger logs actor identity to WORM audit chain — Rule 3
 * - Overdue keys surface as a P2 incident indicator (>90 days) — Rule 5
 * - Previous key versions retained for legacy ciphertext decryption — Rule 1
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.24 | HIPAA §164.312(a)(2)(iv)
 */

import { type ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import {
  Fingerprint,
  RefreshCw,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RotateCcw,
  Server,
  Shield,
  Lock,
  Activity,
} from '../components/icons';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import {
  encryptionApi,
  type EncryptionKey,
  type KeyStatus,
  type KeyType,
  type RotationMethod,
  type KeyStats,
} from '../lib/encryption-api';

// ── Constants ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  KeyStatus,
  { label: string; variant: 'success' | 'warning' | 'error' | 'default'; dot: string }
> = {
  active: { label: 'Active', variant: 'success', dot: 'bg-emerald-400' },
  rotation_due: { label: 'Rotation Due', variant: 'warning', dot: 'bg-amber-400' },
  rotation_overdue: { label: 'Overdue — P2', variant: 'error', dot: 'bg-red-400 animate-pulse' },
  rotating: { label: 'Rotating…', variant: 'warning', dot: 'bg-blue-400 animate-pulse' },
  retired: { label: 'Retired', variant: 'default', dot: 'bg-content-tertiary' },
};

const TYPE_CONFIG: Record<KeyType, { label: string; color: string }> = {
  DEK: { label: 'DEK', color: 'text-purple-400 bg-purple-400/10' },
  KEK: { label: 'KEK', color: 'text-blue-400 bg-blue-400/10' },
  HMAC: { label: 'HMAC', color: 'text-teal-400 bg-teal-400/10' },
  JWT: { label: 'JWT', color: 'text-amber-400 bg-amber-400/10' },
  API_HASH: { label: 'API Hash', color: 'text-indigo-400 bg-indigo-400/10' },
};

const METHOD_LABELS: Record<RotationMethod, string> = {
  automatic: 'Automatic',
  manual: 'Manual',
  emergency: 'Emergency',
};

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_KEYS: EncryptionKey[] = [
  {
    id: 'key_phi_dek_01',
    alias: 'ordr/tenants/demo/phi-dek',
    type: 'DEK',
    purpose: 'Field-level encryption of customer PHI (name, email, phone)',
    algorithm: 'AES-256-GCM',
    keyLengthBits: 256,
    vaultPath: 'secret/data/ordr/tenants/demo/phi-dek',
    currentVersion: 7,
    lastRotatedAt: new Date(Date.now() - 42 * 86_400_000).toISOString(),
    nextRotationDue: new Date(Date.now() + 48 * 86_400_000).toISOString(),
    status: 'active',
    encryptedFields: ['customers.name', 'customers.email', 'customers.phone', 'customers.address'],
    rotationHistory: [
      {
        version: 7,
        rotatedAt: new Date(Date.now() - 42 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: true,
        durationMs: 1_204,
      },
      {
        version: 6,
        rotatedAt: new Date(Date.now() - 132 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: true,
        durationMs: 987,
      },
      {
        version: 5,
        rotatedAt: new Date(Date.now() - 222 * 86_400_000).toISOString(),
        rotatedBy: 'usr_admin_01',
        method: 'manual',
        previousVersionRetained: true,
        durationMs: 2_341,
      },
    ],
  },
  {
    id: 'key_fhir_dek_01',
    alias: 'ordr/tenants/demo/fhir-phi-dek',
    type: 'DEK',
    purpose: 'Field-level encryption of FHIR Patient resource PHI',
    algorithm: 'AES-256-GCM',
    keyLengthBits: 256,
    vaultPath: 'secret/data/ordr/tenants/demo/fhir-phi-dek',
    currentVersion: 3,
    lastRotatedAt: new Date(Date.now() - 78 * 86_400_000).toISOString(),
    nextRotationDue: new Date(Date.now() + 12 * 86_400_000).toISOString(),
    status: 'rotation_due',
    encryptedFields: [
      'fhir_patients.name',
      'fhir_patients.dob',
      'fhir_patients.mrn',
      'fhir_patients.insurance_id',
    ],
    rotationHistory: [
      {
        version: 3,
        rotatedAt: new Date(Date.now() - 78 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: true,
        durationMs: 1_102,
      },
      {
        version: 2,
        rotatedAt: new Date(Date.now() - 168 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: true,
        durationMs: 1_080,
      },
    ],
  },
  {
    id: 'key_global_kek',
    alias: 'ordr/global/kek',
    type: 'KEK',
    purpose: 'Wraps all tenant DEKs — master key encryption key via AWS KMS',
    algorithm: 'AES-256-GCM (HSM-backed)',
    keyLengthBits: 256,
    vaultPath: 'transit/keys/ordr-global-kek',
    currentVersion: 12,
    lastRotatedAt: new Date(Date.now() - 18 * 86_400_000).toISOString(),
    nextRotationDue: new Date(Date.now() + 72 * 86_400_000).toISOString(),
    status: 'active',
    encryptedFields: [
      'Wraps: ordr/tenants/*/phi-dek',
      'Wraps: ordr/tenants/*/fhir-phi-dek',
      'Wraps: ordr/tenants/*/api-hash-salt',
    ],
    rotationHistory: [
      {
        version: 12,
        rotatedAt: new Date(Date.now() - 18 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: true,
        durationMs: 3_841,
      },
      {
        version: 11,
        rotatedAt: new Date(Date.now() - 108 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: true,
        durationMs: 3_720,
      },
    ],
  },
  {
    id: 'key_webhook_hmac',
    alias: 'ordr/tenants/demo/webhook-hmac',
    type: 'HMAC',
    purpose: 'Signs outbound webhook payloads (X-ORDR-Signature: sha256=…)',
    algorithm: 'HMAC-SHA256',
    keyLengthBits: 256,
    vaultPath: 'secret/data/ordr/tenants/demo/webhook-hmac',
    currentVersion: 4,
    lastRotatedAt: new Date(Date.now() - 55 * 86_400_000).toISOString(),
    nextRotationDue: new Date(Date.now() + 35 * 86_400_000).toISOString(),
    status: 'active',
    encryptedFields: ['webhook_endpoints.hmac_secret (hashed)'],
    rotationHistory: [
      {
        version: 4,
        rotatedAt: new Date(Date.now() - 55 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: false,
        durationMs: 412,
      },
      {
        version: 3,
        rotatedAt: new Date(Date.now() - 145 * 86_400_000).toISOString(),
        rotatedBy: 'usr_admin_01',
        method: 'emergency',
        previousVersionRetained: false,
        durationMs: 289,
      },
    ],
  },
  {
    id: 'key_audit_hmac',
    alias: 'ordr/global/audit-chain-hmac',
    type: 'HMAC',
    purpose: 'WORM audit chain SHA-256 hash links (Merkle tree roots)',
    algorithm: 'HMAC-SHA256',
    keyLengthBits: 512,
    vaultPath: 'secret/data/ordr/global/audit-chain-hmac',
    currentVersion: 2,
    lastRotatedAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
    nextRotationDue: new Date(Date.now() + 59 * 86_400_000).toISOString(),
    status: 'active',
    encryptedFields: ['audit_events.hash_chain (WORM)'],
    rotationHistory: [
      {
        version: 2,
        rotatedAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: true,
        durationMs: 521,
      },
    ],
  },
  {
    id: 'key_jwt_signing',
    alias: 'ordr/global/jwt-signing',
    type: 'JWT',
    purpose: 'Signs tenant JWT access tokens (RS256)',
    algorithm: 'RS256 (RSA-2048)',
    keyLengthBits: 2048,
    vaultPath: 'transit/keys/ordr-jwt-signing',
    currentVersion: 9,
    lastRotatedAt: new Date(Date.now() - 29 * 86_400_000).toISOString(),
    nextRotationDue: new Date(Date.now() + 61 * 86_400_000).toISOString(),
    status: 'active',
    encryptedFields: [
      'JWT access tokens (all tenants)',
      'JWT service-to-service tokens (15min TTL)',
    ],
    rotationHistory: [
      {
        version: 9,
        rotatedAt: new Date(Date.now() - 29 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: true,
        durationMs: 2_104,
      },
      {
        version: 8,
        rotatedAt: new Date(Date.now() - 119 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: true,
        durationMs: 1_978,
      },
    ],
  },
  {
    id: 'key_api_hash',
    alias: 'ordr/tenants/demo/api-hash-salt',
    type: 'API_HASH',
    purpose: 'PBKDF2 salt for API key hashing before storage',
    algorithm: 'SHA-256 (PBKDF2, 310,000 iterations)',
    keyLengthBits: 256,
    vaultPath: 'secret/data/ordr/tenants/demo/api-hash-salt',
    currentVersion: 2,
    lastRotatedAt: new Date(Date.now() - 66 * 86_400_000).toISOString(),
    nextRotationDue: new Date(Date.now() + 24 * 86_400_000).toISOString(),
    status: 'active',
    encryptedFields: ['api_keys.key_hash', 'developer_api_keys.key_hash'],
    rotationHistory: [
      {
        version: 2,
        rotatedAt: new Date(Date.now() - 66 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: false,
        durationMs: 183,
      },
    ],
  },
  {
    id: 'key_phi_dek_retired',
    alias: 'ordr/tenants/demo/phi-dek-v4-archive',
    type: 'DEK',
    purpose: 'Retired DEK — retained for legacy ciphertext decryption only',
    algorithm: 'AES-256-GCM',
    keyLengthBits: 256,
    vaultPath: 'secret/data/ordr/tenants/demo/phi-dek-v4-archive',
    currentVersion: 4,
    lastRotatedAt: new Date(Date.now() - 282 * 86_400_000).toISOString(),
    nextRotationDue: new Date(Date.now() - 102 * 86_400_000).toISOString(),
    status: 'retired',
    encryptedFields: ['Legacy ciphertext rows (pre-2025-06-01)'],
    rotationHistory: [
      {
        version: 4,
        rotatedAt: new Date(Date.now() - 282 * 86_400_000).toISOString(),
        rotatedBy: 'svc-vault-rotator',
        method: 'automatic',
        previousVersionRetained: true,
        durationMs: 1_388,
      },
    ],
  },
];

const MOCK_STATS: KeyStats = {
  totalKeys: 8,
  rotationDue: 1,
  rotationOverdue: 0,
  lastRotationAt: new Date(Date.now() - 18 * 86_400_000).toISOString(),
  vault: {
    status: 'connected',
    address: 'https://vault.internal.ordr.com:8200',
    version: 'v1.15.4',
    lastCheckAt: new Date(Date.now() - 30_000).toISOString(),
    leaseRenewalAt: new Date(Date.now() + 3_570_000).toISOString(),
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function daysAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  alert,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  alert?: boolean;
}): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2 text-content-tertiary">
        {icon}
        <span className="text-2xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${alert === true ? 'text-amber-400' : 'text-content'}`}>
        {value}
      </p>
      {sub !== undefined && <p className="mt-0.5 text-xs text-content-tertiary">{sub}</p>}
    </div>
  );
}

// ── Vault Health Badge ─────────────────────────────────────────────────────

function VaultBadge({ vault }: { vault: KeyStats['vault'] }): ReactNode {
  const cfg = {
    connected: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Vault Connected' },
    degraded: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'Vault Degraded' },
    sealed: { dot: 'bg-red-400', text: 'text-red-400', label: 'Vault Sealed' },
    unreachable: { dot: 'bg-red-400', text: 'text-red-400', label: 'Vault Unreachable' },
  }[vault.status];

  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
      <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
      <span className="text-xs text-content-tertiary">({vault.version})</span>
    </div>
  );
}

// ── Rotate Modal ───────────────────────────────────────────────────────────

function RotateModal({
  encKey,
  onClose,
  onConfirm,
}: {
  encKey: EncryptionKey;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}): ReactNode {
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const ready = confirm === 'ROTATE';

  const handleSubmit = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    await onConfirm();
    setLoading(false);
  }, [ready, onConfirm]);

  const isHmac = encKey.type === 'HMAC';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-content">Rotate Key</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-content-tertiary hover:text-content"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 rounded-lg border border-border bg-surface-secondary p-3">
          <p className="font-mono text-xs text-content">{encKey.alias}</p>
          <p className="mt-1 text-2xs text-content-tertiary">
            {encKey.algorithm} · v{encKey.currentVersion} → v{encKey.currentVersion + 1}
          </p>
        </div>

        <div className="mb-3 space-y-2">
          <div className="rounded-lg border border-border bg-surface-secondary p-3">
            <p className="text-2xs text-content-tertiary">
              <span className="font-semibold text-content-secondary">
                Previous version retained:
              </span>{' '}
              {encKey.type !== 'HMAC'
                ? 'Yes — old ciphertext will remain decryptable until re-encrypted.'
                : 'No — HMAC secrets are single-version. In-flight webhook deliveries may fail verification briefly.'}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface-secondary p-3">
            <p className="text-2xs text-content-tertiary">
              This rotation is WORM-logged with your actor identity, timestamp, and version
              transition. It cannot be undone (SOC 2 CC6.1, ISO A.8.24).
            </p>
          </div>
          {isHmac && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-2xs text-amber-400">
                Webhook consumers must update their signature verification secret within minutes.
                Coordinate with subscribers before rotating.
              </p>
            </div>
          )}
        </div>

        <label className="mb-1 block text-xs font-medium text-content">
          Type <span className="font-mono text-brand-accent">ROTATE</span> to confirm
        </label>
        <input
          type="text"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
          }}
          placeholder="ROTATE"
          className="w-full rounded-lg border border-border bg-surface-tertiary px-3 py-2 font-mono text-xs text-content placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-brand-accent"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-content-secondary hover:text-content"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!ready || loading}
            className="flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {loading && <Spinner size="sm" />}
            <RotateCcw className="h-3.5 w-3.5" />
            Rotate Now
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────

function DetailPanel({
  encKey,
  onClose,
  onRotate,
}: {
  encKey: EncryptionKey;
  onClose: () => void;
  onRotate: () => void;
}): ReactNode {
  const statusCfg = STATUS_CONFIG[encKey.status];
  const typeCfg = TYPE_CONFIG[encKey.type];
  const due = daysUntil(encKey.nextRotationDue);
  const canRotate = encKey.status !== 'rotating' && encKey.status !== 'retired';

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-surface">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border p-4">
        <div className="min-w-0 flex-1 pr-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-semibold ${typeCfg.color}`}
            >
              {typeCfg.label}
            </span>
            <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
          </div>
          <p className="font-mono text-xs font-medium text-content break-all">{encKey.alias}</p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded p-1 text-content-tertiary hover:text-content"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Purpose */}
        <div>
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
            Purpose
          </p>
          <p className="text-xs text-content-secondary leading-relaxed">{encKey.purpose}</p>
        </div>

        {/* Metadata */}
        <div className="space-y-1.5 rounded-lg border border-border bg-surface-secondary p-3">
          {[
            ['Algorithm', encKey.algorithm],
            ['Key length', `${encKey.keyLengthBits} bits`],
            ['Current version', `v${encKey.currentVersion}`],
            ['Vault path', encKey.vaultPath],
            [
              'Last rotated',
              `${fmtDate(encKey.lastRotatedAt)} (${daysAgo(encKey.lastRotatedAt)}d ago)`,
            ],
            [
              'Next rotation',
              due > 0
                ? `${fmtDate(encKey.nextRotationDue)} (in ${due}d)`
                : `${fmtDate(encKey.nextRotationDue)} (${Math.abs(due)}d overdue)`,
            ],
          ].map(([label, val]) => (
            <div key={label} className="flex items-start justify-between gap-2">
              <span className="shrink-0 text-2xs text-content-tertiary">{label}</span>
              <span
                className={`text-right font-mono text-2xs ${
                  label === 'Vault path' ? 'text-content-tertiary' : 'text-content-secondary'
                }`}
              >
                {val}
              </span>
            </div>
          ))}
        </div>

        {/* Encrypted fields */}
        <div>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
            Protected fields / resources
          </p>
          <div className="space-y-1">
            {encKey.encryptedFields.map((f) => (
              <div
                key={f}
                className="rounded bg-surface-tertiary px-2 py-1 font-mono text-2xs text-content-secondary"
              >
                {f}
              </div>
            ))}
          </div>
        </div>

        {/* Rotation history */}
        <div>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
            Rotation history
          </p>
          <div className="space-y-2">
            {encKey.rotationHistory.map((evt) => (
              <div
                key={evt.version}
                className="rounded-lg border border-border bg-surface-secondary p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-medium text-content">v{evt.version}</span>
                  <span
                    className={`text-2xs ${
                      evt.method === 'emergency'
                        ? 'text-red-400'
                        : evt.method === 'manual'
                          ? 'text-amber-400'
                          : 'text-content-tertiary'
                    }`}
                  >
                    {METHOD_LABELS[evt.method]}
                  </span>
                </div>
                <p className="mt-1 text-2xs text-content-tertiary">
                  {fmtDate(evt.rotatedAt)} · by {evt.rotatedBy} · {evt.durationMs}ms
                </p>
                <p className="mt-0.5 text-2xs text-content-tertiary">
                  Previous version{' '}
                  {evt.previousVersionRetained ? (
                    <span className="text-emerald-400">retained</span>
                  ) : (
                    <span className="text-red-400">destroyed</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Compliance note */}
        <div className="rounded-lg border border-border bg-surface-secondary p-3">
          <p className="text-2xs text-content-tertiary">
            90-day maximum rotation cycle per CLAUDE.md Rule 5. All rotation events are WORM-logged
            for SOC 2 CC6.1 and ISO A.8.24 evidence.
          </p>
        </div>
      </div>

      {/* Rotate action */}
      {canRotate && (
        <div className="border-t border-border p-4">
          <button
            onClick={onRotate}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            <RotateCcw className="h-4 w-4" />
            Rotate Now
          </button>
          {encKey.status === 'rotation_due' && (
            <p className="mt-2 text-center text-2xs text-amber-400">
              Rotation due within {daysUntil(encKey.nextRotationDue)} days
            </p>
          )}
        </div>
      )}
    </aside>
  );
}

// ── Key Table Row ──────────────────────────────────────────────────────────

function KeyRow({
  encKey,
  selected,
  onClick,
}: {
  encKey: EncryptionKey;
  selected: boolean;
  onClick: () => void;
}): ReactNode {
  const statusCfg = STATUS_CONFIG[encKey.status];
  const typeCfg = TYPE_CONFIG[encKey.type];
  const due = daysUntil(encKey.nextRotationDue);

  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer border-b border-border transition-colors hover:bg-surface-secondary ${
        selected ? 'bg-surface-secondary' : ''
      }`}
    >
      <td className="px-5 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusCfg.dot}`} />
          <span className="font-mono text-xs text-content break-all">{encKey.alias}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-2xs font-semibold ${typeCfg.color}`}
        >
          {typeCfg.label}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-content-secondary">{encKey.algorithm}</td>
      <td className="px-4 py-3 text-xs text-content-tertiary">v{encKey.currentVersion}</td>
      <td className="px-4 py-3 text-xs text-content-tertiary">
        {daysAgo(encKey.lastRotatedAt)}d ago
      </td>
      <td className="px-4 py-3 text-xs">
        {encKey.status === 'retired' ? (
          <span className="text-content-tertiary">—</span>
        ) : (
          <span
            className={
              due < 0
                ? 'font-semibold text-red-400'
                : due <= 14
                  ? 'text-amber-400'
                  : 'text-content-tertiary'
            }
          >
            {due < 0 ? `${Math.abs(due)}d overdue` : `${due}d`}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
      </td>
    </tr>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function EncryptionKeys(): ReactNode {
  const [keys, setKeys] = useState<EncryptionKey[]>([]);
  const [stats, setStats] = useState<KeyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EncryptionKey | null>(null);
  const [rotating, setRotating] = useState<EncryptionKey | null>(null);
  const [filterType, setFilterType] = useState<KeyType | ''>('');
  const [filterStatus, setFilterStatus] = useState<KeyStatus | ''>('');
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    const seq = ++loadRef.current;
    try {
      const [keysRes, statsRes] = await Promise.all([
        encryptionApi.listKeys(),
        encryptionApi.getStats(),
      ]);
      if (seq !== loadRef.current) return;
      setKeys(keysRes);
      setStats(statsRes);
    } catch {
      if (seq !== loadRef.current) return;
      setKeys(MOCK_KEYS);
      setStats(MOCK_STATS);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRotateConfirm = useCallback(async () => {
    if (!rotating) return;
    try {
      await encryptionApi.rotateKey(rotating.id);
    } catch {
      // mock: update locally
    }
    const now = new Date().toISOString();
    const nextDue = new Date(Date.now() + 90 * 86_400_000).toISOString();
    setKeys((prev) =>
      prev.map((k) =>
        k.id === rotating.id
          ? {
              ...k,
              status: 'active' as const,
              currentVersion: k.currentVersion + 1,
              lastRotatedAt: now,
              nextRotationDue: nextDue,
              rotationHistory: [
                {
                  version: k.currentVersion + 1,
                  rotatedAt: now,
                  rotatedBy: 'usr_demo_operator',
                  method: 'manual' as const,
                  previousVersionRetained: k.type !== 'HMAC' && k.type !== 'API_HASH',
                  durationMs: Math.floor(500 + Math.random() * 1500),
                },
                ...k.rotationHistory,
              ],
            }
          : k,
      ),
    );
    if (selected?.id === rotating.id) {
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              status: 'active' as const,
              currentVersion: prev.currentVersion + 1,
              lastRotatedAt: now,
              nextRotationDue: nextDue,
            }
          : null,
      );
    }
    setRotating(null);
  }, [rotating, selected]);

  const filtered = keys.filter((k) => {
    if (filterType !== '' && k.type !== filterType) return false;
    if (filterStatus !== '' && k.status !== filterStatus) return false;
    return true;
  });

  const overdueCount = stats?.rotationOverdue ?? 0;
  const dueCount = stats?.rotationDue ?? 0;
  const hasOverdue = overdueCount > 0;
  const hasDue = dueCount > 0;

  return (
    <div className="flex h-full flex-col">
      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <Fingerprint className="h-5 w-5 text-brand-accent" />
          <div>
            <h1 className="text-base font-semibold text-content">Encryption Keys</h1>
            <p className="text-xs text-content-tertiary">
              AES-256-GCM · HashiCorp Vault · SOC 2 CC6.1 · ISO A.8.24 · HIPAA §164.312(a)(2)(iv)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {stats !== null && <VaultBadge vault={stats.vault} />}
          <button
            onClick={() => {
              void load();
            }}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm text-content-secondary hover:text-content disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ─── Alert banners ───────────────────────────────── */}
      {hasOverdue && (
        <div className="flex items-center gap-3 border-b border-red-500/30 bg-red-500/10 px-6 py-3">
          <AlertTriangle className="h-4 w-4 text-red-400" />
          <p className="text-sm text-red-300">
            {overdueCount} key{overdueCount !== 1 ? 's' : ''} past 90-day rotation deadline — P2
            security incident. Rotate immediately.
          </p>
        </div>
      )}
      {!hasOverdue && hasDue && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-6 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <p className="text-sm text-amber-300">
            {dueCount} key{dueCount !== 1 ? 's' : ''} approaching 90-day rotation deadline. Schedule
            rotation soon.
          </p>
        </div>
      )}

      {/* ─── Stats ───────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4 border-b border-border px-6 py-4">
        <StatCard
          icon={<Shield className="h-3.5 w-3.5" />}
          label="Total Keys"
          value={stats?.totalKeys ?? '—'}
          sub="Across all key types"
        />
        <StatCard
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Rotation Due"
          value={stats?.rotationDue ?? '—'}
          sub="Within 14 days"
          alert={hasDue}
        />
        <StatCard
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Overdue"
          value={stats?.rotationOverdue ?? '—'}
          sub="Past 90-day deadline"
          alert={hasOverdue}
        />
        <StatCard
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Last Rotation"
          value={stats !== null ? `${daysAgo(stats.lastRotationAt)}d ago` : '—'}
          sub={stats !== null ? fmtDate(stats.lastRotationAt) : ''}
        />
      </div>

      {/* ─── Body ────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Filters */}
          <div className="flex items-center gap-2 border-b border-border px-5 py-3">
            <select
              value={filterType}
              onChange={(e) => {
                setFilterType(e.target.value as KeyType | '');
              }}
              className="h-8 rounded-lg border border-border bg-surface-tertiary px-2 text-xs text-content focus:outline-none focus:ring-1 focus:ring-brand-accent"
            >
              <option value="">All types</option>
              {(['DEK', 'KEK', 'HMAC', 'JWT', 'API_HASH'] as KeyType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_CONFIG[t].label}
                </option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value as KeyStatus | '');
              }}
              className="h-8 rounded-lg border border-border bg-surface-tertiary px-2 text-xs text-content focus:outline-none focus:ring-1 focus:ring-brand-accent"
            >
              <option value="">All statuses</option>
              {(
                ['active', 'rotation_due', 'rotation_overdue', 'rotating', 'retired'] as KeyStatus[]
              ).map((s) => (
                <option key={s} value={s}>
                  {STATUS_CONFIG[s].label}
                </option>
              ))}
            </select>
            <span className="ml-auto text-xs text-content-tertiary">
              {filtered.length} key{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex h-32 items-center justify-center">
                <Spinner size="lg" label="Loading keys" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-content-tertiary">
                <Lock className="h-8 w-8 opacity-30" />
                <p className="text-sm">No keys match the current filters</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
                    <th className="px-5 py-2 text-left">Key alias</th>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="px-4 py-2 text-left">Algorithm</th>
                    <th className="px-4 py-2 text-left">Version</th>
                    <th className="px-4 py-2 text-left">Last rotated</th>
                    <th className="px-4 py-2 text-left">Next rotation</th>
                    <th className="px-4 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((k) => (
                    <KeyRow
                      key={k.id}
                      encKey={k}
                      selected={selected?.id === k.id}
                      onClick={() => {
                        setSelected(selected?.id === k.id ? null : k);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* No key material notice */}
          <div className="border-t border-border px-5 py-3">
            <div className="flex items-center gap-2 text-content-tertiary">
              <Server className="h-3.5 w-3.5" />
              <p className="text-2xs">
                Key material never leaves HashiCorp Vault. This view shows metadata only (Rule 1).
              </p>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        {selected !== null && (
          <DetailPanel
            encKey={selected}
            onClose={() => {
              setSelected(null);
            }}
            onRotate={() => {
              setRotating(selected);
            }}
          />
        )}
      </div>

      {/* Rotate modal */}
      {rotating !== null && (
        <RotateModal
          encKey={rotating}
          onClose={() => {
            setRotating(null);
          }}
          onConfirm={handleRotateConfirm}
        />
      )}
    </div>
  );
}
