/**
 * DemoCompliance — ORDR-Connect Compliance Center
 *
 * Continuous monitoring dashboard for SOC 2 Type II, ISO 27001:2022, and HIPAA.
 * Displays overall KPI metrics, per-pillar compliance gauges, a control status
 * matrix, WORM audit chain integrity, and open violation tracking.
 *
 * COMPLIANCE:
 * - No PHI in demo data (Rule 6)
 * - No secrets exposed (Rule 5)
 * - All data is synthetic mock data
 */

import { type ReactNode, useState } from 'react';
import {
  ShieldCheck,
  Shield,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Eye,
  Key,
  Activity,
  Database,
  Check,
  ArrowRight,
  Layers,
  ScanLine,
} from '../../components/icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KpiCard {
  label: string;
  value: string;
  color: 'emerald' | 'blue' | 'amber';
  icon: React.ComponentType<{ className?: string }>;
}

interface ControlCategory {
  name: string;
  status: 'pass' | 'warn';
  count?: number;
}

interface Pillar {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  score: number;
  status: 'Compliant' | 'At Risk' | 'Non-Compliant';
  passing: number;
  total: number;
  remediating: number;
  lastAudit: string;
  nextAudit: string;
  categories: ControlCategory[];
}

interface ControlRow {
  id: string;
  name: string;
  standard: 'SOC 2' | 'ISO 27001' | 'HIPAA';
  status: 'pass' | 'remediation' | 'fail';
  lastChecked: string;
}

interface Violation {
  id: string;
  severity: 'medium' | 'low';
  controlRef: string;
  description: string;
  deadline: string;
}

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const OVERALL_KPIS: KpiCard[] = [
  { label: 'Overall Score', value: '97.2%', color: 'emerald', icon: ShieldCheck },
  { label: 'Controls Passing', value: '271 / 278', color: 'blue', icon: CheckCircle2 },
  { label: 'Open Violations', value: '3', color: 'amber', icon: AlertTriangle },
];

const PILLARS: Pillar[] = [
  {
    id: 'soc2',
    name: 'SOC 2 Type II',
    icon: Shield,
    score: 98.4,
    status: 'Compliant',
    passing: 93,
    total: 93,
    remediating: 0,
    lastAudit: '2026-01-15',
    nextAudit: '2026-07-15',
    categories: [
      { name: 'Access Control', status: 'pass' },
      { name: 'Encryption', status: 'pass' },
      { name: 'Audit Logging', status: 'pass' },
      { name: 'Change Mgmt', status: 'pass' },
    ],
  },
  {
    id: 'iso27001',
    name: 'ISO 27001:2022',
    icon: Lock,
    score: 96.1,
    status: 'Compliant',
    passing: 89,
    total: 93,
    remediating: 4,
    lastAudit: '2025-11-20',
    nextAudit: '2026-05-20',
    categories: [
      { name: 'Information Security', status: 'pass' },
      { name: 'People Controls', status: 'pass' },
      { name: 'Physical', status: 'pass' },
      { name: 'Tech Controls', status: 'warn', count: 4 },
    ],
  },
  {
    id: 'hipaa',
    name: 'HIPAA',
    icon: Key,
    score: 97.2,
    status: 'Compliant',
    passing: 89,
    total: 92,
    remediating: 3,
    lastAudit: '2026-02-10',
    nextAudit: '2026-08-10',
    categories: [
      { name: 'Technical Safeguards', status: 'pass' },
      { name: 'Admin Safeguards', status: 'pass' },
      { name: 'Physical Safeguards', status: 'pass' },
      { name: 'PHI Handling', status: 'warn', count: 3 },
    ],
  },
];

const CONTROLS: ControlRow[] = [
  {
    id: 'CC6.1',
    name: 'Logical Access Controls',
    standard: 'SOC 2',
    status: 'pass',
    lastChecked: '2026-03-25 08:14',
  },
  {
    id: 'A.8.2',
    name: 'Privileged Access',
    standard: 'ISO 27001',
    status: 'pass',
    lastChecked: '2026-03-25 08:14',
  },
  {
    id: '\u00a7164.312(a)',
    name: 'Access Control',
    standard: 'HIPAA',
    status: 'pass',
    lastChecked: '2026-03-25 07:50',
  },
  {
    id: 'CC7.2',
    name: 'System Monitoring',
    standard: 'SOC 2',
    status: 'pass',
    lastChecked: '2026-03-25 08:01',
  },
  {
    id: 'A.8.24',
    name: 'Cryptography',
    standard: 'ISO 27001',
    status: 'remediation',
    lastChecked: '2026-03-24 22:30',
  },
  {
    id: '\u00a7164.312(e)',
    name: 'Transmission Security',
    standard: 'HIPAA',
    status: 'remediation',
    lastChecked: '2026-03-24 21:45',
  },
  {
    id: 'CC6.3',
    name: 'Role-Based Access',
    standard: 'SOC 2',
    status: 'pass',
    lastChecked: '2026-03-25 08:14',
  },
  {
    id: 'A.5.1',
    name: 'Information Security Policies',
    standard: 'ISO 27001',
    status: 'pass',
    lastChecked: '2026-03-25 06:00',
  },
  {
    id: '\u00a7164.308(a)',
    name: 'Security Management',
    standard: 'HIPAA',
    status: 'pass',
    lastChecked: '2026-03-25 07:50',
  },
  {
    id: 'CC8.1',
    name: 'Change Management',
    standard: 'SOC 2',
    status: 'pass',
    lastChecked: '2026-03-25 08:10',
  },
  {
    id: 'A.8.9',
    name: 'Configuration Mgmt',
    standard: 'ISO 27001',
    status: 'remediation',
    lastChecked: '2026-03-24 18:00',
  },
  {
    id: '\u00a7164.312(c)',
    name: 'Integrity Controls',
    standard: 'HIPAA',
    status: 'remediation',
    lastChecked: '2026-03-24 20:15',
  },
];

const VIOLATIONS: Violation[] = [
  {
    id: 'VIO-0041',
    severity: 'medium',
    controlRef: 'A.8.24 — Cryptography',
    description:
      'TLS 1.2 fallback detected on legacy integration endpoint; upgrade to TLS 1.3 required.',
    deadline: '2026-04-10',
  },
  {
    id: 'VIO-0042',
    severity: 'medium',
    controlRef: '\u00a7164.312(e) — Transmission Security',
    description: 'Certificate pinning not enforced on mobile SDK channel adapter.',
    deadline: '2026-04-08',
  },
  {
    id: 'VIO-0043',
    severity: 'low',
    controlRef: 'A.8.9 — Configuration Mgmt',
    description: 'Non-production environment config drift detected; last sync 14 days ago.',
    deadline: '2026-04-15',
  },
];

const AUDIT_CHAIN = {
  integrity: 'Verified' as const,
  totalEvents: '1,847,293',
  lastHash: 'a4f8c1e9d37b2054ef91bc...72d6',
  merkleRoot: '8b21f0ce44a7d903516eab...e1f3',
  chainLength: '1,847,293',
  unbrokenSince: '2025-06-01',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLOR_MAP = {
  emerald: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    stroke: '#34d399',
  },
  blue: {
    text: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    stroke: '#60a5fa',
  },
  amber: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    stroke: '#fbbf24',
  },
  purple: {
    text: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/20',
    stroke: '#c084fc',
  },
  red: {
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    stroke: '#f87171',
  },
} as const;

function pillarColor(score: number): keyof typeof COLOR_MAP {
  if (score >= 97) return 'emerald';
  if (score >= 90) return 'blue';
  if (score >= 80) return 'amber';
  return 'red';
}

function statusDot(status: ControlRow['status']): string {
  if (status === 'pass') return 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]';
  if (status === 'remediation') return 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]';
  return 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]';
}

function statusLabel(status: ControlRow['status']): string {
  if (status === 'pass') return 'Pass';
  if (status === 'remediation') return 'Remediation';
  return 'Fail';
}

function standardBadgeClass(standard: ControlRow['standard']): string {
  if (standard === 'SOC 2') return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
  if (standard === 'ISO 27001') return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
  return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ComplianceGauge({ score, color }: { score: number; color: string }): ReactNode {
  const circumference = 2 * Math.PI * 52;
  const filled = (score / 100) * circumference;
  const gap = circumference - filled;

  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28">
      <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
      <circle
        cx="60"
        cy="60"
        r="52"
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeDasharray={`${filled} ${gap}`}
        strokeDashoffset={circumference * 0.25}
        strokeLinecap="round"
        transform="rotate(-90 60 60)"
      />
      <text
        x="60"
        y="55"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-white font-mono text-xl font-bold"
      >
        {score}%
      </text>
      <text
        x="60"
        y="72"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-slate-500 font-mono text-[8px] uppercase tracking-widest"
      >
        SCORE
      </text>
    </svg>
  );
}

function StatusBadge({ status }: { status: Pillar['status'] }): ReactNode {
  const map: Record<Pillar['status'], string> = {
    Compliant: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    'At Risk': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    'Non-Compliant': 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${map[status]}`}
    >
      {status === 'Compliant' && <Check className="h-3 w-3" />}
      {status === 'At Risk' && <AlertTriangle className="h-3 w-3" />}
      {status}
    </span>
  );
}

function PillarCard({
  pillar,
  isSelected,
  onSelect,
}: {
  pillar: Pillar;
  isSelected: boolean;
  onSelect: () => void;
}): ReactNode {
  const Icon = pillar.icon;
  const cKey = pillarColor(pillar.score);
  const c = COLOR_MAP[cKey];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col items-center gap-4 rounded-xl border p-5 text-left backdrop-blur-md transition-all duration-200
        ${
          isSelected
            ? `border-${cKey === 'emerald' ? 'emerald' : cKey === 'blue' ? 'blue' : 'amber'}-500/30 bg-[#0d0d12]/90 ring-1 ring-${cKey === 'emerald' ? 'emerald' : cKey === 'blue' ? 'blue' : 'amber'}-500/10`
            : 'border-white/5 bg-[#0d0d12]/80 hover:border-white/10'
        }`}
    >
      {/* Header */}
      <div className="flex w-full items-center gap-3">
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.bg} ${c.border} border`}
        >
          <Icon className={`h-4 w-4 ${c.text}`} />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white">{pillar.name}</h3>
          <StatusBadge status={pillar.status} />
        </div>
      </div>

      {/* Gauge */}
      <ComplianceGauge score={pillar.score} color={c.stroke} />

      {/* Metrics */}
      <div className="grid w-full grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Passing</p>
          <p className="font-mono text-lg font-bold text-white">
            {pillar.passing}
            <span className="text-sm text-slate-500">/{pillar.total}</span>
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Remediation
          </p>
          <p
            className={`font-mono text-lg font-bold ${pillar.remediating > 0 ? 'text-amber-400' : 'text-emerald-400'}`}
          >
            {pillar.remediating}
          </p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Last Audit
          </p>
          <p className="font-mono text-xs text-slate-300">{pillar.lastAudit}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Next Audit
          </p>
          <p className="font-mono text-xs text-slate-300">{pillar.nextAudit}</p>
        </div>
      </div>

      {/* Categories */}
      <div className="w-full space-y-1.5 border-t border-white/5 pt-3">
        {pillar.categories.map((cat) => (
          <div key={cat.name} className="flex items-center justify-between">
            <span className="text-xs text-slate-400">{cat.name}</span>
            {cat.status === 'pass' ? (
              <span className="flex items-center gap-1 font-mono text-[10px] text-emerald-400">
                <CheckCircle2 className="h-3 w-3" /> Pass
              </span>
            ) : (
              <span className="flex items-center gap-1 font-mono text-[10px] text-amber-400">
                <AlertTriangle className="h-3 w-3" /> {cat.count}
              </span>
            )}
          </div>
        ))}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function DemoCompliance(): ReactNode {
  const [selectedPillar, setSelectedPillar] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      {/* ---- Page Header ---- */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Compliance Center</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            SOC 2 &middot; ISO 27001 &middot; HIPAA &mdash; Continuous monitoring
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-slate-500">
          <Activity className="h-3 w-3 text-emerald-400" />
          <span>
            Last scan: <span className="text-slate-300">2026-03-25 08:14 UTC</span>
          </span>
        </div>
      </div>

      {/* ---- Overall KPI Row ---- */}
      <div className="grid grid-cols-3 gap-4">
        {OVERALL_KPIS.map((kpi) => {
          const c = COLOR_MAP[kpi.color];
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className={`rounded-xl border ${c.border} ${c.bg} flex items-center gap-4 p-4 backdrop-blur-md`}
            >
              <div
                className={`flex h-11 w-11 items-center justify-center rounded-lg border ${c.border} bg-black/30`}
              >
                <Icon className={`h-5 w-5 ${c.text}`} />
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  {kpi.label}
                </p>
                <p className={`font-mono text-3xl font-bold ${c.text}`}>{kpi.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---- Three Pillar Cards ---- */}
      <div className="grid grid-cols-3 gap-4">
        {PILLARS.map((pillar) => (
          <PillarCard
            key={pillar.id}
            pillar={pillar}
            isSelected={selectedPillar === pillar.id}
            onSelect={() => {
              setSelectedPillar(selectedPillar === pillar.id ? null : pillar.id);
            }}
          />
        ))}
      </div>

      {/* ---- Bottom: Control Matrix + Audit/Violations ---- */}
      <div className="grid min-h-0 flex-1 grid-cols-5 gap-4">
        {/* Control Status Matrix — 3 cols */}
        <div className="demo-scrollbar col-span-3 overflow-y-auto rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
          <div className="mb-4 flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Control Status Matrix</h2>
            <span className="ml-auto font-mono text-[10px] text-slate-500">
              {CONTROLS.length} controls
            </span>
          </div>

          {/* Table Header */}
          <div className="mb-1 grid grid-cols-[80px_1fr_90px_100px_130px] gap-2 px-2 font-mono text-[10px] uppercase tracking-widest text-slate-600">
            <span>ID</span>
            <span>Control</span>
            <span>Standard</span>
            <span>Status</span>
            <span>Last Checked</span>
          </div>

          {/* Rows */}
          <div className="space-y-0.5">
            {CONTROLS.map((ctrl) => (
              <div
                key={ctrl.id}
                className="grid grid-cols-[80px_1fr_90px_100px_130px] items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.02]"
              >
                <span className="font-mono text-xs text-slate-300">{ctrl.id}</span>
                <span className="truncate text-xs text-slate-400">{ctrl.name}</span>
                <span
                  className={`inline-flex w-fit rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${standardBadgeClass(ctrl.standard)}`}
                >
                  {ctrl.standard}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${statusDot(ctrl.status)}`} />
                  <span
                    className={`font-mono text-[10px] ${
                      ctrl.status === 'pass'
                        ? 'text-emerald-400'
                        : ctrl.status === 'remediation'
                          ? 'text-amber-400'
                          : 'text-red-400'
                    }`}
                  >
                    {statusLabel(ctrl.status)}
                  </span>
                </span>
                <span className="font-mono text-[10px] text-slate-600">{ctrl.lastChecked}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Audit Chain + Violations — 2 cols */}
        <div className="demo-scrollbar col-span-2 flex flex-col gap-4 overflow-y-auto">
          {/* WORM Audit Chain */}
          <div className="rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
            <div className="mb-4 flex items-center gap-2">
              <Layers className="h-4 w-4 text-purple-400" />
              <h2 className="text-sm font-semibold text-white">WORM Audit Chain</h2>
            </div>

            {/* Integrity Badge */}
            <div className="mb-4 flex items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span className="font-mono text-xs font-semibold text-emerald-400">
                  Chain Integrity: Verified
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Total Events
                </span>
                <span className="font-mono text-sm font-bold text-white">
                  {AUDIT_CHAIN.totalEvents}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Last Hash
                </span>
                <span className="font-mono text-[10px] text-slate-400">{AUDIT_CHAIN.lastHash}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Merkle Root
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  {AUDIT_CHAIN.merkleRoot}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Chain Length
                </span>
                <span className="font-mono text-sm text-white">{AUDIT_CHAIN.chainLength}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Unbroken Since
                </span>
                <span className="font-mono text-xs text-emerald-400">
                  {AUDIT_CHAIN.unbrokenSince}
                </span>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-3">
              <Database className="h-3 w-3 text-slate-600" />
              <span className="font-mono text-[10px] text-slate-600">
                S3 Object Lock (Compliance) + PostgreSQL WORM triggers
              </span>
            </div>
          </div>

          {/* Open Violations */}
          <div className="flex-1 rounded-xl border border-white/5 bg-[#0d0d12]/80 p-4 backdrop-blur-md">
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-white">Open Violations</h2>
              <span className="ml-auto rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-400">
                {VIOLATIONS.length}
              </span>
            </div>

            <div className="space-y-3">
              {VIOLATIONS.map((v) => (
                <div
                  key={v.id}
                  className="rounded-lg border border-white/5 bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                        v.severity === 'medium'
                          ? 'border-amber-500/20 bg-amber-500/10 text-amber-400'
                          : 'border-blue-500/20 bg-blue-500/10 text-blue-400'
                      }`}
                    >
                      {v.severity}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">{v.id}</span>
                  </div>
                  <p className="mb-1 font-mono text-[10px] font-semibold text-slate-300">
                    {v.controlRef}
                  </p>
                  <p className="mb-2 text-xs leading-relaxed text-slate-500">{v.description}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-slate-600" />
                      <span className="font-mono text-[10px] text-slate-600">
                        Due: {v.deadline}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-slate-400 transition-colors hover:border-amber-500/30 hover:text-amber-400"
                    >
                      <Eye className="h-3 w-3" />
                      Assign
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
