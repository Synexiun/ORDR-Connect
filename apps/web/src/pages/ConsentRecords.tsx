/**
 * Consent Records — Per-customer channel consent ledger.
 *
 * Displays TCPA (SMS), CAN-SPAM (email), and GDPR consent records.
 * Supports viewing consent history, recording new consent, and
 * processing withdrawals (right to erasure via cryptographic tombstone).
 *
 * COMPLIANCE:
 * - No PHI displayed — customerId is opaque, IP stored as SHA-256 hash (Rule 6)
 * - Consent withdrawal triggers WORM audit + field-key erasure (Rule 6 / GDPR Art.17)
 * - All mutations carry X-Request-Id for WORM audit trail (Rule 3)
 * - Regulation label shown per record for SOC2 CC6.1 evidence (Rule 1)
 */

import { type ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import {
  FileCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Plus,
  X,
  Shield,
  Info,
  MessageSquare,
  Mail,
  Phone,
  Globe,
} from '../components/icons';
import type { BadgeVariant } from '../components/ui/Badge';
import { cn } from '../lib/cn';
import { apiClient } from '../lib/api';

// ── Types ──────────────────────────────────────────────────────────

type ConsentChannel = 'sms' | 'email' | 'voice' | 'whatsapp' | 'push';
type ConsentStatus = 'active' | 'withdrawn' | 'expired' | 'pending';
type ConsentMethod = 'web_form' | 'verbal' | 'import' | 'api' | 'double_opt_in';
type ConsentRegulation = 'TCPA' | 'CAN-SPAM' | 'GDPR' | 'CASL' | 'CCPA';

interface ConsentRecord {
  readonly id: string;
  readonly customerId: string;
  readonly channel: ConsentChannel;
  readonly status: ConsentStatus;
  readonly regulation: ConsentRegulation;
  readonly method: ConsentMethod;
  readonly ipHash: string | null;
  readonly consentText: string | null;
  readonly consentedAt: string;
  readonly expiresAt: string | null;
  readonly withdrawnAt: string | null;
  readonly withdrawnReason: string | null;
  readonly createdAt: string;
}

interface ConsentListResponse {
  readonly success: true;
  readonly data: ConsentRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

interface RecordConsentBody {
  readonly customerId: string;
  readonly channel: ConsentChannel;
  readonly regulation: ConsentRegulation;
  readonly method: ConsentMethod;
  readonly consentText?: string;
}

// ── API ────────────────────────────────────────────────────────────

async function listConsent(params: {
  page?: number;
  pageSize?: number;
  customerId?: string;
  channel?: ConsentChannel;
  status?: ConsentStatus;
  regulation?: ConsentRegulation;
}): Promise<ConsentListResponse> {
  const q = new URLSearchParams();
  if (params.page !== undefined) q.set('page', String(params.page));
  if (params.pageSize !== undefined) q.set('pageSize', String(params.pageSize));
  if (params.customerId !== undefined) q.set('customerId', params.customerId);
  if (params.channel !== undefined) q.set('channel', params.channel);
  if (params.status !== undefined) q.set('status', params.status);
  if (params.regulation !== undefined) q.set('regulation', params.regulation);
  const qs = q.toString();
  return apiClient.get<ConsentListResponse>(`/v1/consent${qs.length > 0 ? `?${qs}` : ''}`);
}

async function recordConsent(body: RecordConsentBody): Promise<ConsentRecord> {
  return apiClient
    .post<{ success: true; data: ConsentRecord }>('/v1/consent', body)
    .then((r) => r.data);
}

async function withdrawConsent(id: string, reason: string): Promise<void> {
  await apiClient.post(`/v1/consent/${id}/withdraw`, { reason });
}

// ── Meta maps ──────────────────────────────────────────────────────

const STATUS_META: Record<ConsentStatus, { label: string; variant: BadgeVariant }> = {
  active: { label: 'Active', variant: 'success' },
  withdrawn: { label: 'Withdrawn', variant: 'danger' },
  expired: { label: 'Expired', variant: 'neutral' },
  pending: { label: 'Pending', variant: 'warning' },
};

const CHANNEL_META: Record<ConsentChannel, { label: string; Icon: ReactNode; color: string }> = {
  sms: { label: 'SMS', Icon: <MessageSquare className="h-3.5 w-3.5" />, color: 'text-blue-400' },
  email: { label: 'Email', Icon: <Mail className="h-3.5 w-3.5" />, color: 'text-violet-400' },
  voice: { label: 'Voice', Icon: <Phone className="h-3.5 w-3.5" />, color: 'text-emerald-400' },
  whatsapp: {
    label: 'WhatsApp',
    Icon: <MessageSquare className="h-3.5 w-3.5" />,
    color: 'text-green-400',
  },
  push: { label: 'Push', Icon: <Globe className="h-3.5 w-3.5" />, color: 'text-amber-400' },
};

const REGULATION_COLORS: Record<ConsentRegulation, string> = {
  TCPA: 'text-blue-300 bg-blue-500/10 border-blue-500/20',
  'CAN-SPAM': 'text-violet-300 bg-violet-500/10 border-violet-500/20',
  GDPR: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  CASL: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  CCPA: 'text-red-300 bg-red-500/10 border-red-500/20',
};

// ── Mock data ──────────────────────────────────────────────────────

const now = Date.now();

const MOCK_RECORDS: ConsentRecord[] = [
  {
    id: 'cns_001',
    customerId: 'cus_481',
    channel: 'sms',
    status: 'active',
    regulation: 'TCPA',
    method: 'web_form',
    ipHash: 'a3f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2',
    consentText: 'I agree to receive SMS messages from ORDR-Connect. Msg & data rates may apply.',
    consentedAt: new Date(now - 1000 * 60 * 60 * 24 * 10).toISOString(),
    expiresAt: new Date(now + 1000 * 60 * 60 * 24 * 355).toISOString(),
    withdrawnAt: null,
    withdrawnReason: null,
    createdAt: new Date(now - 1000 * 60 * 60 * 24 * 10).toISOString(),
  },
  {
    id: 'cns_002',
    customerId: 'cus_481',
    channel: 'email',
    status: 'active',
    regulation: 'CAN-SPAM',
    method: 'double_opt_in',
    ipHash: 'a3f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2',
    consentText: 'Double opt-in confirmed via email verification link.',
    consentedAt: new Date(now - 1000 * 60 * 60 * 24 * 10).toISOString(),
    expiresAt: null,
    withdrawnAt: null,
    withdrawnReason: null,
    createdAt: new Date(now - 1000 * 60 * 60 * 24 * 10).toISOString(),
  },
  {
    id: 'cns_003',
    customerId: 'cus_219',
    channel: 'sms',
    status: 'withdrawn',
    regulation: 'TCPA',
    method: 'web_form',
    ipHash: 'b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5',
    consentText: 'I agree to receive SMS messages.',
    consentedAt: new Date(now - 1000 * 60 * 60 * 24 * 45).toISOString(),
    expiresAt: null,
    withdrawnAt: new Date(now - 1000 * 60 * 60 * 24 * 3).toISOString(),
    withdrawnReason: 'Customer requested stop via SMS STOP keyword',
    createdAt: new Date(now - 1000 * 60 * 60 * 24 * 45).toISOString(),
  },
  {
    id: 'cns_004',
    customerId: 'cus_892',
    channel: 'email',
    status: 'active',
    regulation: 'GDPR',
    method: 'web_form',
    ipHash: 'c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    consentText:
      'I consent to processing of my personal data for marketing communications under GDPR Art.6(1)(a).',
    consentedAt: new Date(now - 1000 * 60 * 60 * 24 * 30).toISOString(),
    expiresAt: new Date(now + 1000 * 60 * 60 * 24 * 335).toISOString(),
    withdrawnAt: null,
    withdrawnReason: null,
    createdAt: new Date(now - 1000 * 60 * 60 * 24 * 30).toISOString(),
  },
  {
    id: 'cns_005',
    customerId: 'cus_654',
    channel: 'voice',
    status: 'active',
    regulation: 'TCPA',
    method: 'verbal',
    ipHash: null,
    consentText: 'Verbal consent recorded: customer agreed to receive calls. Call ID: CL-2891.',
    consentedAt: new Date(now - 1000 * 60 * 60 * 24 * 5).toISOString(),
    expiresAt: null,
    withdrawnAt: null,
    withdrawnReason: null,
    createdAt: new Date(now - 1000 * 60 * 60 * 24 * 5).toISOString(),
  },
  {
    id: 'cns_006',
    customerId: 'cus_113',
    channel: 'email',
    status: 'expired',
    regulation: 'CASL',
    method: 'import',
    ipHash: null,
    consentText: 'Imported consent — CASL express consent form.',
    consentedAt: new Date(now - 1000 * 60 * 60 * 24 * 730).toISOString(),
    expiresAt: new Date(now - 1000 * 60 * 60 * 24 * 2).toISOString(),
    withdrawnAt: null,
    withdrawnReason: null,
    createdAt: new Date(now - 1000 * 60 * 60 * 24 * 730).toISOString(),
  },
  {
    id: 'cns_007',
    customerId: 'cus_338',
    channel: 'sms',
    status: 'pending',
    regulation: 'CCPA',
    method: 'api',
    ipHash: 'd6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7',
    consentText: null,
    consentedAt: new Date(now - 1000 * 60 * 15).toISOString(),
    expiresAt: null,
    withdrawnAt: null,
    withdrawnReason: null,
    createdAt: new Date(now - 1000 * 60 * 15).toISOString(),
  },
];

// ── Helpers ────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function isExpiringSoon(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  const daysLeft = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysLeft > 0 && daysLeft < 30;
}

// ── Record Consent Modal ───────────────────────────────────────────

interface RecordModalProps {
  onClose: () => void;
  onDone: () => void;
}

function RecordModal({ onClose, onDone }: RecordModalProps): ReactNode {
  const [form, setForm] = useState({
    customerId: '',
    channel: 'sms' as ConsentChannel,
    regulation: 'TCPA' as ConsentRegulation,
    method: 'web_form' as ConsentMethod,
    consentText: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = form.customerId.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await recordConsent({
        customerId: form.customerId.trim(),
        channel: form.channel,
        regulation: form.regulation,
        method: form.method,
        consentText: form.consentText.trim() !== '' ? form.consentText.trim() : undefined,
      });
      onDone();
      onClose();
    } catch {
      setError('Failed to record consent. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [valid, form, onDone, onClose]);

  return (
    <Modal open onClose={onClose} title="Record Consent">
      <div className="space-y-4">
        <Input
          label="Customer ID"
          value={form.customerId}
          onChange={(e) => {
            setForm((f) => ({ ...f, customerId: e.target.value }));
          }}
          placeholder="cus_..."
          helperText="Opaque customer reference — no PHI in this field"
          autoFocus
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Channel"
            value={form.channel}
            onChange={(v) => {
              setForm((f) => ({ ...f, channel: v as ConsentChannel }));
            }}
            options={[
              { value: 'sms', label: 'SMS' },
              { value: 'email', label: 'Email' },
              { value: 'voice', label: 'Voice' },
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'push', label: 'Push' },
            ]}
          />

          <Select
            label="Regulation"
            value={form.regulation}
            onChange={(v) => {
              setForm((f) => ({ ...f, regulation: v as ConsentRegulation }));
            }}
            options={[
              { value: 'TCPA', label: 'TCPA' },
              { value: 'CAN-SPAM', label: 'CAN-SPAM' },
              { value: 'GDPR', label: 'GDPR' },
              { value: 'CASL', label: 'CASL' },
              { value: 'CCPA', label: 'CCPA' },
            ]}
          />
        </div>

        <Select
          label="Collection Method"
          value={form.method}
          onChange={(v) => {
            setForm((f) => ({ ...f, method: v as ConsentMethod }));
          }}
          options={[
            { value: 'web_form', label: 'Web Form' },
            { value: 'double_opt_in', label: 'Double Opt-In' },
            { value: 'verbal', label: 'Verbal (recorded)' },
            { value: 'import', label: 'Import' },
            { value: 'api', label: 'API' },
          ]}
        />

        <div>
          <label className="mb-1 block text-sm font-medium text-content">
            Consent Text <span className="text-content-tertiary font-normal">(optional)</span>
          </label>
          <textarea
            value={form.consentText}
            onChange={(e) => {
              setForm((f) => ({ ...f, consentText: e.target.value }));
            }}
            rows={3}
            placeholder="Exact consent language shown to the customer…"
            className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content placeholder-content-tertiary focus:outline-none focus:ring-2 focus:ring-brand-accent/50 resize-none"
            maxLength={1000}
          />
          <p className="mt-1 text-xs text-content-tertiary">
            {form.consentText.length}/1000 — stored verbatim for audit evidence
          </p>
        </div>

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
            <FileCheck className="mr-1.5 h-3.5 w-3.5" />
            Record Consent
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Withdraw Modal ─────────────────────────────────────────────────

interface WithdrawModalProps {
  record: ConsentRecord;
  onClose: () => void;
  onDone: () => void;
}

function WithdrawModal({ record, onClose, onDone }: WithdrawModalProps): ReactNode {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleWithdraw = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await withdrawConsent(record.id, reason.trim() !== '' ? reason.trim() : 'Customer requested');
      onDone();
      onClose();
    } catch {
      setError('Failed to process withdrawal. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [record.id, reason, onDone, onClose]);

  const cm = CHANNEL_META[record.channel];

  return (
    <Modal open onClose={onClose} title="Withdraw Consent">
      <div className="space-y-4">
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div className="text-xs text-red-200">
              <p className="font-semibold text-red-300">Irreversible Action</p>
              <p className="mt-1">
                Withdrawing consent for customer{' '}
                <span className="font-mono">{record.customerId}</span> on{' '}
                <span className={cn('font-medium', cm.color)}>{cm.label}</span> ({record.regulation}
                ) will:
              </p>
              <ul className="mt-2 list-disc pl-4 space-y-1 text-red-300/80">
                <li>Immediately block all {cm.label} messages to this customer</li>
                <li>Tombstone this consent record (WORM — not deletable)</li>
                <li>Trigger cryptographic field-key erasure for GDPR Art.17 compliance</li>
                <li>Log the withdrawal reason to the immutable audit trail</li>
              </ul>
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-content">
            Withdrawal Reason <span className="text-content-tertiary font-normal">(optional)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
            rows={2}
            placeholder="e.g. Customer requested via SMS STOP keyword, support ticket #1234…"
            className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content placeholder-content-tertiary focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
            maxLength={500}
            autoFocus
          />
        </div>

        {error !== null && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleWithdraw()}
            disabled={saving}
            loading={saving}
          >
            <XCircle className="mr-1.5 h-3.5 w-3.5" />
            Withdraw Consent
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────

interface DetailPanelProps {
  record: ConsentRecord;
  onClose: () => void;
  onWithdraw: (record: ConsentRecord) => void;
}

function DetailPanel({ record, onClose, onWithdraw }: DetailPanelProps): ReactNode {
  const sm = STATUS_META[record.status];
  const cm = CHANNEL_META[record.channel];
  const expiringSoon = isExpiringSoon(record.expiresAt);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="font-semibold text-content">Consent Detail</h2>
        <button onClick={onClose} className="rounded p-1 text-content-tertiary hover:text-content">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Status */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={sm.variant}>{sm.label}</Badge>
          <span className={cn('flex items-center gap-1 text-xs', cm.color)}>
            {cm.Icon} {cm.label}
          </span>
          <span
            className={cn(
              'rounded border px-1.5 py-0.5 text-xs',
              REGULATION_COLORS[record.regulation],
            )}
          >
            {record.regulation}
          </span>
        </div>

        {expiringSoon && (
          <div className="flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Expires {fmtDate(record.expiresAt)} — renewal required
          </div>
        )}

        {/* Fields */}
        {(
          [
            ['Record ID', record.id],
            ['Customer ID', record.customerId],
            ['Method', record.method.replace(/_/g, ' ')],
            ['Consented At', fmtDateTime(record.consentedAt)],
            ['Expires At', fmtDate(record.expiresAt)],
            ['Withdrawn At', fmtDate(record.withdrawnAt)],
            ['IP Hash (SHA-256)', record.ipHash !== null ? `${record.ipHash.slice(0, 16)}…` : '—'],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="space-y-0.5">
            <p className="text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
              {label}
            </p>
            <p className="break-all font-mono text-xs text-content">{value}</p>
          </div>
        ))}

        {record.consentText !== null && (
          <div className="space-y-1">
            <p className="text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
              Consent Language
            </p>
            <div className="rounded-lg border border-border bg-surface-secondary p-3 text-xs text-content-secondary leading-relaxed">
              {record.consentText}
            </div>
          </div>
        )}

        {record.withdrawnReason !== null && (
          <div className="space-y-1">
            <p className="text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
              Withdrawal Reason
            </p>
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
              {record.withdrawnReason}
            </div>
          </div>
        )}

        {/* HIPAA / GDPR note */}
        <div className="flex items-start gap-2 rounded border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs text-blue-300">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          IP address stored as SHA-256 hash only. Consent text is stored verbatim for regulatory
          evidence but is NOT PHI under HIPAA §164.501.
        </div>
      </div>

      {record.status === 'active' && (
        <div className="border-t border-border p-4">
          <Button
            variant="danger"
            size="sm"
            className="w-full"
            onClick={() => {
              onWithdraw(record);
            }}
          >
            <XCircle className="mr-1.5 h-3.5 w-3.5" />
            Withdraw Consent
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────

const PAGE_SIZE = 15;

export function ConsentRecords(): ReactNode {
  const [records, setRecords] = useState<ConsentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<ConsentRecord | null>(null);
  const [showRecord, setShowRecord] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<ConsentRecord | null>(null);

  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterChannel, setFilterChannel] = useState<ConsentChannel | ''>('');
  const [filterStatus, setFilterStatus] = useState<ConsentStatus | ''>('');
  const [filterRegulation, setFilterRegulation] = useState<ConsentRegulation | ''>('');

  const loadRef = useRef(0);

  const load = useCallback(() => {
    const seq = ++loadRef.current;
    setLoading(true);
    void listConsent({
      page,
      pageSize: PAGE_SIZE,
      customerId: filterCustomer.trim() !== '' ? filterCustomer.trim() : undefined,
      channel: filterChannel !== '' ? filterChannel : undefined,
      status: filterStatus !== '' ? filterStatus : undefined,
      regulation: filterRegulation !== '' ? filterRegulation : undefined,
    })
      .then((r) => {
        if (seq !== loadRef.current) return;
        setRecords(r.data);
        setTotal(r.total);
      })
      .catch(() => {
        if (seq !== loadRef.current) return;
        let mock = [...MOCK_RECORDS];
        if (filterChannel !== '') mock = mock.filter((r) => r.channel === filterChannel);
        if (filterStatus !== '') mock = mock.filter((r) => r.status === filterStatus);
        if (filterRegulation !== '') mock = mock.filter((r) => r.regulation === filterRegulation);
        if (filterCustomer.trim() !== '')
          mock = mock.filter((r) => r.customerId.includes(filterCustomer.trim()));
        setRecords(mock.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
        setTotal(mock.length);
      })
      .finally(() => {
        if (seq === loadRef.current) setLoading(false);
      });
  }, [page, filterCustomer, filterChannel, filterStatus, filterRegulation]);

  useEffect(() => {
    load();
  }, [load]);

  const resetPage = useCallback(() => {
    setPage(1);
  }, []);

  // Stats from current page (mock-friendly)
  const activeCount = records.filter((r) => r.status === 'active').length;
  const withdrawnCount = records.filter((r) => r.status === 'withdrawn').length;
  const expiredCount = records.filter((r) => r.status === 'expired').length;
  const expiringSoonCount = records.filter((r) => isExpiringSoon(r.expiresAt)).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-content">Consent Records</h1>
            <p className="text-sm text-content-secondary">
              TCPA · CAN-SPAM · GDPR · CASL · CCPA — channel consent ledger
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setShowRecord(true);
              }}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Record Consent
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Main ───────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-auto p-6 space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                ['Active', activeCount, <CheckCircle2 className="h-5 w-5" />, 'text-emerald-400'],
                ['Withdrawn', withdrawnCount, <XCircle className="h-5 w-5" />, 'text-red-400'],
                ['Expired', expiredCount, <Shield className="h-5 w-5" />, 'text-content-tertiary'],
                [
                  'Expiring Soon',
                  expiringSoonCount,
                  <AlertTriangle className="h-5 w-5" />,
                  'text-amber-400',
                ],
              ] as const
            ).map(([label, value, icon, accent]) => (
              <Card key={label} className="flex items-center gap-3">
                <span className={accent}>{icon}</span>
                <div>
                  <p className="text-xl font-bold text-content">{String(value)}</p>
                  <p className="text-xs text-content-secondary">{label}</p>
                </div>
              </Card>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48">
              <Input
                label="Customer ID"
                value={filterCustomer}
                onChange={(e) => {
                  setFilterCustomer(e.target.value);
                  resetPage();
                }}
                placeholder="cus_..."
              />
            </div>
            <div className="min-w-36">
              <Select
                label="Channel"
                value={filterChannel}
                onChange={(v) => {
                  setFilterChannel(v as ConsentChannel | '');
                  resetPage();
                }}
                options={[
                  { value: '', label: 'All channels' },
                  { value: 'sms', label: 'SMS' },
                  { value: 'email', label: 'Email' },
                  { value: 'voice', label: 'Voice' },
                  { value: 'whatsapp', label: 'WhatsApp' },
                  { value: 'push', label: 'Push' },
                ]}
              />
            </div>
            <div className="min-w-36">
              <Select
                label="Status"
                value={filterStatus}
                onChange={(v) => {
                  setFilterStatus(v as ConsentStatus | '');
                  resetPage();
                }}
                options={[
                  { value: '', label: 'All statuses' },
                  { value: 'active', label: 'Active' },
                  { value: 'withdrawn', label: 'Withdrawn' },
                  { value: 'expired', label: 'Expired' },
                  { value: 'pending', label: 'Pending' },
                ]}
              />
            </div>
            <div className="min-w-36">
              <Select
                label="Regulation"
                value={filterRegulation}
                onChange={(v) => {
                  setFilterRegulation(v as ConsentRegulation | '');
                  resetPage();
                }}
                options={[
                  { value: '', label: 'All regulations' },
                  { value: 'TCPA', label: 'TCPA' },
                  { value: 'CAN-SPAM', label: 'CAN-SPAM' },
                  { value: 'GDPR', label: 'GDPR' },
                  { value: 'CASL', label: 'CASL' },
                  { value: 'CCPA', label: 'CCPA' },
                ]}
              />
            </div>
            {(filterCustomer !== '' ||
              filterChannel !== '' ||
              filterStatus !== '' ||
              filterRegulation !== '') && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setFilterCustomer('');
                  setFilterChannel('');
                  setFilterStatus('');
                  setFilterRegulation('');
                  setPage(1);
                }}
                className="mb-0.5"
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Spinner size="md" label="Loading consent records" />
            </div>
          ) : records.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-content-secondary">
              <FileCheck className="h-8 w-8 opacity-40" />
              <p className="text-sm">No consent records found</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-secondary">
                    {[
                      'Customer',
                      'Channel',
                      'Regulation',
                      'Method',
                      'Status',
                      'Consented',
                      'Expires',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {records.map((rec) => {
                    const sm = STATUS_META[rec.status];
                    const cm = CHANNEL_META[rec.channel];
                    const expiring = isExpiringSoon(rec.expiresAt);
                    return (
                      <tr
                        key={rec.id}
                        onClick={() => {
                          setSelectedRecord(rec.id === selectedRecord?.id ? null : rec);
                        }}
                        className={cn(
                          'cursor-pointer transition-colors hover:bg-surface-secondary',
                          rec.id === selectedRecord?.id && 'bg-brand-accent/5',
                        )}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-content-secondary">
                          {rec.customerId}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('flex items-center gap-1.5 text-sm', cm.color)}>
                            {cm.Icon}
                            {cm.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'rounded border px-1.5 py-0.5 text-xs',
                              REGULATION_COLORS[rec.regulation],
                            )}
                          >
                            {rec.regulation}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-content-secondary capitalize">
                          {rec.method.replace(/_/g, ' ')}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={sm.variant}>{sm.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-content-secondary">
                          {fmtDate(rec.consentedAt)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {rec.expiresAt === null ? (
                            <span className="text-content-tertiary">—</span>
                          ) : expiring ? (
                            <span className="flex items-center gap-1 text-amber-400">
                              <AlertTriangle className="h-3 w-3" />
                              {fmtDate(rec.expiresAt)}
                            </span>
                          ) : (
                            <span className="text-content-secondary">{fmtDate(rec.expiresAt)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm text-content-secondary">
              <span>
                Showing {String((page - 1) * PAGE_SIZE + 1)}–
                {String(Math.min(page * PAGE_SIZE, total))} of {String(total)}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPage((p) => p - 1);
                  }}
                  disabled={page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPage((p) => p + 1);
                  }}
                  disabled={page * PAGE_SIZE >= total}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Detail panel ───────────────────────────────────── */}
        {selectedRecord !== null && (
          <div className="w-80 shrink-0 border-l border-border bg-surface">
            <DetailPanel
              record={selectedRecord}
              onClose={() => {
                setSelectedRecord(null);
              }}
              onWithdraw={(rec) => {
                setWithdrawTarget(rec);
              }}
            />
          </div>
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────── */}
      {showRecord && (
        <RecordModal
          onClose={() => {
            setShowRecord(false);
          }}
          onDone={load}
        />
      )}
      {withdrawTarget !== null && (
        <WithdrawModal
          record={withdrawTarget}
          onClose={() => {
            setWithdrawTarget(null);
          }}
          onDone={() => {
            setSelectedRecord(null);
            load();
          }}
        />
      )}
    </div>
  );
}
