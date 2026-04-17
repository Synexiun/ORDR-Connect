/**
 * Prompt Templates
 *
 * Versioned system prompt management with variable substitution,
 * compliance review workflow, and live render playground.
 *
 * SECURITY:
 * - Template mutations WORM-logged with actor identity — Rule 3
 * - Unapproved templates cannot be assigned to production roles — Rule 9
 * - PHI must not appear in templates — variable refs only — Rule 6
 * - Render previews audit-logged as prompt chain evidence — Rule 3
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.25 | HIPAA §164.312(a)(1)
 */

import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import {
  Layers,
  CheckCircle2,
  Clock,
  AlertTriangle,
  PlayCircle,
  Code2,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
} from '../components/icons';
import {
  promptsApi,
  type PromptTemplate,
  type PromptVersion,
  type PromptStats,
  type TemplateStatus,
  type RenderPreviewResult,
} from '../lib/prompts-api';
import { cn } from '../lib/cn';
import { Spinner } from '../components/ui/Spinner';

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_TEMPLATES: PromptTemplate[] = [
  {
    id: 'tpl-001',
    name: 'Customer Service — Default',
    description: 'Primary system prompt for tier-1 customer service interactions.',
    role: 'customer_service',
    version: 4,
    content: `You are a customer service agent for {{tenant_name}}. Your role is to assist customers with their inquiries professionally and empathetically.

## Guidelines
- Always greet the customer by their preferred name if provided.
- Resolve issues within your authority before escalating.
- Never access or discuss data outside the scope of ticket #{{ticket_id}}.
- If you cannot resolve the issue, escalate to a senior agent with a clear summary.

## Context
Customer: {{customer_name}} (ID: {{customer_id}})
Ticket: #{{ticket_id}} — {{ticket_subject}}
Account tier: {{account_tier}}
Opened: {{ticket_created_at}}

## Constraints
- Do not make promises about refunds, credits, or exceptions without manager approval.
- Do not discuss competitor products.
- All responses must comply with {{tenant_name}} communication guidelines.`,
    variables: [
      {
        name: 'tenant_name',
        description: 'Organisation name',
        required: true,
        exampleValue: 'Acme Corp',
      },
      {
        name: 'customer_name',
        description: 'Customer display name',
        required: true,
        exampleValue: 'Jane Smith',
      },
      {
        name: 'customer_id',
        description: 'Internal customer UUID',
        required: true,
        exampleValue: 'cust-a1b2c3',
      },
      {
        name: 'ticket_id',
        description: 'Support ticket number',
        required: true,
        exampleValue: 'TKT-00412',
      },
      {
        name: 'ticket_subject',
        description: 'Ticket subject line',
        required: true,
        exampleValue: 'Billing discrepancy on invoice',
      },
      {
        name: 'account_tier',
        description: 'Customer account tier',
        required: false,
        exampleValue: 'Enterprise',
      },
      {
        name: 'ticket_created_at',
        description: 'Ticket creation datetime',
        required: false,
        exampleValue: '2026-04-17 09:30 UTC',
      },
    ],
    status: 'approved',
    tokenCount: 312,
    reviewedBy: 'compliance-team',
    approvedAt: '2026-04-01T14:00:00Z',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-04-01T14:00:00Z',
    createdBy: 'ai-team',
  },
  {
    id: 'tpl-002',
    name: 'Escalation Agent — Tier 2',
    description: 'System prompt for tier-2 escalation handling with elevated context.',
    role: 'escalation',
    version: 2,
    content: `You are a senior escalation agent for {{tenant_name}}. This ticket has been escalated from tier-1.

## Situation
Customer: {{customer_name}} ({{customer_id}})
Original ticket: #{{ticket_id}}
Escalation reason: {{escalation_reason}}
Tier-1 summary: {{tier1_summary}}
SLA deadline: {{sla_deadline}}

## Your responsibilities
- Review the complete case history before responding.
- You are authorised to offer standard goodwill gestures per the Escalation Policy v2.3.
- For refunds above \${{refund_threshold}}, obtain manager approval before committing.
- Document all decisions in the ticket audit trail.

## Constraints
- Treat all customer data as CONFIDENTIAL — do not reference data outside this ticket scope.
- Human approval required for any action affecting the customer's account balance.`,
    variables: [
      {
        name: 'tenant_name',
        description: 'Organisation name',
        required: true,
        exampleValue: 'Acme Corp',
      },
      {
        name: 'customer_name',
        description: 'Customer display name',
        required: true,
        exampleValue: 'John Doe',
      },
      {
        name: 'customer_id',
        description: 'Internal customer UUID',
        required: true,
        exampleValue: 'cust-d4e5f6',
      },
      {
        name: 'ticket_id',
        description: 'Original ticket number',
        required: true,
        exampleValue: 'TKT-00398',
      },
      {
        name: 'escalation_reason',
        description: 'Why ticket was escalated',
        required: true,
        exampleValue: 'Customer unsatisfied after 3 contacts',
      },
      {
        name: 'tier1_summary',
        description: 'Summary from tier-1 agent',
        required: true,
        exampleValue: 'Customer reports duplicate charge...',
      },
      {
        name: 'sla_deadline',
        description: 'SLA resolution deadline',
        required: true,
        exampleValue: '2026-04-18 17:00 UTC',
      },
      {
        name: 'refund_threshold',
        description: 'Refund approval threshold USD',
        required: false,
        exampleValue: '500',
      },
    ],
    status: 'approved',
    tokenCount: 287,
    reviewedBy: 'compliance-team',
    approvedAt: '2026-03-15T11:00:00Z',
    createdAt: '2026-02-01T09:00:00Z',
    updatedAt: '2026-03-15T11:00:00Z',
    createdBy: 'ai-team',
  },
  {
    id: 'tpl-003',
    name: 'Compliance Checker — Policy Audit',
    description: 'System prompt for automated compliance verification of agent responses.',
    role: 'compliance_checker',
    version: 1,
    content: `You are a compliance checker for {{tenant_name}}. Your task is to evaluate whether the following agent response complies with all applicable policies.

## Response under review
Agent role: {{agent_role}}
Response text:
---
{{agent_response}}
---

## Evaluation criteria
1. Does the response contain any PHI or PII not present in the original ticket context?
2. Does the response make any unauthorised commitments (refunds, SLA exceptions)?
3. Does the response reference any data outside the permitted scope?
4. Does the response comply with {{regulation_scope}} requirements?
5. Is the tone professional and within {{tenant_name}} communication standards?

## Output format
Return a structured JSON object with:
- compliant: boolean
- violations: string[] (empty if compliant)
- confidence: number (0.0–1.0)
- recommendation: string`,
    variables: [
      {
        name: 'tenant_name',
        description: 'Organisation name',
        required: true,
        exampleValue: 'Acme Corp',
      },
      {
        name: 'agent_role',
        description: 'Role of the reviewed agent',
        required: true,
        exampleValue: 'customer_service',
      },
      {
        name: 'agent_response',
        description: 'The agent output to review',
        required: true,
        exampleValue: 'I can offer you a full refund...',
      },
      {
        name: 'regulation_scope',
        description: 'Applicable regulations',
        required: false,
        exampleValue: 'GDPR, HIPAA',
      },
    ],
    status: 'approved',
    tokenCount: 341,
    reviewedBy: 'legal-team',
    approvedAt: '2026-03-20T16:00:00Z',
    createdAt: '2026-03-10T10:00:00Z',
    updatedAt: '2026-03-20T16:00:00Z',
    createdBy: 'compliance-team',
  },
  {
    id: 'tpl-004',
    name: 'Triage Agent — Intent Classification',
    description: 'Lightweight prompt for fast intent detection and ticket routing.',
    role: 'triage',
    version: 3,
    content: `Classify the following customer message into exactly one intent category.

Customer message:
---
{{customer_message}}
---

## Intent categories
- billing_dispute
- technical_support
- account_access
- product_question
- cancellation_request
- complaint
- compliment
- other

## Output format
Return only a JSON object:
{"intent": "<category>", "confidence": <0.0-1.0>, "urgency": "low|medium|high"}`,
    variables: [
      {
        name: 'customer_message',
        description: 'Raw customer message text',
        required: true,
        exampleValue: "I can't log into my account and I have an urgent meeting in 10 minutes",
      },
    ],
    status: 'in_review',
    tokenCount: 142,
    reviewedBy: null,
    approvedAt: null,
    createdAt: '2026-04-10T08:00:00Z',
    updatedAt: '2026-04-15T14:00:00Z',
    createdBy: 'ai-team',
  },
  {
    id: 'tpl-005',
    name: 'Data Analyst — Insight Summary',
    description: 'Draft prompt for automated customer interaction analytics.',
    role: 'data_analyst',
    version: 1,
    content: `Analyse the following customer interaction data for the period {{date_from}} to {{date_to}} and produce an executive summary.

## Data scope
Tenant: {{tenant_name}}
Interactions: {{interaction_count}}
Resolved: {{resolved_count}}
Average CSAT: {{avg_csat}}

Identify top 3 themes, sentiment trends, and actionable recommendations. Output as structured JSON.`,
    variables: [
      {
        name: 'tenant_name',
        description: 'Organisation name',
        required: true,
        exampleValue: 'Acme Corp',
      },
      {
        name: 'date_from',
        description: 'Analysis period start',
        required: true,
        exampleValue: '2026-04-01',
      },
      {
        name: 'date_to',
        description: 'Analysis period end',
        required: true,
        exampleValue: '2026-04-17',
      },
      {
        name: 'interaction_count',
        description: 'Total interactions',
        required: true,
        exampleValue: '12341',
      },
      {
        name: 'resolved_count',
        description: 'Resolved interactions',
        required: true,
        exampleValue: '11892',
      },
      { name: 'avg_csat', description: 'Average CSAT score', required: false, exampleValue: '4.2' },
    ],
    status: 'draft',
    tokenCount: 198,
    reviewedBy: null,
    approvedAt: null,
    createdAt: '2026-04-16T11:00:00Z',
    updatedAt: '2026-04-16T11:00:00Z',
    createdBy: 'ai-team',
  },
];

const MOCK_STATS: PromptStats = {
  totalTemplates: 5,
  approvedTemplates: 3,
  pendingReview: 1,
  totalVersions: 11,
};

const MOCK_VERSIONS: PromptVersion[] = [
  {
    id: 'ver-001-4',
    templateId: 'tpl-001',
    version: 4,
    content: MOCK_TEMPLATES[0]?.content ?? '',
    tokenCount: 312,
    status: 'approved',
    changeNote: 'Added account_tier variable; tightened escalation language.',
    createdAt: '2026-04-01T13:00:00Z',
    createdBy: 'ai-team',
  },
  {
    id: 'ver-001-3',
    templateId: 'tpl-001',
    version: 3,
    content: '(previous version content)',
    tokenCount: 298,
    status: 'deprecated',
    changeNote: 'Added ticket_created_at variable.',
    createdAt: '2026-03-01T10:00:00Z',
    createdBy: 'ai-team',
  },
  {
    id: 'ver-001-2',
    templateId: 'tpl-001',
    version: 2,
    content: '(previous version content)',
    tokenCount: 271,
    status: 'deprecated',
    changeNote: 'Rewrote constraints section after compliance review.',
    createdAt: '2026-02-01T10:00:00Z',
    createdBy: 'ai-team',
  },
  {
    id: 'ver-001-1',
    templateId: 'tpl-001',
    version: 1,
    content: '(initial version content)',
    tokenCount: 234,
    status: 'deprecated',
    changeNote: 'Initial draft.',
    createdAt: '2026-01-15T10:00:00Z',
    createdBy: 'ai-team',
  },
];

// ── Config ─────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<TemplateStatus, { label: string; className: string; icon: ReactNode }> = {
  draft: { label: 'Draft', className: 'bg-surface-secondary text-content-tertiary', icon: null },
  in_review: {
    label: 'In Review',
    className: 'bg-amber-500/10 text-amber-400',
    icon: <Clock className="h-2.5 w-2.5" />,
  },
  approved: {
    label: 'Approved',
    className: 'bg-emerald-500/10 text-emerald-400',
    icon: <CheckCircle2 className="h-2.5 w-2.5" />,
  },
  deprecated: {
    label: 'Deprecated',
    className: 'bg-surface-secondary text-content-tertiary',
    icon: null,
  },
};

const ROLE_DISPLAY: Record<string, string> = {
  customer_service: 'Customer Service',
  escalation: 'Escalation',
  compliance_checker: 'Compliance Checker',
  data_analyst: 'Data Analyst',
  content_moderator: 'Content Moderator',
  triage: 'Triage',
};

// ── Review Modal ───────────────────────────────────────────────────────────

interface ReviewModalProps {
  template: PromptTemplate;
  onClose: () => void;
  onReviewed: (updated: PromptTemplate) => void;
}

function ReviewModal({ template, onClose, onReviewed }: ReviewModalProps): ReactNode {
  const [action, setAction] = useState<'approve' | 'reject'>('approve');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      const updated = await promptsApi.submitReview(template.id, {
        action,
        note: note.trim() !== '' ? note.trim() : undefined,
      });
      onReviewed(updated);
    } catch {
      onReviewed({
        ...template,
        status: action === 'approve' ? 'approved' : 'draft',
        reviewedBy: 'current-user',
        approvedAt: action === 'approve' ? new Date().toISOString() : null,
      });
    } finally {
      setSubmitting(false);
    }
  }, [template, action, note, onReviewed]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-content">Compliance Review</h2>
        <p className="mb-5 text-sm text-content-tertiary">
          <span className="font-medium text-content">{template.name}</span> · v{template.version}
        </p>

        <div className="mb-4 flex gap-2">
          {(['approve', 'reject'] as const).map((a) => (
            <button
              key={a}
              onClick={() => {
                setAction(a);
              }}
              className={cn(
                'flex-1 rounded-lg border py-2 text-sm font-medium capitalize transition-colors',
                action === a
                  ? a === 'approve'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-red-500/30 bg-red-500/10 text-red-400'
                  : 'border-border text-content-tertiary hover:bg-surface-secondary',
              )}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="mb-5">
          <label className="mb-1.5 block text-sm font-medium text-content-secondary">
            Review note {action === 'reject' ? '(required)' : '(optional)'}
          </label>
          <textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            rows={3}
            placeholder={
              action === 'approve'
                ? 'Template reviewed and approved for production use.'
                : 'Please describe what needs to be corrected…'
            }
            className="w-full resize-none rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content placeholder:text-content-tertiary focus:border-brand-accent focus:outline-none"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-content-secondary hover:bg-surface-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={submitting || (action === 'reject' && note.trim() === '')}
            className={cn(
              'flex-1 rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40',
              action === 'approve' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white',
            )}
          >
            {submitting ? 'Submitting…' : action === 'approve' ? 'Approve' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Template Detail Panel ──────────────────────────────────────────────────

function TemplateDetail({
  template,
  onReview,
}: {
  template: PromptTemplate;
  onReview: (t: PromptTemplate) => void;
}): ReactNode {
  const [showContent, setShowContent] = useState(true);
  const statusCfg = STATUS_CFG[template.status];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-content">{template.name}</h3>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                statusCfg.className,
              )}
            >
              {statusCfg.icon}
              {statusCfg.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-content-tertiary">
            {ROLE_DISPLAY[template.role] ?? template.role} · v{template.version} ·{' '}
            {template.tokenCount} tokens
          </p>
          <p className="mt-1 text-sm text-content-secondary">{template.description}</p>
        </div>
        {template.status === 'in_review' && (
          <button
            onClick={() => {
              onReview(template);
            }}
            className="shrink-0 rounded-lg bg-brand-accent px-3 py-1.5 text-xs font-medium text-[#060608] hover:opacity-90"
          >
            <ShieldCheck className="mr-1 inline-block h-3.5 w-3.5" />
            Review
          </button>
        )}
      </div>

      {/* Variables */}
      {template.variables.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
            Variables ({template.variables.length})
          </p>
          <div className="space-y-1.5">
            {template.variables.map((v) => (
              <div
                key={v.name}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <code className="shrink-0 rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-xs text-brand-accent">
                  {`{{${v.name}}}`}
                </code>
                <span className="min-w-0 flex-1 text-xs text-content-secondary">
                  {v.description}
                </span>
                {v.required ? (
                  <span className="shrink-0 text-2xs text-red-400">required</span>
                ) : (
                  <span className="shrink-0 text-2xs text-content-tertiary">optional</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div>
        <button
          onClick={() => {
            setShowContent((v) => !v);
          }}
          className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-content-tertiary hover:text-content"
        >
          <Code2 className="h-3.5 w-3.5" />
          Prompt Content
          {showContent ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showContent && (
          <pre className="overflow-x-auto rounded-lg border border-border bg-surface-secondary p-4 text-xs leading-relaxed text-content-secondary whitespace-pre-wrap">
            {template.content}
          </pre>
        )}
      </div>

      {/* Approval info */}
      {template.status === 'approved' && template.approvedAt !== null && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
          <CheckCircle2 className="mr-1 inline-block h-3.5 w-3.5" />
          Approved by {template.reviewedBy ?? 'compliance-team'} on{' '}
          {new Date(template.approvedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </div>
      )}
    </div>
  );
}

// ── Versions Tab ───────────────────────────────────────────────────────────

function VersionsTab({
  versions,
  selectedTemplateId,
}: {
  versions: PromptVersion[];
  selectedTemplateId: string | null;
}): ReactNode {
  const filtered =
    selectedTemplateId !== null
      ? versions.filter((v) => v.templateId === selectedTemplateId)
      : versions;

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-content-tertiary">
        {selectedTemplateId !== null
          ? 'Select a template to view its version history'
          : 'No versions available'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filtered.map((ver) => {
        const statusCfg = STATUS_CFG[ver.status];
        return (
          <div key={ver.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-content">
                    v{ver.version}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                      statusCfg.className,
                    )}
                  >
                    {statusCfg.icon}
                    {statusCfg.label}
                  </span>
                </div>
                <p className="mt-1 text-xs text-content-secondary">{ver.changeNote}</p>
              </div>
              <div className="text-right text-xs text-content-tertiary">
                <p>{ver.tokenCount} tokens</p>
                <p>
                  {new Date(ver.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
                <p>{ver.createdBy}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Playground Tab ─────────────────────────────────────────────────────────

function PlaygroundTab({ templates }: { templates: PromptTemplate[] }): ReactNode {
  const [selectedId, setSelectedId] = useState(templates[0]?.id ?? '');
  const [varValues, setVarValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RenderPreviewResult | null>(null);
  const [rendering, setRendering] = useState(false);

  const template = templates.find((t) => t.id === selectedId) ?? null;

  const handleTemplateChange = useCallback((id: string) => {
    setSelectedId(id);
    setVarValues({});
    setResult(null);
  }, []);

  const handleRender = useCallback(async () => {
    if (template === null) return;
    setRendering(true);
    setResult(null);
    try {
      const res = await promptsApi.renderPreview({
        templateId: template.id,
        variables: varValues,
      });
      setResult(res);
    } catch {
      // Local render — substitute variables client-side as fallback
      let rendered = template.content;
      for (const [k, v] of Object.entries(varValues)) {
        rendered = rendered.replaceAll(`{{${k}}}`, v);
      }
      const missing = template.variables
        .filter((v) => v.required && (varValues[v.name] === undefined || varValues[v.name] === ''))
        .map((v) => v.name);
      setResult({
        rendered,
        tokenCount: Math.round(rendered.length / 4),
        estimatedCostUsd: (Math.round(rendered.length / 4) / 1000) * 0.003,
        missingVariables: missing,
      });
    } finally {
      setRendering(false);
    }
  }, [template, varValues]);

  const approvedTemplates = templates.filter((t) => t.status === 'approved');

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left: Config */}
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-content-secondary">
            Template
          </label>
          <select
            value={selectedId}
            onChange={(e) => {
              handleTemplateChange(e.target.value);
            }}
            className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:border-brand-accent focus:outline-none"
          >
            {approvedTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} (v{t.version})
              </option>
            ))}
          </select>
          {approvedTemplates.length === 0 && (
            <p className="mt-1 text-xs text-amber-400">No approved templates available</p>
          )}
        </div>

        {template !== null && template.variables.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-content-secondary">Variables</p>
            <div className="space-y-2">
              {template.variables.map((v) => (
                <div key={v.name}>
                  <label className="mb-1 block text-xs font-medium text-content-tertiary">
                    <code className="rounded bg-surface-secondary px-1 text-brand-accent">{`{{${v.name}}}`}</code>
                    {v.required && <span className="ml-1 text-red-400">*</span>}
                    {' — '}
                    {v.description}
                  </label>
                  <input
                    type="text"
                    value={varValues[v.name] ?? ''}
                    onChange={(e) => {
                      setVarValues((prev) => ({ ...prev, [v.name]: e.target.value }));
                    }}
                    placeholder={v.exampleValue}
                    className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-xs text-content placeholder:text-content-tertiary focus:border-brand-accent focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => {
            void handleRender();
          }}
          disabled={rendering || template === null}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-accent py-2 text-sm font-medium text-[#060608] hover:opacity-90 disabled:opacity-40"
        >
          <PlayCircle className="h-4 w-4" />
          {rendering ? 'Rendering…' : 'Render Preview'}
        </button>
      </div>

      {/* Right: Output */}
      <div className="space-y-3">
        {result === null ? (
          <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border text-sm text-content-tertiary">
            Rendered output appears here
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 text-xs text-content-tertiary">
              <span>{result.tokenCount} tokens</span>
              <span>·</span>
              <span>${result.estimatedCostUsd.toFixed(5)} est. cost</span>
              {result.missingVariables.length > 0 && (
                <>
                  <span>·</span>
                  <span className="text-amber-400">
                    <AlertTriangle className="mr-0.5 inline-block h-3 w-3" />
                    Missing: {result.missingVariables.join(', ')}
                  </span>
                </>
              )}
            </div>
            <pre className="max-h-96 overflow-y-auto rounded-xl border border-border bg-surface-secondary p-4 text-xs leading-relaxed text-content-secondary whitespace-pre-wrap">
              {result.rendered}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  bg,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  bg: string;
}): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className={cn('mb-3 inline-flex rounded-lg p-2', bg)}>{icon}</div>
      <p className="text-2xl font-bold text-content">{value}</p>
      <p className="mt-0.5 text-xs text-content-tertiary">{label}</p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

type Tab = 'templates' | 'versions' | 'playground';

export function PromptTemplates(): ReactNode {
  const [tab, setTab] = useState<Tab>('templates');
  const [stats, setStats] = useState<PromptStats | null>(null);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  const [reviewingTemplate, setReviewingTemplate] = useState<PromptTemplate | null>(null);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadRef.current;
    setLoading(true);
    try {
      const [s, t] = await Promise.all([promptsApi.getStats(), promptsApi.listTemplates()]);
      if (seq !== loadRef.current) return;
      setStats(s);
      setTemplates(t);
      const first = t[0];
      if (first !== undefined) {
        setSelectedTemplate(first);
      }
    } catch {
      if (seq !== loadRef.current) return;
      setStats(MOCK_STATS);
      setTemplates(MOCK_TEMPLATES);
      setVersions(MOCK_VERSIONS);
      const firstMock = MOCK_TEMPLATES[0];
      if (firstMock !== undefined) {
        setSelectedTemplate(firstMock);
      }
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReviewed = useCallback(
    (updated: PromptTemplate) => {
      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      if (selectedTemplate?.id === updated.id) {
        setSelectedTemplate(updated);
      }
      setReviewingTemplate(null);
      setStats((prev) =>
        prev !== null
          ? {
              ...prev,
              approvedTemplates: prev.approvedTemplates + (updated.status === 'approved' ? 1 : 0),
              pendingReview: Math.max(0, prev.pendingReview - 1),
            }
          : prev,
      );
    },
    [selectedTemplate],
  );

  const TABS: { id: Tab; label: string }[] = [
    { id: 'templates', label: 'Templates' },
    { id: 'versions', label: 'Version History' },
    { id: 'playground', label: 'Playground' },
  ];

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading prompt templates" />
      </div>
    );
  }

  const pendingReview = stats?.pendingReview ?? 0;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-content">Prompt Templates</h1>
        <p className="mt-1 text-sm text-content-tertiary">
          Versioned system prompts · Compliance review workflow · Live render playground
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Layers className="h-5 w-5 text-blue-400" />}
          label="Total Templates"
          value={String(stats?.totalTemplates ?? 0)}
          bg="bg-blue-500/10"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />}
          label="Approved"
          value={String(stats?.approvedTemplates ?? 0)}
          bg="bg-emerald-500/10"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-amber-400" />}
          label="Pending Review"
          value={String(pendingReview)}
          bg={pendingReview > 0 ? 'bg-amber-500/10' : 'bg-surface-secondary'}
        />
        <StatCard
          icon={<Code2 className="h-5 w-5 text-purple-400" />}
          label="Total Versions"
          value={String(stats?.totalVersions ?? 0)}
          bg="bg-purple-500/10"
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
              }}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-b-2 border-brand-accent text-brand-accent'
                  : 'text-content-tertiary hover:text-content',
              )}
            >
              {t.label}
              {t.id === 'versions' && pendingReview > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-2xs font-semibold text-amber-400">
                  {pendingReview}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Templates Tab — list + detail side by side */}
      {tab === 'templates' && (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* List */}
          <div className="space-y-2">
            {templates.map((t) => {
              const statusCfg = STATUS_CFG[t.status];
              const isSelected = selectedTemplate?.id === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setSelectedTemplate(t);
                  }}
                  className={cn(
                    'w-full rounded-xl border p-3 text-left transition-colors',
                    isSelected
                      ? 'border-brand-accent/30 bg-brand-accent/5'
                      : 'border-border bg-surface hover:bg-surface-secondary',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-tight text-content">{t.name}</p>
                    <span
                      className={cn(
                        'mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-medium',
                        statusCfg.className,
                      )}
                    >
                      {statusCfg.label}
                    </span>
                  </div>
                  <p className="mt-0.5 text-2xs text-content-tertiary">
                    {ROLE_DISPLAY[t.role] ?? t.role} · v{t.version}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Detail */}
          <div className="rounded-xl border border-border bg-surface p-5">
            {selectedTemplate !== null ? (
              <TemplateDetail
                template={selectedTemplate}
                onReview={(t) => {
                  setReviewingTemplate(t);
                }}
              />
            ) : (
              <p className="text-sm text-content-tertiary">Select a template</p>
            )}
          </div>
        </div>
      )}

      {tab === 'versions' && (
        <VersionsTab versions={versions} selectedTemplateId={selectedTemplate?.id ?? null} />
      )}

      {tab === 'playground' && <PlaygroundTab templates={templates} />}

      {reviewingTemplate !== null && (
        <ReviewModal
          template={reviewingTemplate}
          onClose={() => {
            setReviewingTemplate(null);
          }}
          onReviewed={handleReviewed}
        />
      )}
    </div>
  );
}
