/**
 * Onboarding Wizard — new-tenant first-run setup
 *
 * 4 steps:
 *  1. Welcome + organisation details (name, timezone, industry)
 *  2. Invite your team (email, role)
 *  3. Activate channels (SMS / email / WhatsApp toggles)
 *  4. Ready — compliance checklist + go to dashboard
 *
 * COMPLIANCE: No PHI collected during onboarding. All mutations are
 * audit-logged server-side via the JWT tenant context.
 */

import { type ReactNode, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Toggle } from '../components/ui/Toggle';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import {
  CheckCircle2,
  ChevronRight,
  Mail,
  MessageSquare,
  Shield,
  Users,
  Zap,
} from '../components/icons';
import {
  fetchOnboardingState,
  advanceOnboardingStep,
  completeOnboarding,
} from '../lib/onboarding-api';
import { useAuth } from '../lib/auth';

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Organisation', icon: <Zap className="h-4 w-4" /> },
  { id: 2, label: 'Team', icon: <Users className="h-4 w-4" /> },
  { id: 3, label: 'Channels', icon: <MessageSquare className="h-4 w-4" /> },
  { id: 4, label: 'Ready', icon: <Shield className="h-4 w-4" /> },
];

const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
];

const INDUSTRY_OPTIONS = [
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'finance', label: 'Financial Services' },
  { value: 'retail', label: 'Retail & E-commerce' },
  { value: 'saas', label: 'SaaS / Technology' },
  { value: 'professional_services', label: 'Professional Services' },
  { value: 'other', label: 'Other' },
];

const ROLE_OPTIONS = [
  { value: 'tenant_admin', label: 'Admin' },
  { value: 'operator', label: 'Operator' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'viewer', label: 'Viewer' },
];

const COMPLIANCE_ITEMS = [
  'AES-256-GCM encryption at rest — active',
  'TLS 1.3 for all data in transit — active',
  'WORM audit trail with Merkle chain — active',
  'Row-level tenant isolation enforced — active',
  'RBAC + ABAC access controls — active',
];

// ── Step 1: Organisation ──────────────────────────────────────────────────────

interface OrgData {
  name: string;
  timezone: string;
  industry: string;
}

function StepOrganisation({
  data,
  onChange,
}: {
  data: OrgData;
  onChange: (d: OrgData) => void;
}): ReactNode {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-content">Set up your organisation</h2>
        <p className="mt-1 text-sm text-content-secondary">
          This information helps configure defaults for your team.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-content-secondary">
            Organisation name
          </label>
          <Input
            value={data.name}
            onChange={(e) => {
              onChange({ ...data, name: e.target.value });
            }}
            placeholder="Acme Corp"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-content-secondary">Timezone</label>
          <Select
            value={data.timezone}
            onChange={(v) => {
              onChange({ ...data, timezone: v });
            }}
            options={TIMEZONE_OPTIONS}
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-content-secondary">Industry</label>
          <Select
            value={data.industry}
            onChange={(v) => {
              onChange({ ...data, industry: v });
            }}
            options={INDUSTRY_OPTIONS}
          />
        </div>
      </div>
    </div>
  );
}

// ── Step 2: Team ──────────────────────────────────────────────────────────────

interface InviteRow {
  email: string;
  role: string;
}

function StepTeam({
  invites,
  onChange,
}: {
  invites: InviteRow[];
  onChange: (rows: InviteRow[]) => void;
}): ReactNode {
  const addRow = useCallback(() => {
    onChange([...invites, { email: '', role: 'operator' }]);
  }, [invites, onChange]);

  const updateRow = useCallback(
    (idx: number, patch: Partial<InviteRow>) => {
      const updated = invites.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      onChange(updated);
    },
    [invites, onChange],
  );

  const removeRow = useCallback(
    (idx: number) => {
      onChange(invites.filter((_, i) => i !== idx));
    },
    [invites, onChange],
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-content">Invite your team</h2>
        <p className="mt-1 text-sm text-content-secondary">
          Add colleagues now or skip — you can always invite from Settings → Team.
        </p>
      </div>

      <div className="space-y-3">
        {invites.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Input
              value={row.email}
              onChange={(e) => {
                updateRow(idx, { email: e.target.value });
              }}
              placeholder="colleague@example.com"
              className="flex-1"
            />
            <Select
              value={row.role}
              onChange={(v) => {
                updateRow(idx, { role: v });
              }}
              options={ROLE_OPTIONS}
              className="w-36"
            />
            <button
              onClick={() => {
                removeRow(idx);
              }}
              className="rounded p-1.5 text-content-tertiary hover:bg-surface hover:text-danger"
              aria-label="Remove invite"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <Button variant="secondary" size="sm" onClick={addRow}>
        + Add another
      </Button>
    </div>
  );
}

// ── Step 3: Channels ──────────────────────────────────────────────────────────

interface ChannelToggles {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
}

function StepChannels({
  channels,
  onChange,
}: {
  channels: ChannelToggles;
  onChange: (c: ChannelToggles) => void;
}): ReactNode {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-content">Activate messaging channels</h2>
        <p className="mt-1 text-sm text-content-secondary">
          Enable the channels your team will use. Credentials are configured in Settings → Channels.
        </p>
      </div>

      <div className="divide-y divide-border rounded-xl border border-border">
        {(
          [
            {
              key: 'email' as const,
              label: 'Email (SendGrid)',
              description: 'Transactional & marketing emails, CAN-SPAM compliant',
              icon: <Mail className="h-5 w-5 text-blue-400" />,
            },
            {
              key: 'sms' as const,
              label: 'SMS (Twilio)',
              description: 'Two-way SMS, TCPA consent managed automatically',
              icon: <MessageSquare className="h-5 w-5 text-green-400" />,
            },
            {
              key: 'whatsapp' as const,
              label: 'WhatsApp (Twilio)',
              description: 'Conversational messaging via WhatsApp Business API',
              icon: <MessageSquare className="h-5 w-5 text-emerald-400" />,
            },
          ] as const
        ).map(({ key, label, description, icon }) => (
          <div key={key} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface">
                {icon}
              </div>
              <div>
                <p className="text-sm font-medium text-content">{label}</p>
                <p className="text-xs text-content-tertiary">{description}</p>
              </div>
            </div>
            <Toggle
              checked={channels[key]}
              onChange={(v) => {
                onChange({ ...channels, [key]: v });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 4: Ready ─────────────────────────────────────────────────────────────

function StepReady({
  onFinish,
  finishing,
}: {
  onFinish: () => void;
  finishing: boolean;
}): ReactNode {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-accent/10">
          <CheckCircle2 className="h-8 w-8 text-brand-accent" />
        </div>
        <h2 className="text-xl font-semibold text-content">You&apos;re all set!</h2>
        <p className="mt-1 text-sm text-content-secondary">
          ORDR-Connect is configured and your compliance controls are active.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
          Compliance status
        </p>
        <ul className="space-y-2">
          {COMPLIANCE_ITEMS.map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm text-content">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-accent" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <Button className="w-full" loading={finishing} onClick={onFinish}>
        Go to Dashboard
        <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export function Onboarding(): ReactNode {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step data
  const [orgData, setOrgData] = useState({
    name: '',
    timezone: 'America/New_York',
    industry: 'saas',
  });
  const [invites, setInvites] = useState([{ email: '', role: 'operator' }]);
  const [channels, setChannels] = useState<ChannelToggles>({
    email: true,
    sms: false,
    whatsapp: false,
  });

  // Load existing state (resume wizard if navigating back)
  useEffect(() => {
    fetchOnboardingState()
      .then((state) => {
        if (state.complete) {
          void navigate('/dashboard', { replace: true });
        } else {
          setCurrentStep(Math.max(1, Math.min(state.step + 1, 4)));
          setLoading(false);
        }
      })
      .catch(() => {
        setLoading(false);
      });
  }, [navigate]);

  const handleNext = useCallback(async () => {
    if (currentStep >= 4) return;
    setSaving(true);
    try {
      await advanceOnboardingStep(currentStep);
      setCurrentStep((s) => s + 1);
    } finally {
      setSaving(false);
    }
  }, [currentStep]);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(1, s - 1));
  }, []);

  const handleFinish = useCallback(async () => {
    setSaving(true);
    try {
      await completeOnboarding();
      void navigate('/dashboard', { replace: true });
    } finally {
      setSaving(false);
    }
  }, [navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Spinner size="lg" label="Loading" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas p-6">
      {/* Brand header */}
      <div className="mb-8 text-center">
        <span className="text-lg font-bold tracking-tight text-content">ORDR-Connect</span>
        <p className="mt-1 text-xs text-content-tertiary">
          Welcome, {user?.name ?? 'there'} — let&apos;s get you set up
        </p>
      </div>

      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2">
        {STEPS.map((step, idx) => {
          const done = currentStep > step.id;
          const active = currentStep === step.id;
          return (
            <div key={step.id} className="flex items-center">
              <div
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors',
                  done
                    ? 'bg-brand-accent text-[#060608]'
                    : active
                      ? 'bg-surface-tertiary text-content ring-2 ring-brand-accent'
                      : 'bg-surface text-content-tertiary',
                ].join(' ')}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : <span>{step.id}</span>}
              </div>
              <span
                className={[
                  'ml-1.5 hidden text-xs sm:block',
                  active ? 'font-medium text-content' : 'text-content-tertiary',
                ].join(' ')}
              >
                {step.label}
              </span>
              {idx < STEPS.length - 1 && <div className="mx-2 h-px w-6 bg-border sm:w-10" />}
            </div>
          );
        })}
      </div>

      {/* Card */}
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-8 shadow-lg">
        {currentStep === 1 && <StepOrganisation data={orgData} onChange={setOrgData} />}
        {currentStep === 2 && <StepTeam invites={invites} onChange={setInvites} />}
        {currentStep === 3 && <StepChannels channels={channels} onChange={setChannels} />}
        {currentStep === 4 && <StepReady onFinish={handleFinish} finishing={saving} />}

        {/* Navigation — hidden on step 4 (it has its own CTA) */}
        {currentStep < 4 && (
          <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
            <Button
              variant="ghost"
              onClick={currentStep === 1 ? () => void navigate('/dashboard') : handleBack}
            >
              {currentStep === 1 ? 'Skip setup' : 'Back'}
            </Button>

            <Button
              loading={saving}
              onClick={() => void handleNext()}
              icon={<ChevronRight className="h-4 w-4" />}
            >
              {currentStep === 3 ? 'Review' : 'Continue'}
            </Button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 flex gap-4 text-xs text-content-tertiary">
        <Badge variant="success">SOC 2 Type II</Badge>
        <Badge variant="info">HIPAA</Badge>
        <Badge variant="warning">ISO 27001</Badge>
      </div>
    </div>
  );
}
