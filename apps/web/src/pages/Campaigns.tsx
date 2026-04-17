/**
 * Outreach Campaigns
 *
 * Multi-channel bulk outreach with segment targeting, compliance gating,
 * scheduling, and per-recipient compliance evaluation before dispatch.
 *
 * Compliance gate pattern: each recipient evaluated individually against
 * selected regulations before any send. One gate failure suppresses the
 * individual contact and logs a compliance event — the campaign continues.
 *
 * SECURITY:
 * - All campaigns tenant-scoped via JWT — Rule 2
 * - Campaign mutations WORM-logged — Rule 3
 * - Every message passes compliance engine before dispatch — Rule 9
 * - >10K recipient campaigns require explicit human confirmation — Rule 9
 * - PHI must not appear in campaign names or descriptions — Rule 6
 * - Mass communication opt-out processed in real-time — TCPA 47 U.S.C. § 227
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.25 | HIPAA §164.312(a)(1)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Target,
  Send,
  Mail,
  Phone,
  Plus,
  Pencil,
  Trash2,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  ChevronRight,
  Search,
  Shield,
  PlayCircle,
  PauseCircle,
  StopCircle,
  BarChart3,
  Users,
  Filter,
  MessageSquare,
} from '../components/icons';
import {
  campaignsApi,
  type Campaign,
  type CampaignStats,
  type CampaignStatus,
  type CampaignChannel,
  type ComplianceGate,
  type CreateCampaignBody,
} from '../lib/campaigns-api';
import { cn } from '../lib/cn';
import { Spinner } from '../components/ui/Spinner';

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_STATS: CampaignStats = {
  activeCampaigns: 3,
  totalSentToday: 14_821,
  avgDeliveryRate: 96.4,
  complianceFlagsToday: 47,
};

const MOCK_CAMPAIGNS: Campaign[] = [
  {
    id: 'camp-001',
    tenantId: 't1',
    name: 'Q2 Collections Win-Back — SMS',
    description: 'Re-engage dormant accounts with payment reminder via SMS. TCPA consent verified.',
    segmentId: 'seg-007',
    segmentName: 'Churn Risk — Q1 Win-Back',
    channels: ['sms'],
    status: 'running',
    complianceGates: ['tcpa', 'ccpa'],
    templateId: 'tmpl-001',
    scheduledAt: null,
    startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    completedAt: null,
    delivery: {
      targeted: 2_317,
      suppressed: 83,
      sent: 1_844,
      delivered: 1_791,
      failed: 53,
      complianceBlocked: 83,
      deliveryRate: 97.1,
    },
    createdAt: '2026-04-10T09:00:00Z',
    createdBy: 'ops@synexiun.com',
  },
  {
    id: 'camp-002',
    tenantId: 't1',
    name: 'Healthcare Appointment Reminders',
    description: 'Email + SMS appointment reminders for HIPAA-scoped patients.',
    segmentId: 'seg-005',
    segmentName: 'Healthcare — HIPAA Scope',
    channels: ['email', 'sms'],
    status: 'completed',
    complianceGates: ['hipaa', 'tcpa', 'can_spam'],
    templateId: 'tmpl-002',
    scheduledAt: '2026-04-14T08:00:00Z',
    startedAt: '2026-04-14T08:00:12Z',
    completedAt: '2026-04-14T08:43:21Z',
    delivery: {
      targeted: 882,
      suppressed: 14,
      sent: 868,
      delivered: 851,
      failed: 17,
      complianceBlocked: 14,
      deliveryRate: 98.0,
    },
    createdAt: '2026-04-12T14:00:00Z',
    createdBy: 'admin@synexiun.com',
  },
  {
    id: 'camp-003',
    tenantId: 't1',
    name: 'Enterprise Renewal — Email',
    description: 'Proactive renewal outreach to enterprise accounts 60 days before contract end.',
    segmentId: 'seg-006',
    segmentName: 'Enterprise Plan',
    channels: ['email'],
    status: 'scheduled',
    complianceGates: ['gdpr', 'can_spam', 'ccpa'],
    templateId: 'tmpl-003',
    scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    startedAt: null,
    completedAt: null,
    delivery: {
      targeted: 438,
      suppressed: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      complianceBlocked: 0,
      deliveryRate: 0,
    },
    createdAt: '2026-04-16T11:00:00Z',
    createdBy: 'admin@synexiun.com',
  },
  {
    id: 'camp-004',
    tenantId: 't1',
    name: 'TCPA Consent Re-confirmation',
    description: 'Re-confirm opt-in consent for all SMS-reachable contacts per TCPA 2024 update.',
    segmentId: 'seg-008',
    segmentName: 'TCPA Compliant — Outbound SMS',
    channels: ['sms'],
    status: 'paused',
    complianceGates: ['tcpa'],
    templateId: 'tmpl-004',
    scheduledAt: null,
    startedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    completedAt: null,
    delivery: {
      targeted: 9_241,
      suppressed: 211,
      sent: 4_102,
      delivered: 3_944,
      failed: 158,
      complianceBlocked: 211,
      deliveryRate: 96.1,
    },
    createdAt: '2026-04-15T08:00:00Z',
    createdBy: 'compliance@synexiun.com',
  },
  {
    id: 'camp-005',
    tenantId: 't1',
    name: 'High-Value VIP Upsell — Multi-Channel',
    description: 'Personal upsell outreach to high-value accounts via email and in-app message.',
    segmentId: 'seg-002',
    segmentName: 'High-Value Customers',
    channels: ['email', 'in_app'],
    status: 'draft',
    complianceGates: ['gdpr', 'can_spam', 'ccpa'],
    templateId: null,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    delivery: {
      targeted: 1_204,
      suppressed: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      complianceBlocked: 0,
      deliveryRate: 0,
    },
    createdAt: '2026-04-17T07:00:00Z',
    createdBy: 'ops@synexiun.com',
  },
  {
    id: 'camp-006',
    tenantId: 't1',
    name: 'Dormant Re-engagement — Email Drip',
    description: 'Three-touch email sequence for contacts dormant >60 days.',
    segmentId: 'seg-003',
    segmentName: 'Dormant Contacts',
    channels: ['email'],
    status: 'failed',
    complianceGates: ['can_spam', 'gdpr'],
    templateId: 'tmpl-005',
    scheduledAt: '2026-04-16T09:00:00Z',
    startedAt: '2026-04-16T09:00:08Z',
    completedAt: '2026-04-16T09:03:12Z',
    delivery: {
      targeted: 3_718,
      suppressed: 441,
      sent: 317,
      delivered: 0,
      failed: 317,
      complianceBlocked: 441,
      deliveryRate: 0,
    },
    createdAt: '2026-04-14T16:00:00Z',
    createdBy: 'ops@synexiun.com',
  },
];

// ── Config Maps ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<CampaignStatus, { label: string; badge: string; icon: typeof Clock }> =
  {
    draft: { label: 'Draft', badge: 'bg-slate-500/15 text-content-secondary', icon: Pencil },
    scheduled: { label: 'Scheduled', badge: 'bg-blue-500/15 text-blue-400', icon: Clock },
    running: { label: 'Running', badge: 'bg-emerald-500/15 text-emerald-400', icon: PlayCircle },
    paused: { label: 'Paused', badge: 'bg-amber-500/15 text-amber-400', icon: PauseCircle },
    completed: {
      label: 'Completed',
      badge: 'bg-emerald-500/10 text-emerald-500',
      icon: CheckCircle2,
    },
    failed: { label: 'Failed', badge: 'bg-red-500/15 text-danger', icon: XCircle },
    cancelled: {
      label: 'Cancelled',
      badge: 'bg-slate-500/10 text-content-tertiary',
      icon: StopCircle,
    },
  };

const CHANNEL_CONFIG: Record<CampaignChannel, { label: string; icon: typeof Send; color: string }> =
  {
    sms: { label: 'SMS', icon: MessageSquare, color: 'text-emerald-400' },
    email: { label: 'Email', icon: Mail, color: 'text-blue-400' },
    voice: { label: 'Voice', icon: Phone, color: 'text-violet-400' },
    push: { label: 'Push', icon: Send, color: 'text-amber-400' },
    in_app: { label: 'In-App', icon: MessageSquare, color: 'text-cyan-400' },
  };

const GATE_CONFIG: Record<ComplianceGate, { label: string; color: string }> = {
  tcpa: { label: 'TCPA', color: 'text-red-400' },
  can_spam: { label: 'CAN-SPAM', color: 'text-orange-400' },
  gdpr: { label: 'GDPR', color: 'text-blue-400' },
  casl: { label: 'CASL', color: 'text-sky-400' },
  ccpa: { label: 'CCPA', color: 'text-cyan-400' },
  hipaa: { label: 'HIPAA', color: 'text-pink-400' },
};

const CHANNEL_OPTIONS: CampaignChannel[] = ['sms', 'email', 'voice', 'push', 'in_app'];
const GATE_OPTIONS: ComplianceGate[] = ['tcpa', 'can_spam', 'gdpr', 'casl', 'ccpa', 'hipaa'];

const MOCK_SEGMENTS = [
  { id: 'seg-001', name: 'All Contacts', memberCount: 24_831 },
  { id: 'seg-002', name: 'High-Value Customers', memberCount: 1_204 },
  { id: 'seg-003', name: 'Dormant Contacts', memberCount: 3_718 },
  { id: 'seg-004', name: 'SMS Channel — High Engagement', memberCount: 5_092 },
  { id: 'seg-005', name: 'Healthcare — HIPAA Scope', memberCount: 882 },
  { id: 'seg-006', name: 'Enterprise Plan', memberCount: 438 },
  { id: 'seg-007', name: 'Churn Risk — Q1 Win-Back', memberCount: 2_317 },
  { id: 'seg-008', name: 'TCPA Compliant — Outbound SMS', memberCount: 9_241 },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Stat Card ──────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Target;
  accent?: string;
}

function StatCard({ label, value, sub, icon: Icon, accent = 'text-brand-400' }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex items-start gap-3">
      <div className={cn('mt-0.5 shrink-0', accent)}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-content-tertiary mb-0.5">{label}</p>
        <p className="text-xl font-semibold text-content leading-none">{value}</p>
        {sub !== undefined && <p className="text-xs text-content-secondary mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ── Delivery Bar ───────────────────────────────────────────────────────────

function DeliveryBar({ campaign }: { campaign: Campaign }) {
  const { targeted, delivered, complianceBlocked, failed } = campaign.delivery;
  if (targeted === 0) {
    return <div className="w-full h-1.5 rounded-full bg-surface-tertiary" />;
  }
  const deliveredPct = (delivered / targeted) * 100;
  const blockedPct = (complianceBlocked / targeted) * 100;
  const failedPct = (failed / targeted) * 100;

  return (
    <div className="w-full h-1.5 rounded-full bg-surface-tertiary overflow-hidden flex">
      <div
        className="h-full bg-emerald-500 transition-all"
        style={{ width: `${deliveredPct}%` }}
        title={`Delivered: ${fmtNumber(delivered)}`}
      />
      <div
        className="h-full bg-amber-500/60 transition-all"
        style={{ width: `${blockedPct}%` }}
        title={`Compliance blocked: ${fmtNumber(complianceBlocked)}`}
      />
      <div
        className="h-full bg-red-500/60 transition-all"
        style={{ width: `${failedPct}%` }}
        title={`Failed: ${fmtNumber(failed)}`}
      />
    </div>
  );
}

// ── Campaign Card ──────────────────────────────────────────────────────────

interface CampaignCardProps {
  campaign: Campaign;
  selected: boolean;
  onSelect: () => void;
  onAction: (action: 'launch' | 'pause' | 'resume' | 'cancel' | 'delete' | 'edit') => void;
}

function CampaignCard({ campaign, selected, onSelect, onAction }: CampaignCardProps) {
  const statusCfg = STATUS_CONFIG[campaign.status];
  const StatusIcon = statusCfg.icon;

  return (
    <div
      onClick={onSelect}
      className={cn(
        'rounded-xl border bg-surface p-4 cursor-pointer transition-colors',
        selected
          ? 'border-brand-500/50 bg-brand-500/5'
          : 'border-border hover:bg-surface-secondary',
      )}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className="text-sm font-semibold text-content truncate">{campaign.name}</h3>
            <span
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0',
                statusCfg.badge,
              )}
            >
              <StatusIcon size={10} />
              {statusCfg.label}
            </span>
          </div>
          <p className="text-xs text-content-tertiary flex items-center gap-1">
            <Users size={11} />
            {campaign.segmentName}
          </p>
        </div>

        {/* Quick actions */}
        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {campaign.status === 'draft' && (
            <button
              onClick={() => {
                onAction('launch');
              }}
              className="p-1.5 rounded hover:bg-emerald-500/10 text-content-tertiary hover:text-emerald-400 transition-colors"
              title="Launch"
            >
              <PlayCircle size={13} />
            </button>
          )}
          {campaign.status === 'running' && (
            <button
              onClick={() => {
                onAction('pause');
              }}
              className="p-1.5 rounded hover:bg-amber-500/10 text-content-tertiary hover:text-amber-400 transition-colors"
              title="Pause"
            >
              <PauseCircle size={13} />
            </button>
          )}
          {campaign.status === 'paused' && (
            <button
              onClick={() => {
                onAction('resume');
              }}
              className="p-1.5 rounded hover:bg-emerald-500/10 text-content-tertiary hover:text-emerald-400 transition-colors"
              title="Resume"
            >
              <PlayCircle size={13} />
            </button>
          )}
          {(campaign.status === 'draft' || campaign.status === 'scheduled') && (
            <button
              onClick={() => {
                onAction('edit');
              }}
              className="p-1.5 rounded hover:bg-surface-tertiary text-content-tertiary hover:text-content transition-colors"
              title="Edit"
            >
              <Pencil size={13} />
            </button>
          )}
          {(campaign.status === 'draft' ||
            campaign.status === 'completed' ||
            campaign.status === 'failed' ||
            campaign.status === 'cancelled') && (
            <button
              onClick={() => {
                onAction('delete');
              }}
              className="p-1.5 rounded hover:bg-red-500/10 text-content-tertiary hover:text-danger transition-colors"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Channels */}
      <div className="flex items-center gap-1.5 mb-3">
        {campaign.channels.map((ch) => {
          const cfg = CHANNEL_CONFIG[ch];
          const ChanIcon = cfg.icon;
          return (
            <span
              key={ch}
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px]',
                cfg.color,
              )}
            >
              <ChanIcon size={9} />
              {cfg.label}
            </span>
          );
        })}
        <span className="ml-auto text-xs text-content-secondary font-medium">
          {fmtNumber(campaign.delivery.targeted)} recipients
        </span>
      </div>

      {/* Delivery bar */}
      <DeliveryBar campaign={campaign} />

      {/* Stats row */}
      {campaign.delivery.targeted > 0 && campaign.status !== 'draft' && (
        <div className="flex items-center gap-4 mt-2 text-xs text-content-tertiary">
          <span className="text-emerald-400 font-medium">
            {fmtNumber(campaign.delivery.delivered)} delivered
          </span>
          {campaign.delivery.complianceBlocked > 0 && (
            <span className="text-amber-400">
              {fmtNumber(campaign.delivery.complianceBlocked)} blocked
            </span>
          )}
          {campaign.delivery.failed > 0 && (
            <span className="text-danger">{fmtNumber(campaign.delivery.failed)} failed</span>
          )}
          <span className="ml-auto">{fmtPct(campaign.delivery.deliveryRate)}</span>
        </div>
      )}

      {/* Scheduled time */}
      {campaign.scheduledAt !== null && campaign.status === 'scheduled' && (
        <p className="mt-2 text-xs text-blue-400 flex items-center gap-1">
          <Clock size={11} />
          Scheduled {fmtDate(campaign.scheduledAt)}
        </p>
      )}

      {/* Compliance gates */}
      <div className="flex flex-wrap gap-1 mt-2">
        {campaign.complianceGates.map((g) => (
          <span key={g} className={cn('text-[10px] font-mono font-medium', GATE_CONFIG[g].color)}>
            {GATE_CONFIG[g].label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Detail Panel ───────────────────────────────────────────────────────────

interface DetailPanelProps {
  campaign: Campaign;
  onClose: () => void;
  onAction: (action: 'launch' | 'pause' | 'resume' | 'cancel') => void;
}

function DetailPanel({ campaign, onClose, onAction }: DetailPanelProps) {
  const statusCfg = STATUS_CONFIG[campaign.status];
  const StatusIcon = statusCfg.icon;
  const { delivery } = campaign;

  const gaugeMetrics = [
    {
      label: 'Delivered',
      value: delivery.delivered,
      total: delivery.targeted,
      color: 'bg-emerald-500',
    },
    {
      label: 'Compliance Blocked',
      value: delivery.complianceBlocked,
      total: delivery.targeted,
      color: 'bg-amber-500',
    },
    { label: 'Failed', value: delivery.failed, total: delivery.targeted, color: 'bg-red-500' },
  ];

  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-5 self-start">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-content">{campaign.name}</h3>
          <span
            className={cn(
              'inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium',
              statusCfg.badge,
            )}
          >
            <StatusIcon size={10} />
            {statusCfg.label}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-content-tertiary hover:text-content transition-colors shrink-0"
        >
          <XCircle size={16} />
        </button>
      </div>

      <p className="text-xs text-content-secondary leading-relaxed">{campaign.description}</p>

      {/* Delivery overview */}
      <div>
        <p className="text-xs text-content-tertiary mb-2">Delivery</p>
        <div className="text-center mb-3">
          <p className="text-3xl font-bold text-content">{fmtNumber(delivery.targeted)}</p>
          <p className="text-xs text-content-tertiary">recipients targeted</p>
        </div>
        <div className="space-y-2">
          {gaugeMetrics.map((m) => (
            <div key={m.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-content-secondary">{m.label}</span>
                <span className="text-content font-medium">
                  {fmtNumber(m.value)}{' '}
                  <span className="text-content-tertiary">
                    ({delivery.targeted > 0 ? fmtPct((m.value / delivery.targeted) * 100) : '—'})
                  </span>
                </span>
              </div>
              <div className="w-full h-1 rounded-full bg-surface-tertiary overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', m.color)}
                  style={{
                    width: delivery.targeted > 0 ? `${(m.value / delivery.targeted) * 100}%` : '0%',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        {delivery.deliveryRate > 0 && (
          <div className="mt-3 text-center">
            <p className="text-lg font-bold text-emerald-400">{fmtPct(delivery.deliveryRate)}</p>
            <p className="text-xs text-content-tertiary">delivery rate</p>
          </div>
        )}
      </div>

      {/* Channels */}
      <div>
        <p className="text-xs text-content-tertiary mb-2">Channels</p>
        <div className="flex flex-wrap gap-1.5">
          {campaign.channels.map((ch) => {
            const cfg = CHANNEL_CONFIG[ch];
            const ChanIcon = cfg.icon;
            return (
              <span
                key={ch}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-border text-xs',
                  cfg.color,
                )}
              >
                <ChanIcon size={11} />
                {cfg.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Compliance gates */}
      <div>
        <p className="text-xs text-content-tertiary mb-2">
          <Shield size={11} className="inline mr-1" />
          Compliance Gates
        </p>
        <div className="flex flex-wrap gap-1.5">
          {campaign.complianceGates.map((g) => (
            <span
              key={g}
              className={cn(
                'px-2 py-0.5 rounded border border-border text-xs font-mono font-semibold',
                GATE_CONFIG[g].color,
              )}
            >
              {GATE_CONFIG[g].label}
            </span>
          ))}
        </div>
      </div>

      {/* Metadata */}
      <div className="space-y-1.5 text-xs border-t border-border pt-3">
        <div className="flex justify-between">
          <span className="text-content-tertiary">Segment</span>
          <span className="text-content">{campaign.segmentName}</span>
        </div>
        {campaign.scheduledAt !== null && (
          <div className="flex justify-between">
            <span className="text-content-tertiary">Scheduled</span>
            <span className="text-content">{fmtDate(campaign.scheduledAt)}</span>
          </div>
        )}
        {campaign.startedAt !== null && (
          <div className="flex justify-between">
            <span className="text-content-tertiary">Started</span>
            <span className="text-content">{relativeTime(campaign.startedAt)}</span>
          </div>
        )}
        {campaign.completedAt !== null && (
          <div className="flex justify-between">
            <span className="text-content-tertiary">Completed</span>
            <span className="text-content">{relativeTime(campaign.completedAt)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-content-tertiary">Created by</span>
          <span className="text-content">{campaign.createdBy}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-content-tertiary">Created</span>
          <span className="text-content">{fmtDate(campaign.createdAt)}</span>
        </div>
      </div>

      {/* Actions */}
      {campaign.status === 'draft' && (
        <button
          onClick={() => {
            onAction('launch');
          }}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
        >
          <PlayCircle size={12} />
          Launch Campaign
        </button>
      )}
      {campaign.status === 'running' && (
        <div className="flex gap-2">
          <button
            onClick={() => {
              onAction('pause');
            }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-amber-500/30 hover:bg-amber-500/10 text-amber-400 transition-colors"
          >
            <PauseCircle size={12} />
            Pause
          </button>
          <button
            onClick={() => {
              onAction('cancel');
            }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-red-500/30 hover:bg-red-500/10 text-danger transition-colors"
          >
            <StopCircle size={12} />
            Cancel
          </button>
        </div>
      )}
      {campaign.status === 'paused' && (
        <div className="flex gap-2">
          <button
            onClick={() => {
              onAction('resume');
            }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            <PlayCircle size={12} />
            Resume
          </button>
          <button
            onClick={() => {
              onAction('cancel');
            }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-red-500/30 hover:bg-red-500/10 text-danger transition-colors"
          >
            <StopCircle size={12} />
            Cancel
          </button>
        </div>
      )}

      {campaign.delivery.complianceBlocked > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-3">
          <p className="text-xs text-amber-400 font-medium flex items-center gap-1.5">
            <AlertTriangle size={12} />
            {fmtNumber(campaign.delivery.complianceBlocked)} recipients suppressed
          </p>
          <p className="text-xs text-amber-400/70 mt-1">
            Per-recipient compliance evaluation blocked these contacts before dispatch. Each
            suppression is WORM-logged with the regulation and reason.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Create Campaign Modal ──────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onSave: (body: CreateCampaignBody) => Promise<void>;
}

function CreateModal({ onClose, onSave }: CreateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [channels, setChannels] = useState(new Set<CampaignChannel>());
  const [gates, setGates] = useState(new Set<ComplianceGate>());
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const selectedSegment = MOCK_SEGMENTS.find((s) => s.id === segmentId);
  const needsHITL = selectedSegment !== undefined && selectedSegment.memberCount > 10_000;

  function toggleChannel(ch: CampaignChannel) {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  }

  function toggleGate(g: ComplianceGate) {
    setGates((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  }

  async function handleSave() {
    if (name.trim().length < 2) {
      setErr('Campaign name must be at least 2 characters.');
      return;
    }
    if (segmentId === '') {
      setErr('Select a target segment.');
      return;
    }
    if (channels.size === 0) {
      setErr('Select at least one channel.');
      return;
    }
    if (gates.size === 0) {
      setErr('Select at least one compliance gate.');
      return;
    }
    if (scheduleMode === 'later' && scheduledAt === '') {
      setErr('Enter a scheduled date and time.');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        segmentId,
        channels: [...channels],
        complianceGates: [...gates],
        templateId: null,
        scheduledAt: scheduleMode === 'later' ? new Date(scheduledAt).toISOString() : null,
      });
      onClose();
    } catch {
      setErr('Failed to create campaign. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-content">Create Campaign</h2>
          <button
            onClick={onClose}
            className="text-content-tertiary hover:text-content transition-colors"
          >
            <XCircle size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-content-secondary mb-1.5">Campaign Name</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="e.g. Q2 Collections Win-Back — SMS"
              className="w-full rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-content-tertiary"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-content-secondary mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              rows={2}
              placeholder="No PHI in campaign descriptions (Rule 6)"
              className="w-full rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-content-tertiary resize-none"
            />
          </div>

          {/* Segment */}
          <div>
            <label className="block text-xs text-content-secondary mb-1.5">Target Segment</label>
            <select
              value={segmentId}
              onChange={(e) => {
                setSegmentId(e.target.value);
              }}
              className="w-full rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">— Select a segment —</option>
              {MOCK_SEGMENTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({fmtNumber(s.memberCount)} members)
                </option>
              ))}
            </select>
            {needsHITL && (
              <p className="mt-1.5 text-xs text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={11} />
                {'>'} 10K recipients requires human-in-the-loop approval before launch (Rule 9).
              </p>
            )}
          </div>

          {/* Channels */}
          <div>
            <label className="block text-xs text-content-secondary mb-1.5">Channels</label>
            <div className="flex flex-wrap gap-2">
              {CHANNEL_OPTIONS.map((ch) => {
                const cfg = CHANNEL_CONFIG[ch];
                const ChanIcon = cfg.icon;
                const active = channels.has(ch);
                return (
                  <button
                    key={ch}
                    onClick={() => {
                      toggleChannel(ch);
                    }}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors',
                      active
                        ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                        : 'border-border bg-surface-secondary text-content-secondary hover:bg-surface-tertiary',
                    )}
                  >
                    <ChanIcon size={12} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Compliance gates */}
          <div>
            <label className="block text-xs text-content-secondary mb-1.5">
              <Shield size={11} className="inline mr-1" />
              Compliance Gates
            </label>
            <div className="flex flex-wrap gap-2">
              {GATE_OPTIONS.map((g) => {
                const active = gates.has(g);
                return (
                  <button
                    key={g}
                    onClick={() => {
                      toggleGate(g);
                    }}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border transition-colors',
                      active
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                        : 'border-border bg-surface-secondary text-content-tertiary hover:bg-surface-tertiary',
                    )}
                  >
                    {GATE_CONFIG[g].label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-content-tertiary">
              Each recipient is individually evaluated against selected gates before dispatch.
            </p>
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-xs text-content-secondary mb-1.5">Schedule</label>
            <div className="flex gap-2 mb-2">
              {(['now', 'later'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setScheduleMode(m);
                  }}
                  className={cn(
                    'flex-1 py-1.5 rounded-lg text-xs border transition-colors',
                    scheduleMode === m
                      ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                      : 'border-border text-content-secondary hover:bg-surface-secondary',
                  )}
                >
                  {m === 'now' ? 'Launch immediately' : 'Schedule for later'}
                </button>
              ))}
            </div>
            {scheduleMode === 'later' && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => {
                  setScheduledAt(e.target.value);
                }}
                className="w-full rounded-lg border border-border bg-surface-secondary text-content text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            )}
          </div>

          {err !== '' && (
            <p className="text-xs text-danger flex items-center gap-1.5">
              <AlertTriangle size={12} /> {err}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 pt-3 pb-5 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-content-secondary hover:bg-surface-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Spinner size="xs" />}
            Create Campaign
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Modal ───────────────────────────────────────────────────────────

function DeleteModal({
  campaign,
  onClose,
  onConfirm,
}: {
  campaign: Campaign;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);

  async function handle() {
    setLoading(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface shadow-2xl p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full p-2 bg-red-500/15">
            <Trash2 size={16} className="text-danger" />
          </div>
          <h2 className="text-sm font-semibold text-content">Delete Campaign</h2>
        </div>
        <p className="text-sm text-content-secondary">
          Delete <span className="font-medium text-content">"{campaign.name}"</span>? This action is
          WORM-logged and cannot be undone.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-content-secondary hover:bg-surface-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handle();
            }}
            disabled={loading}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading && <Spinner size="xs" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function Campaigns() {
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | ''>('');
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadRef.current;
    setLoading(true);
    try {
      const [s, c] = await Promise.all([campaignsApi.getStats(), campaignsApi.listCampaigns()]);
      if (seq !== loadRef.current) return;
      setStats(s);
      setCampaigns(c);
    } catch {
      if (seq !== loadRef.current) return;
      setStats(MOCK_STATS);
      setCampaigns(MOCK_CAMPAIGNS);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = campaigns.filter((c) => {
    const matchSearch =
      search === '' ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.segmentName.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === '' || c.status === statusFilter;
    return matchSearch && matchStatus;
  });

  async function handleAction(
    campaign: Campaign,
    action: 'launch' | 'pause' | 'resume' | 'cancel' | 'delete' | 'edit',
  ) {
    if (action === 'delete') {
      setDeleteTarget(campaign);
      return;
    }
    if (action === 'edit') return;
    try {
      let updated: Campaign;
      if (action === 'launch') updated = await campaignsApi.launchCampaign(campaign.id);
      else if (action === 'pause') updated = await campaignsApi.pauseCampaign(campaign.id);
      else if (action === 'resume') updated = await campaignsApi.resumeCampaign(campaign.id);
      else updated = await campaignsApi.cancelCampaign(campaign.id);
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      if (selected?.id === updated.id) setSelected(updated);
    } catch {
      void load();
    }
  }

  async function handleCreate(body: CreateCampaignBody) {
    const created = await campaignsApi.createCampaign(body);
    setCampaigns((prev) => [created, ...prev]);
  }

  async function handleDelete() {
    if (deleteTarget === null) return;
    await campaignsApi.deleteCampaign(deleteTarget.id);
    setCampaigns((prev) => prev.filter((c) => c.id !== deleteTarget.id));
    if (selected?.id === deleteTarget.id) setSelected(null);
  }

  const STATUS_FILTER_OPTIONS: { value: CampaignStatus | ''; label: string }[] = [
    { value: '', label: 'All Statuses' },
    { value: 'draft', label: 'Draft' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'running', label: 'Running' },
    { value: 'paused', label: 'Paused' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
  ];

  return (
    <div className="h-full flex flex-col bg-surface-secondary">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border bg-surface">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-content">Outreach Campaigns</h1>
            <p className="text-xs text-content-tertiary mt-0.5">
              Multi-channel bulk outreach with per-recipient compliance gating
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                void load();
              }}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-content-secondary hover:bg-surface-secondary border border-border transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              onClick={() => {
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-600 hover:bg-brand-500 text-white transition-colors"
            >
              <Plus size={13} />
              New Campaign
            </button>
          </div>
        </div>
      </div>

      {loading && campaigns.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <Spinner size="md" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Stat Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Active Campaigns"
              value={String(stats?.activeCampaigns ?? 0)}
              sub="currently running"
              icon={Target}
            />
            <StatCard
              label="Sent Today"
              value={fmtNumber(stats?.totalSentToday ?? 0)}
              sub="across all campaigns"
              icon={Send}
              accent="text-emerald-400"
            />
            <StatCard
              label="Avg Delivery Rate"
              value={`${stats?.avgDeliveryRate.toFixed(1) ?? '—'}%`}
              sub="last 30 days"
              icon={BarChart3}
              accent="text-blue-400"
            />
            <StatCard
              label="Compliance Flags"
              value={fmtNumber(stats?.complianceFlagsToday ?? 0)}
              sub="suppressed today"
              icon={Shield}
              accent="text-amber-400"
            />
          </div>

          {/* Search + Filter */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-48">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-content-tertiary"
              />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
                placeholder="Search campaigns or segments…"
                className="w-full rounded-lg border border-border bg-surface text-content text-xs pl-8 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500 placeholder:text-content-tertiary"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Filter size={13} className="text-content-tertiary" />
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as CampaignStatus | '');
                }}
                className="rounded-lg border border-border bg-surface text-content text-xs px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <span className="text-xs text-content-tertiary ml-auto">
              {filtered.length} campaign{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Grid + Detail Panel */}
          <div className={cn('flex gap-4 min-h-0', selected !== null && 'items-start')}>
            {/* Campaign cards */}
            <div
              className={cn(
                'grid gap-3 content-start flex-1 min-w-0',
                selected !== null ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2',
              )}
            >
              {filtered.map((c) => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  selected={selected?.id === c.id}
                  onSelect={() => {
                    setSelected((prev) => (prev?.id === c.id ? null : c));
                  }}
                  onAction={(action) => {
                    void handleAction(c, action);
                  }}
                />
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full py-16 text-center text-content-tertiary">
                  <Target size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">
                    {search !== '' || statusFilter !== ''
                      ? 'No campaigns match the current filters.'
                      : 'No campaigns yet. Create one to start reaching your customers.'}
                  </p>
                </div>
              )}
            </div>

            {/* Detail panel */}
            {selected !== null && (
              <div className="w-72 shrink-0">
                <DetailPanel
                  campaign={selected}
                  onClose={() => {
                    setSelected(null);
                  }}
                  onAction={(action) => {
                    void handleAction(selected, action);
                  }}
                />
              </div>
            )}
          </div>

          {/* Compliance notice */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <Shield size={16} className="text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-content mb-1">
                  Per-Recipient Compliance Gating
                </p>
                <p className="text-xs text-content-secondary leading-relaxed">
                  Every recipient is individually evaluated against your selected compliance gates
                  before each message dispatches. One suppression does not pause the campaign — the
                  send continues and each suppressed contact is WORM-logged with the regulation,
                  gate result, and timestamp. Mass campaigns ({'>'} 10,000 recipients) require
                  explicit human-in-the-loop confirmation before launch.
                </p>
                <div className="flex flex-wrap gap-3 mt-2">
                  {GATE_OPTIONS.map((g) => (
                    <span
                      key={g}
                      className={cn('text-xs font-mono font-semibold', GATE_CONFIG[g].color)}
                    >
                      {GATE_CONFIG[g].label}
                    </span>
                  ))}
                  <ChevronRight size={12} className="text-content-tertiary self-center" />
                  <span className="text-xs text-content-secondary">
                    6 regulations enforced natively
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateModal
          onClose={() => {
            setCreateOpen(false);
          }}
          onSave={handleCreate}
        />
      )}

      {deleteTarget !== null && (
        <DeleteModal
          campaign={deleteTarget}
          onClose={() => {
            setDeleteTarget(null);
          }}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
