import { type ReactNode, useEffect, useState, useRef, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  Bot,
  Activity,
  Zap,
  Lock,
  Globe,
  Heart,
  Building2,
  Briefcase,
  Users,
  Phone,
  ArrowUpRight,
  ChevronRight,
  CheckCircle2,
  Mail,
  MessageSquare,
  Cpu,
  Target,
  Eye,
  FileText,
} from '../components/icons';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useCountUp(target: number, duration = 2000, start = false): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    let t0: number | null = null;
    let raf: number;
    const tick = (ts: number) => {
      if (t0 === null) t0 = ts;
      const p = Math.min((ts - t0) / duration, 1);
      setValue(Math.floor((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [target, duration, start]);
  return value;
}

function useInView(threshold = 0.2): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting === true) setVisible(true);
      },
      { threshold },
    );
    obs.observe(el);
    return () => {
      obs.disconnect();
    };
  }, [threshold]);
  return [ref, visible];
}

// ---------------------------------------------------------------------------
// SVG — Architecture Diagram  (Six-primitive topology)
// ---------------------------------------------------------------------------

function ArchitectureDiagram(): ReactNode {
  const id = useId();
  const nodes = [
    { id: 'graph', label: 'Customer\nGraph', x: 140, y: 60, color: '#3b82f6' },
    { id: 'stream', label: 'Event\nStream', x: 380, y: 60, color: '#10b981' },
    { id: 'decision', label: 'Decision\nEngine', x: 620, y: 60, color: '#f59e0b' },
    { id: 'agent', label: 'Agent\nRuntime', x: 620, y: 220, color: '#8b5cf6' },
    { id: 'exec', label: 'Execution\nLayer', x: 380, y: 220, color: '#ec4899' },
    { id: 'govern', label: 'Governance\nLayer', x: 140, y: 220, color: '#06b6d4' },
  ];
  const edges: [string, string][] = [
    ['graph', 'stream'],
    ['stream', 'decision'],
    ['decision', 'agent'],
    ['agent', 'exec'],
    ['exec', 'govern'],
    ['govern', 'graph'],
    ['stream', 'govern'],
    ['decision', 'exec'],
    ['graph', 'agent'],
  ];
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <svg viewBox="0 0 760 300" className="w-full" aria-label="ORDR-Connect architecture topology">
      <defs>
        {nodes.map((n) => (
          <radialGradient key={n.id} id={`${id}-g-${n.id}`} cx="50%" cy="30%">
            <stop offset="0%" stopColor={n.color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={n.color} stopOpacity="0.05" />
          </radialGradient>
        ))}
        <marker
          id={`${id}-arrow`}
          viewBox="0 0 10 7"
          refX="10"
          refY="3.5"
          markerWidth="6"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 3.5 L 0 7" fill="rgba(148,163,184,0.3)" />
        </marker>
      </defs>
      {edges.map(([a, b]) => {
        const na = nodeMap[a];
        const nb = nodeMap[b];
        if (na === undefined || nb === undefined) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={na.x}
            y1={na.y}
            x2={nb.x}
            y2={nb.y}
            stroke="rgba(148,163,184,0.12)"
            strokeWidth="1"
            markerEnd={`url(#${id}-arrow)`}
          />
        );
      })}
      {nodes.map((n) => (
        <g key={n.id}>
          <circle
            cx={n.x}
            cy={n.y}
            r="44"
            fill={`url(#${id}-g-${n.id})`}
            stroke={n.color}
            strokeWidth="1"
            strokeOpacity="0.4"
          />
          <circle cx={n.x} cy={n.y} r="5" fill={n.color} opacity="0.8" />
          {n.label.split('\n').map((line, i) => (
            <text
              key={i}
              x={n.x}
              y={n.y + 18 + i * 13}
              textAnchor="middle"
              fill="#94a3b8"
              fontSize="10"
              fontFamily="Inter, system-ui, sans-serif"
            >
              {line}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SVG — Event Flow Pipeline
// ---------------------------------------------------------------------------

function EventFlowDiagram(): ReactNode {
  const stages = [
    { label: 'Signal Ingestion', sub: 'Webhook / API / Channel', color: '#3b82f6', icon: 'IN' },
    { label: 'Event Stream', sub: 'Kafka — Append-Only Log', color: '#10b981', icon: 'ES' },
    { label: 'Decision Engine', sub: 'Rules + ML + LLM', color: '#f59e0b', icon: 'DE' },
    { label: 'Agent Runtime', sub: 'LangGraph Orchestration', color: '#8b5cf6', icon: 'AR' },
    { label: 'Channel Exec', sub: 'SMS / Email / Voice / Chat', color: '#ec4899', icon: 'EX' },
    { label: 'Audit + WORM', sub: 'Merkle DAG / Hash Chain', color: '#06b6d4', icon: 'AU' },
  ];

  return (
    <div className="relative flex flex-col gap-0 sm:flex-row sm:items-center sm:gap-0">
      {stages.map((s, i) => (
        <div key={s.label} className="flex items-center">
          <div className="group relative flex flex-col items-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-xl border transition-all duration-300 hover:scale-105"
              style={{ borderColor: `${s.color}40`, background: `${s.color}08` }}
            >
              <span className="font-mono text-xs font-bold" style={{ color: s.color }}>
                {s.icon}
              </span>
            </div>
            <div className="mt-2 text-center">
              <p className="text-xs font-semibold text-content">{s.label}</p>
              <p className="text-2xs text-content-tertiary">{s.sub}</p>
            </div>
          </div>
          {i < stages.length - 1 && (
            <div
              className="mx-1 hidden h-px w-6 sm:block"
              style={{
                background: `linear-gradient(to right, ${s.color}40, ${stages[i + 1]?.color ?? s.color}40)`,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG — Merkle Audit Chain
// ---------------------------------------------------------------------------

function AuditChainDiagram(): ReactNode {
  const id = useId();
  return (
    <svg viewBox="0 0 600 200" className="w-full" aria-label="Merkle DAG audit chain">
      <defs>
        <linearGradient id={`${id}-grad`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.6" />
        </linearGradient>
      </defs>
      {/* Hash chain — bottom row */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        const x = 50 + i * 78;
        return (
          <g key={`evt-${i}`}>
            <rect
              x={x - 22}
              y={145}
              width="44"
              height="28"
              rx="4"
              fill="rgba(16,185,129,0.06)"
              stroke="rgba(16,185,129,0.25)"
              strokeWidth="1"
            />
            <text
              x={x}
              y={163}
              textAnchor="middle"
              fill="#94a3b8"
              fontSize="8"
              fontFamily="JetBrains Mono, monospace"
            >
              E{String(i + 1).padStart(3, '0')}
            </text>
            {i < 6 && (
              <line
                x1={x + 22}
                y1={159}
                x2={x + 56}
                y2={159}
                stroke="rgba(16,185,129,0.2)"
                strokeWidth="1"
                strokeDasharray="3,3"
              />
            )}
          </g>
        );
      })}
      {/* Merkle tree — pairs */}
      {[0, 1, 2].map((i) => {
        const x = 89 + i * 156;
        const lx = 50 + i * 2 * 78;
        const rx = 50 + (i * 2 + 1) * 78;
        return (
          <g key={`m1-${i}`}>
            <rect
              x={x - 24}
              y={95}
              width="48"
              height="24"
              rx="4"
              fill="rgba(6,182,212,0.06)"
              stroke="rgba(6,182,212,0.2)"
              strokeWidth="1"
            />
            <text
              x={x}
              y={111}
              textAnchor="middle"
              fill="#67e8f9"
              fontSize="7"
              fontFamily="JetBrains Mono, monospace"
            >
              H({i * 2 + 1},{i * 2 + 2})
            </text>
            <line x1={lx} y1={145} x2={x} y2={119} stroke="rgba(6,182,212,0.15)" strokeWidth="1" />
            <line x1={rx} y1={145} x2={x} y2={119} stroke="rgba(6,182,212,0.15)" strokeWidth="1" />
          </g>
        );
      })}
      {/* Merkle tree — next level */}
      {[0, 1].map((i) => {
        const x = 167 + i * 234;
        const lx = 89 + (i === 0 ? 0 : 2) * 156;
        const rx = 89 + (i === 0 ? 1 : 2) * 156;
        return (
          <g key={`m2-${i}`}>
            <rect
              x={x - 28}
              y={50}
              width="56"
              height="24"
              rx="4"
              fill="rgba(6,182,212,0.08)"
              stroke="rgba(6,182,212,0.25)"
              strokeWidth="1"
            />
            <text
              x={x}
              y={66}
              textAnchor="middle"
              fill="#67e8f9"
              fontSize="7"
              fontFamily="JetBrains Mono, monospace"
            >
              H({i * 4 + 1}..{i * 4 + 4})
            </text>
            <line x1={lx} y1={95} x2={x} y2={74} stroke="rgba(6,182,212,0.15)" strokeWidth="1" />
            <line x1={rx} y1={95} x2={x} y2={74} stroke="rgba(6,182,212,0.15)" strokeWidth="1" />
          </g>
        );
      })}
      {/* Root */}
      <rect
        x={268}
        y={10}
        width="64"
        height="26"
        rx="6"
        fill={`url(#${id}-grad)`}
        fillOpacity="0.15"
        stroke={`url(#${id}-grad)`}
        strokeWidth="1"
      />
      <text
        x={300}
        y={27}
        textAnchor="middle"
        fill="#5eead4"
        fontSize="8"
        fontWeight="bold"
        fontFamily="JetBrains Mono, monospace"
      >
        MERKLE ROOT
      </text>
      <line x1={167} y1={50} x2={300} y2={36} stroke="rgba(6,182,212,0.15)" strokeWidth="1" />
      <line x1={401} y1={50} x2={300} y2={36} stroke="rgba(6,182,212,0.15)" strokeWidth="1" />
      {/* Label */}
      <text x={500} y={24} fill="#475569" fontSize="8" fontFamily="Inter, system-ui, sans-serif">
        SHA-256 Hash Chain
      </text>
      <text x={500} y={36} fill="#475569" fontSize="8" fontFamily="Inter, system-ui, sans-serif">
        Batch verification every 1,000 events
      </text>
      <text x={500} y={48} fill="#475569" fontSize="8" fontFamily="Inter, system-ui, sans-serif">
        7-year WORM retention
      </text>
      <text x={500} y={60} fill="#475569" fontSize="8" fontFamily="Inter, system-ui, sans-serif">
        Tamper detection on read
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SVG — Agent Autonomy Levels (L1 → L5)
// ---------------------------------------------------------------------------

function AutonomyLevelsDiagram(): ReactNode {
  const levels = [
    {
      level: 'L1',
      name: 'Human Confirms All',
      desc: 'Agent suggests, human executes',
      pct: 20,
      color: '#ef4444',
    },
    {
      level: 'L2',
      name: 'Human Approves',
      desc: 'Agent proposes plan, human approves',
      pct: 40,
      color: '#f59e0b',
    },
    {
      level: 'L3',
      name: 'Human on Exception',
      desc: 'Agent executes, human reviews exceptions',
      pct: 60,
      color: '#eab308',
    },
    {
      level: 'L4',
      name: 'Human Monitors',
      desc: 'Agent autonomous, human audits post-hoc',
      pct: 80,
      color: '#22c55e',
    },
    {
      level: 'L5',
      name: 'Full Autonomy',
      desc: 'Agent operates independently within bounds',
      pct: 100,
      color: '#10b981',
    },
  ];

  return (
    <div className="space-y-3">
      {levels.map((l) => (
        <div key={l.level} className="flex items-center gap-4">
          <span className="w-8 shrink-0 font-mono text-sm font-bold" style={{ color: l.color }}>
            {l.level}
          </span>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-content">{l.name}</span>
              <span className="text-2xs text-content-tertiary">{l.desc}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-white/5">
              <div
                className="h-1.5 rounded-full transition-all duration-1000"
                style={{
                  width: `${l.pct}%`,
                  background: `linear-gradient(90deg, ${l.color}60, ${l.color})`,
                }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SVG — Latency Waterfall
// ---------------------------------------------------------------------------

function LatencyWaterfall(): ReactNode {
  const steps = [
    { label: 'Signal Received', latency: '0ms', offset: 0, width: 2, color: '#3b82f6' },
    { label: 'Event Published (Kafka)', latency: '<15ms', offset: 2, width: 15, color: '#10b981' },
    { label: 'Policy Evaluated', latency: '<10ms', offset: 17, width: 10, color: '#06b6d4' },
    { label: 'Decision Computed', latency: '<100ms', offset: 27, width: 73, color: '#f59e0b' },
    { label: 'Agent Dispatched', latency: '<200ms', offset: 100, width: 100, color: '#8b5cf6' },
    { label: 'Channel Delivered', latency: '<500ms', offset: 200, width: 300, color: '#ec4899' },
  ];
  const maxW = 500;

  return (
    <div className="space-y-2">
      {steps.map((s) => (
        <div key={s.label} className="flex items-center gap-3">
          <span className="w-36 shrink-0 text-right text-2xs text-content-tertiary">{s.label}</span>
          <div className="flex-1">
            <div className="relative h-4 rounded bg-white/[0.02]">
              <div
                className="absolute top-0.5 h-3 rounded transition-all duration-700"
                style={{
                  left: `${(s.offset / maxW) * 100}%`,
                  width: `${(s.width / maxW) * 100}%`,
                  background: `linear-gradient(90deg, ${s.color}80, ${s.color})`,
                }}
              />
            </div>
          </div>
          <span className="w-14 shrink-0 font-mono text-2xs text-content-secondary">
            {s.latency}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <span className="w-36 shrink-0 text-right text-xs font-semibold text-content">
          End-to-End
        </span>
        <div className="flex-1 border-t border-white/10" />
        <span className="w-14 shrink-0 font-mono text-xs font-bold text-brand-accent">
          &lt;500ms
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Technical Specifications Table
// ---------------------------------------------------------------------------

function TechSpecsTable(): ReactNode {
  const specs = [
    ['Event publish latency', 'p99 < 15ms', 'Kafka + Confluent Cloud'],
    ['Policy evaluation', 'p99 < 10ms', 'OPA / Rego engine'],
    ['Decision engine', 'p99 < 100ms', 'Rules + ML + LLM cascade'],
    ['Agent dispatch', 'p99 < 200ms', 'LangGraph orchestration'],
    ['Channel delivery', 'p99 < 500ms', 'Multi-provider failover'],
    ['API throughput', '10K req/s sustained', '50K burst capacity'],
    ['Event throughput', '100K events/s', '500K burst capacity'],
    ['Graph queries', '5K queries/s', 'Relationship + temporal'],
    ['Agent concurrency', '1K executions/min', '5K burst capacity'],
    ['Tenant isolation', 'Row-Level Security', 'PostgreSQL RLS + JWT'],
    ['Encryption at rest', 'AES-256-GCM', 'HSM-backed key mgmt'],
    ['Encryption in transit', 'TLS 1.3 + mTLS', 'Zero-trust internal'],
    ['Audit retention', '7 years WORM', 'SHA-256 Merkle DAG'],
    ['Key rotation', '90-day automated', 'Zero-downtime swap'],
    ['Data classification', '4 tiers', 'Public → Restricted'],
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-white/5">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-white/5 bg-white/[0.02]">
            <th className="px-4 py-2.5 font-semibold text-content-tertiary">METRIC</th>
            <th className="px-4 py-2.5 font-semibold text-content-tertiary">SPECIFICATION</th>
            <th className="hidden px-4 py-2.5 font-semibold text-content-tertiary sm:table-cell">
              NOTES
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {specs.map(([metric, spec, note]) => (
            <tr key={metric} className="transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-2 text-content-secondary">{metric}</td>
              <td className="px-4 py-2 font-mono text-content">{spec}</td>
              <td className="hidden px-4 py-2 text-content-tertiary sm:table-cell">{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const primitives = [
  {
    icon: Users,
    title: 'Customer Graph',
    sub: 'Neo4j + pgvector',
    desc: 'Temporal knowledge graph with entity resolution, relationship inference, and confidence scoring. Zero institutional memory loss when employees leave.',
    gradient: 'from-blue-500 to-cyan-400',
  },
  {
    icon: Activity,
    title: 'Event Stream',
    sub: 'Kafka — Confluent',
    desc: 'Immutable append-only event log. Single source of truth for every signal, decision, and action. Sub-second latency, infinite replay.',
    gradient: 'from-emerald-500 to-teal-400',
  },
  {
    icon: Zap,
    title: 'Decision Engine',
    sub: 'ClickHouse + Redis',
    desc: 'Three-layer cascade — deterministic rules, ML scoring models, LLM reasoning — evaluating every event in <100ms. No batch processing.',
    gradient: 'from-amber-500 to-yellow-400',
  },
  {
    icon: Bot,
    title: 'Agent Runtime',
    sub: 'LangGraph + Claude',
    desc: '8 specialized agent types with 5-level graduated autonomy, budget enforcement, and 4-layer hallucination containment.',
    gradient: 'from-violet-500 to-purple-400',
  },
  {
    icon: Globe,
    title: 'Execution Layer',
    sub: 'Omnichannel Delivery',
    desc: 'Unified delivery across SMS, email, voice, WhatsApp, IVR, Slack, and webhooks. Dynamic channel selection with provider failover.',
    gradient: 'from-rose-500 to-pink-400',
  },
  {
    icon: Lock,
    title: 'Governance Layer',
    sub: 'Merkle DAG + WORM',
    desc: 'Cryptographic audit trail with SHA-256 hash chain. Write-once storage. Zero-trust architecture with mTLS on every internal connection.',
    gradient: 'from-sky-500 to-indigo-400',
  },
];

const industries = [
  {
    icon: Building2,
    name: 'Collections & Finance',
    desc: 'FDCPA/Reg F compliant recovery',
    metrics: '$0.02–0.15/op',
  },
  {
    icon: Heart,
    name: 'Healthcare & Clinics',
    desc: 'HIPAA-native patient workflows',
    metrics: 'PHI field-encrypted',
  },
  {
    icon: Briefcase,
    name: 'Real Estate & Mortgage',
    desc: 'RESPA/TILA compliant outreach',
    metrics: '<5s speed-to-lead',
  },
  {
    icon: Globe,
    name: 'B2B SaaS',
    desc: 'Sales-to-CS handoff automation',
    metrics: '67% churn reduction',
  },
  {
    icon: Users,
    name: 'Political Campaigns',
    desc: 'FEC compliant voter outreach',
    metrics: '10K msg/s burst',
  },
  {
    icon: Phone,
    name: 'Franchises & Multi-Location',
    desc: 'Brand consistency at scale',
    metrics: 'Per-location RBAC',
  },
];

const complianceBadges = [
  { label: 'SOC 2 Type II', sub: 'CC1–CC9, A1, PI1, C1, P1' },
  { label: 'ISO 27001:2022', sub: '93 Annex A Controls' },
  { label: 'HIPAA', sub: '§164.308 / .310 / .312' },
  { label: 'GDPR', sub: 'Right to erasure via key destruction' },
  { label: 'FDCPA / TCPA', sub: 'Quiet hours + frequency limits' },
  { label: 'PCI DSS', sub: 'Payment data isolation' },
];

const channelIcons: Record<string, typeof Mail> = {
  SMS: MessageSquare,
  Email: Mail,
  Voice: Phone,
  WhatsApp: MessageSquare,
  IVR: Phone,
  Slack: MessageSquare,
  Chat: MessageSquare,
  Webhooks: Zap,
};

// ---------------------------------------------------------------------------
// Landing Page
// ---------------------------------------------------------------------------

export function Landing(): ReactNode {
  const navigate = useNavigate();
  const [statsRef, statsVisible] = useInView(0.3);

  const s1 = useCountUp(10000, 2000, statsVisible);
  const s2 = useCountUp(500, 1800, statsVisible);
  const s3 = useCountUp(15, 1500, statsVisible);
  const s4 = useCountUp(9999, 2000, statsVisible);

  return (
    <div className="min-h-screen bg-canvas text-content overflow-x-hidden">
      {/* ── NAV ── */}
      <nav className="fixed top-0 z-50 w-full border-b border-white/5 bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-accent text-xs font-bold text-[#060608]">
              O
            </div>
            <span className="font-mono text-lg font-bold tracking-tight">
              ORDR<span className="text-content-tertiary">.</span>Connect
            </span>
          </div>
          <div className="hidden items-center gap-8 lg:flex">
            <a
              href="#architecture"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Architecture
            </a>
            <a
              href="#security"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Security
            </a>
            <a
              href="#specs"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Specifications
            </a>
            <a
              href="#industries"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Industries
            </a>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/login')}
              className="rounded-lg px-4 py-2 text-sm font-medium text-content-secondary transition-colors hover:text-content"
            >
              Sign In
            </button>
            <button
              onClick={() => navigate('/login')}
              className="rounded-lg bg-white px-5 py-2 text-sm font-semibold text-canvas transition-all hover:bg-white/90"
            >
              Request Demo
            </button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative flex min-h-screen items-center justify-center px-6 pt-20">
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.02) 1px, transparent 0)',
              backgroundSize: '40px 40px',
            }}
          />
          <div className="absolute left-1/2 top-1/3 -translate-x-1/2 h-[700px] w-[700px] rounded-full bg-brand-accent/4 blur-[160px]" />
        </div>

        <div className="relative mx-auto max-w-5xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="font-mono text-xs text-content-secondary">CUSTOMER OPERATIONS OS</span>
          </div>

          <h1 className="text-5xl font-bold leading-[1.08] tracking-tight sm:text-6xl lg:text-7xl">
            The autonomous platform
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">
              that replaces CRM.
            </span>
          </h1>

          <p className="mx-auto mt-8 max-w-3xl text-lg leading-relaxed text-content-secondary">
            Event-sourced architecture. Multi-agent orchestration. Cryptographic audit trail.
            ORDR-Connect is the operating system for enterprise customer operations — where AI
            agents execute and humans govern.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={() => navigate('/login')}
              className="group flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-canvas transition-all hover:bg-white/90 hover:shadow-lg hover:shadow-white/5"
            >
              Request a Demo
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </button>
            <button
              onClick={() =>
                document.getElementById('architecture')?.scrollIntoView({ behavior: 'smooth' })
              }
              className="flex items-center gap-2 rounded-xl border border-white/10 px-8 py-3.5 text-base font-medium text-content-secondary transition-all hover:border-white/20 hover:text-content"
            >
              Technical Overview
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Trust strip */}
          <div className="mt-20 flex flex-wrap items-center justify-center gap-8 text-xs font-medium text-content-tertiary">
            {['SOC 2 Type II', 'ISO 27001:2022', 'HIPAA', 'GDPR', 'Zero Trust Architecture'].map(
              (b) => (
                <div key={b} className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500/60" />
                  <span>{b}</span>
                </div>
              ),
            )}
          </div>
        </div>
      </section>

      {/* ── ARCHITECTURE TOPOLOGY ── */}
      <section id="architecture" className="relative py-32 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-brand-accent">
              SYSTEM ARCHITECTURE
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Six primitives. One coherent system.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              Not six products stitched together. Six architectural building blocks with
              well-defined interfaces, independently scalable, cryptographically linked.
            </p>
          </div>

          {/* Topology diagram */}
          <div className="mx-auto mt-16 max-w-3xl">
            <ArchitectureDiagram />
          </div>

          {/* Primitive cards */}
          <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {primitives.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.title}
                  className="group relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.015] p-6 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.03]"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${p.gradient}`}
                    >
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold">{p.title}</h3>
                      <p className="font-mono text-2xs text-content-tertiary">{p.sub}</p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-content-secondary">{p.desc}</p>
                  <div
                    className={`absolute -bottom-24 -right-24 h-48 w-48 rounded-full bg-gradient-to-br ${p.gradient} opacity-0 blur-[80px] transition-opacity duration-500 group-hover:opacity-5`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── EVENT PIPELINE ── */}
      <section className="py-32 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-emerald-400">
              DATA FLOW
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Signal to action in under 500ms.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              Every customer signal flows through a deterministic pipeline — ingested, evaluated,
              decided, executed, and cryptographically logged. No batch processing. No manual
              handoffs.
            </p>
          </div>

          <div className="mt-16 overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.015] p-8">
            <EventFlowDiagram />
          </div>

          {/* Latency waterfall */}
          <div className="mt-12 rounded-2xl border border-white/5 bg-white/[0.015] p-8">
            <div className="mb-6 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-content-tertiary" />
              <h3 className="text-sm font-semibold">End-to-End Latency Waterfall</h3>
              <span className="font-mono text-2xs text-content-tertiary">p99 targets</span>
            </div>
            <LatencyWaterfall />
          </div>
        </div>
      </section>

      {/* ── AUDIT & GOVERNANCE ── */}
      <section id="security" className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute left-1/4 top-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-emerald-500/4 blur-[120px]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-emerald-400">
              GOVERNANCE
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Compliance is architectural.
              <br />
              <span className="text-content-tertiary">Not bolted on.</span>
            </h2>
          </div>

          {/* Compliance grid */}
          <div className="mt-16 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {complianceBadges.map((b) => (
              <div
                key={b.label}
                className="flex flex-col items-center gap-2 rounded-xl border border-emerald-500/10 bg-emerald-500/[0.02] p-4 text-center"
              >
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
                <span className="text-xs font-semibold">{b.label}</span>
                <span className="font-mono text-2xs text-content-tertiary">{b.sub}</span>
              </div>
            ))}
          </div>

          {/* Merkle audit diagram */}
          <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-8">
              <div className="mb-4 flex items-center gap-2">
                <Lock className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-semibold">Merkle DAG Audit Chain</h3>
              </div>
              <AuditChainDiagram />
            </div>

            <div className="space-y-4">
              {[
                {
                  icon: Lock,
                  title: 'AES-256-GCM + HSM',
                  desc: 'Field-level encryption on all restricted data. HSM-backed key management with 90-day automated rotation. Cryptographic erasure for right-to-deletion.',
                },
                {
                  icon: Eye,
                  title: 'Zero Trust Architecture',
                  desc: 'mTLS on every internal connection. JWT claims derive tenant scope server-side. Row-Level Security enforced at PostgreSQL. Default deny.',
                },
                {
                  icon: FileText,
                  title: 'WORM Audit Storage',
                  desc: 'Append-only audit tables with database triggers blocking UPDATE/DELETE. SHA-256 hash chain with Merkle tree batch verification. S3 Object Lock replication.',
                },
                {
                  icon: Target,
                  title: '10-Gate PR Enforcement',
                  desc: 'Every pull request passes: static analysis, dependency scan, secret scan, type safety, 80%+ coverage, audit check, access control, PHI check, encryption check, peer review.',
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-xl border border-white/5 bg-white/[0.015] p-5"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-emerald-400" />
                      <h4 className="text-sm font-semibold">{item.title}</h4>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-content-secondary">
                      {item.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── AGENT INTELLIGENCE ── */}
      <section className="py-32 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-violet-400">
              AGENT RUNTIME
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Bounded autonomy.
              <br />
              <span className="text-content-tertiary">Not unbounded risk.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              Every agent operates within explicit boundaries — permission allowlists, budget
              enforcement, confidence thresholds, and kill switches at four levels.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* Autonomy levels */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-8">
              <div className="mb-6 flex items-center gap-2">
                <Bot className="h-4 w-4 text-violet-400" />
                <h3 className="text-sm font-semibold">Graduated Autonomy Model</h3>
              </div>
              <AutonomyLevelsDiagram />
            </div>

            {/* Safety controls */}
            <div className="space-y-4">
              <div className="rounded-xl border border-white/5 bg-white/[0.015] p-6">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                  SAFETY ARCHITECTURE
                </h4>
                <div className="mt-4 space-y-3">
                  {[
                    {
                      label: 'Hallucination Containment',
                      desc: '4-layer defense: RAG grounding, multi-agent validation, rules-based constraints, confidence scoring',
                    },
                    {
                      label: 'Budget Enforcement',
                      desc: 'Token limits, action limits, cost ceiling, and time bounds per execution — configurable per agent type',
                    },
                    {
                      label: 'Kill Switch Hierarchy',
                      desc: 'Platform → Tenant → Agent Type → Individual execution — 4 levels of immediate termination',
                    },
                    {
                      label: 'HITL Escalation',
                      desc: 'Actions below 0.70 confidence route to human review queue. Financial actions and PHI access always require human approval.',
                    },
                  ].map((item) => (
                    <div key={item.label} className="flex gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
                      <div>
                        <span className="text-xs font-semibold text-content">{item.label}</span>
                        <p className="mt-0.5 text-2xs leading-relaxed text-content-tertiary">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-white/5 bg-white/[0.015] p-6">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                  EXECUTION CHANNELS
                </h4>
                <div className="mt-4 flex flex-wrap gap-2">
                  {Object.entries(channelIcons).map(([name, Icon]) => (
                    <div
                      key={name}
                      className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5"
                    >
                      <Icon className="h-3 w-3 text-content-tertiary" />
                      <span className="text-xs text-content-secondary">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── TECHNICAL SPECIFICATIONS ── */}
      <section id="specs" ref={statsRef} className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute right-1/4 top-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-brand-accent/4 blur-[120px]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-brand-accent">
              SPECIFICATIONS
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Engineering at enterprise scale.
            </h2>
          </div>

          {/* KPI row */}
          <div className="mt-16 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              {
                val: `${(s1 / 1000).toFixed(0)}K`,
                unit: 'req/s',
                label: 'API throughput',
                sub: '50K burst',
              },
              {
                val: `${(s2 / 1000).toFixed(0)}K`,
                unit: 'evt/s',
                label: 'Event stream',
                sub: '500K burst',
              },
              { val: `${s3}`, unit: 'ms', label: 'p99 publish latency', sub: 'Kafka event stream' },
              {
                val: (s4 / 100).toFixed(2),
                unit: '%',
                label: 'Uptime SLA',
                sub: 'Automated failover',
              },
            ].map((m) => (
              <div
                key={m.label}
                className="flex flex-col items-center rounded-2xl border border-white/5 bg-white/[0.015] p-8 text-center"
              >
                <span className="font-mono text-4xl font-bold tracking-tight">
                  {m.val}
                  <span className="text-lg text-brand-accent">{m.unit}</span>
                </span>
                <span className="mt-2 text-sm font-medium text-content-secondary">{m.label}</span>
                <span className="mt-1 font-mono text-2xs text-content-tertiary">{m.sub}</span>
              </div>
            ))}
          </div>

          {/* Full specs table */}
          <div className="mt-12">
            <TechSpecsTable />
          </div>
        </div>
      </section>

      {/* ── INDUSTRIES ── */}
      <section id="industries" className="py-32 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-brand-accent">
              VERTICALS
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Built for regulated, high-stakes operations.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              Six target verticals where compliance is non-negotiable and customer operations
              directly impact revenue.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((ind) => {
              const Icon = ind.icon;
              return (
                <div
                  key={ind.name}
                  className="group rounded-xl border border-white/5 bg-white/[0.015] p-6 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.03]"
                >
                  <div className="flex items-center justify-between">
                    <Icon className="h-6 w-6 text-content-tertiary transition-colors group-hover:text-brand-accent" />
                    <span className="font-mono text-2xs text-brand-accent">{ind.metrics}</span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{ind.name}</h3>
                  <p className="mt-1 text-xs text-content-tertiary">{ind.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── STACK REPLACEMENT ── */}
      <section className="py-32 px-6">
        <div className="mx-auto max-w-4xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-amber-400">
              TCO ANALYSIS
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              One platform. Eight fewer vendors.
            </h2>
          </div>

          <div className="mt-12 rounded-2xl border border-white/5 bg-white/[0.015] p-8">
            <div className="space-y-3">
              {[
                { tool: 'CRM Platform', example: 'Salesforce / HubSpot', status: 'replaced' },
                { tool: 'Contact Center (CCaaS)', example: 'Five9 / Talkdesk', status: 'replaced' },
                {
                  tool: 'Customer Data Platform',
                  example: 'Segment / mParticle',
                  status: 'replaced',
                },
                { tool: 'Customer Success', example: 'Gainsight / ChurnZero', status: 'replaced' },
                { tool: 'Conversation Intelligence', example: 'Gong / Chorus', status: 'replaced' },
                { tool: 'Revenue Intelligence', example: 'Clari / 6sense', status: 'replaced' },
                { tool: 'Compliance Management', example: 'Vanta / Drata', status: 'replaced' },
                { tool: 'AI Agent Platform', example: 'Custom / Agentforce', status: 'replaced' },
              ].map((row) => (
                <div
                  key={row.tool}
                  className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3"
                >
                  <div>
                    <span className="text-sm font-medium text-content">{row.tool}</span>
                    <span className="ml-2 text-xs text-content-tertiary">{row.example}</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Consolidated
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-white/5 pt-6">
              <div>
                <p className="text-xs text-content-tertiary">Traditional stack TCO</p>
                <p className="font-mono text-lg font-bold text-content-tertiary line-through">
                  $390K – $1.27M / year
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-emerald-400">ORDR-Connect</p>
                <p className="font-mono text-lg font-bold text-content">Single platform.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-brand-accent/5 blur-[160px]" />
        </div>
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="text-4xl font-bold leading-tight sm:text-5xl">
            Enterprise customer operations.
            <br />
            <span className="text-content-tertiary">Reimagined from first principles.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base text-content-secondary">
            Talk to our engineering team about how ORDR-Connect maps to your compliance
            requirements, integration landscape, and operational scale.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              onClick={() => navigate('/login')}
              className="group flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-canvas transition-all hover:bg-white/90 hover:shadow-lg hover:shadow-white/5"
            >
              Request a Demo
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </button>
            <button
              onClick={() => navigate('/login')}
              className="flex items-center gap-2 rounded-xl border border-white/10 px-8 py-3.5 text-base font-medium text-content-secondary transition-all hover:border-white/20 hover:text-content"
            >
              View Documentation
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 py-16 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 gap-12 sm:grid-cols-3">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-accent text-2xs font-bold text-[#060608]">
                  O
                </div>
                <span className="font-mono text-sm font-bold tracking-tight">
                  ORDR<span className="text-content-tertiary">.</span>Connect
                </span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-content-tertiary">
                Customer Operations OS by Synexiun.
                <br />
                Enterprise-grade autonomous operations.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                COMPLIANCE
              </h4>
              <div className="mt-3 space-y-1.5">
                {['SOC 2 Type II', 'ISO 27001:2022', 'HIPAA', 'GDPR', 'PCI DSS'].map((c) => (
                  <div key={c} className="flex items-center gap-1.5 text-xs text-content-secondary">
                    <ShieldCheck className="h-3 w-3 text-emerald-500/60" />
                    {c}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                PLATFORM
              </h4>
              <div className="mt-3 space-y-1.5 text-xs text-content-secondary">
                <p>Documentation</p>
                <p>API Reference</p>
                <p>Status Page</p>
                <p>Security Whitepaper</p>
                <p>Compliance Reports</p>
              </div>
            </div>
          </div>
          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/5 pt-8 sm:flex-row">
            <p className="text-xs text-content-tertiary">
              &copy; {new Date().getFullYear()} Synexiun. All rights reserved.
            </p>
            <p className="font-mono text-2xs text-content-tertiary">
              All sessions monitored. Compliance included in every tier.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
