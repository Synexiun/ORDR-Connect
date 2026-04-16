import { type ReactNode, useEffect, useState, useRef, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  Bot,
  Activity,
  Zap,
  Lock,
  Globe,
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
  HeartPulse,
  Database,
  Code2,
  Webhook,
  Terminal,
  BookOpen,
  Stethoscope,
  TrendingUp,
  Award,
  Layers,
  MapPin,
  Brain,
  BarChart3,
  Key,
  AlertTriangle,
  Building,
  Sparkles,
  Network,
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
    ['Uptime SLA', '99.99%', 'Multi-region failover'],
    ['RTO / RPO', '<15 min / <1 min', 'Automated failover + WAL'],
    ['SCIM provisioning', 'RFC 7644', 'WorkOS + custom SCIM'],
    ['FHIR conformance', 'FHIR R4 4.0.1', 'HL7 interoperability'],
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
// Integration Hub Diagram — hub-and-spoke SVG
// ---------------------------------------------------------------------------

function IntegrationHubDiagram(): ReactNode {
  const id = useId();
  const integrations = [
    { label: 'WorkOS / SCIM', x: 240, y: 45, color: '#8b5cf6' },
    { label: 'Salesforce', x: 314, y: 76, color: '#3b82f6' },
    { label: 'HubSpot', x: 345, y: 150, color: '#f97316' },
    { label: 'Stripe', x: 314, y: 224, color: '#6366f1' },
    { label: 'SendGrid', x: 240, y: 255, color: '#22d3ee' },
    { label: 'Twilio', x: 166, y: 224, color: '#e11d48' },
    { label: 'FHIR R4', x: 135, y: 150, color: '#ef4444' },
    { label: 'Webhooks', x: 166, y: 76, color: '#f59e0b' },
  ];
  const cx = 240;
  const cy = 150;

  return (
    <svg viewBox="0 0 480 300" className="w-full" aria-label="ORDR integration hub topology">
      <defs>
        <radialGradient id={`${id}-center`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.04" />
        </radialGradient>
      </defs>
      {integrations.map((int) => (
        <line
          key={int.label}
          x1={cx}
          y1={cy}
          x2={int.x}
          y2={int.y}
          stroke={`${int.color}22`}
          strokeWidth="1.5"
          strokeDasharray="4,3"
        />
      ))}
      <circle
        cx={cx}
        cy={cy}
        r="46"
        fill={`url(#${id}-center)`}
        stroke="rgba(99,102,241,0.3)"
        strokeWidth="1.5"
      />
      <text
        x={cx}
        y={cy - 8}
        textAnchor="middle"
        fill="#c4b5fd"
        fontSize="11"
        fontWeight="bold"
        fontFamily="Inter, system-ui, sans-serif"
      >
        ORDR Core
      </text>
      <text
        x={cx}
        y={cy + 7}
        textAnchor="middle"
        fill="#64748b"
        fontSize="7.5"
        fontFamily="JetBrains Mono, monospace"
      >
        Kafka · Postgres
      </text>
      <text
        x={cx}
        y={cy + 19}
        textAnchor="middle"
        fill="#64748b"
        fontSize="7.5"
        fontFamily="JetBrains Mono, monospace"
      >
        Neo4j · ClickHouse
      </text>
      {integrations.map((int) => {
        const parts = int.label.split(' / ');
        return (
          <g key={int.label}>
            <circle
              cx={int.x}
              cy={int.y}
              r="24"
              fill={`${int.color}07`}
              stroke={`${int.color}28`}
              strokeWidth="1"
            />
            <circle cx={int.x} cy={int.y} r="2.5" fill={int.color} opacity="0.5" />
            {parts.map((part, i) => (
              <text
                key={i}
                x={int.x}
                y={int.y + (parts.length > 1 ? -5 + i * 11 : 4)}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="6.5"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {part}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// FHIR R4 Resource Mapping Diagram
// ---------------------------------------------------------------------------

function FHIRFlowDiagram(): ReactNode {
  const mappings = [
    {
      fhir: 'Patient',
      ordr: 'Customer',
      desc: 'demographics + relationship graph',
      color: '#ef4444',
    },
    {
      fhir: 'Communication',
      ordr: 'Message / Conversation',
      desc: 'channel + thread + audit trail',
      color: '#f97316',
    },
    {
      fhir: 'Bundle',
      ordr: 'Bulk Import Transaction',
      desc: 'atomic multi-resource write',
      color: '#f59e0b',
    },
    {
      fhir: 'CapabilityStatement',
      ordr: 'Platform Metadata',
      desc: 'GET /fhir/metadata',
      color: '#10b981',
    },
  ];

  return (
    <div className="space-y-3">
      {mappings.map((m) => (
        <div key={m.fhir} className="flex items-center gap-3">
          <div
            className="flex w-36 shrink-0 flex-col items-start justify-center rounded-lg border px-3 py-2"
            style={{ borderColor: `${m.color}25`, background: `${m.color}06` }}
          >
            <span className="font-mono text-2xs font-bold" style={{ color: m.color }}>
              {m.fhir}
            </span>
            <span className="font-mono text-2xs text-content-tertiary">FHIR R4</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-px w-5 bg-white/10" />
            <span className="text-xs" style={{ color: `${m.color}60` }}>
              {'\u2192'}
            </span>
            <div className="h-px w-5 bg-white/10" />
          </div>
          <div className="flex-1 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
            <p className="text-xs font-semibold text-content">{m.ordr}</p>
            <p className="text-2xs text-content-tertiary">{m.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decision Engine — 3-Layer Cascade Diagram
// ---------------------------------------------------------------------------

function DecisionEngineDiagram(): ReactNode {
  const layers = [
    {
      label: 'Layer 1',
      name: 'Rules Engine',
      badge: 'Deterministic',
      latency: 'p99 < 10ms',
      color: '#06b6d4',
      tech: 'OPA · Rego · Redis',
      examples: [
        'FDCPA quiet hours (8am–9pm local)',
        'TCPA attempt frequency limits',
        'Cease-contact & dispute flags',
        'Bankruptcy & deceased suppression',
        'Do-Not-Call registry check',
      ],
      output: 'ALLOW / BLOCK / ESCALATE',
      exitCond: 'BLOCK exits immediately — LLM never fires',
    },
    {
      label: 'Layer 2',
      name: 'ML Scorer',
      badge: 'Statistical',
      latency: 'p99 < 50ms',
      color: '#f59e0b',
      tech: 'ClickHouse · Feature Store · pgvector',
      examples: [
        'Contact propensity model (4.7M outcomes)',
        'Channel preference prediction per customer',
        'Churn probability (40+ signals)',
        'NBA action scoring matrix',
        'Response time & sentiment pattern',
      ],
      output: 'Score + confidence + priority channel',
      exitCond: 'Confidence > 0.90 skips LLM entirely',
    },
    {
      label: 'Layer 3',
      name: 'LLM Reasoner',
      badge: 'Generative',
      latency: 'p99 < 100ms',
      color: '#8b5cf6',
      tech: 'Claude API · RAG grounding · pgvector',
      examples: [
        'Complex multi-factor prioritization',
        'Edge case rule disambiguation',
        'Contextual message personalization',
        'Regulatory gray-area reasoning',
        'Multi-account conflict resolution',
      ],
      output: 'Decision + full reasoning chain',
      exitCond: 'Confidence < 0.70 → HITL queue',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {layers.map((l, i) => (
        <div key={l.label} className="relative">
          <div
            className="h-full rounded-2xl border bg-white/[0.015] p-6"
            style={{ borderColor: `${l.color}20` }}
          >
            {/* Header */}
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <span
                  className="font-mono text-2xs font-bold uppercase tracking-widest"
                  style={{ color: `${l.color}80` }}
                >
                  {l.label}
                </span>
                <h4 className="mt-0.5 text-sm font-bold text-content">{l.name}</h4>
                <p className="font-mono text-2xs text-content-tertiary">{l.tech}</p>
              </div>
              <div className="shrink-0 text-right">
                <span
                  className="rounded-full border px-2 py-0.5 font-mono text-2xs"
                  style={{ borderColor: `${l.color}25`, color: l.color }}
                >
                  {l.badge}
                </span>
                <p className="mt-1 font-mono text-2xs text-content-tertiary">{l.latency}</p>
              </div>
            </div>

            {/* Examples */}
            <div className="space-y-1.5">
              {l.examples.map((ex) => (
                <div key={ex} className="flex items-start gap-2">
                  <div
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: l.color }}
                  />
                  <span className="text-2xs leading-relaxed text-content-secondary">{ex}</span>
                </div>
              ))}
            </div>

            {/* Output */}
            <div
              className="mt-5 rounded-lg border px-3 py-2.5"
              style={{ borderColor: `${l.color}15`, background: `${l.color}05` }}
            >
              <p className="font-mono text-2xs font-semibold" style={{ color: l.color }}>
                → {l.output}
              </p>
              <p className="mt-1 text-2xs text-content-tertiary">{l.exitCond}</p>
            </div>
          </div>

          {/* Arrow connector between cards */}
          {i < layers.length - 1 && (
            <div className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 lg:flex">
              <div className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-canvas">
                <ChevronRight className="h-3 w-3 text-content-tertiary" />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compliance Coverage Matrix
// ---------------------------------------------------------------------------

function ComplianceMatrixTable(): ReactNode {
  const regs = [
    'FDCPA',
    'TCPA',
    'HIPAA',
    'GDPR',
    'RESPA',
    'FEC',
    'CCPA',
    'SOC2',
    'ISO 27001',
    'PCI DSS',
  ];
  const regColors: Record<string, string> = {
    FDCPA: '#f59e0b',
    TCPA: '#ef4444',
    HIPAA: '#ec4899',
    GDPR: '#3b82f6',
    RESPA: '#10b981',
    FEC: '#8b5cf6',
    CCPA: '#06b6d4',
    SOC2: '#22c55e',
    'ISO 27001': '#64748b',
    'PCI DSS': '#f97316',
  };
  const rows = [
    {
      industry: 'Collections & Finance',
      required: ['FDCPA', 'TCPA', 'SOC2', 'ISO 27001'],
      applicable: ['CCPA', 'GDPR'],
    },
    {
      industry: 'Healthcare & Clinics',
      required: ['HIPAA', 'TCPA', 'SOC2', 'ISO 27001'],
      applicable: ['GDPR', 'CCPA'],
    },
    {
      industry: 'Real Estate & Mortgage',
      required: ['RESPA', 'TCPA', 'SOC2'],
      applicable: ['FDCPA', 'GDPR', 'ISO 27001'],
    },
    {
      industry: 'B2B SaaS',
      required: ['GDPR', 'CCPA', 'SOC2', 'ISO 27001'],
      applicable: ['TCPA', 'PCI DSS'],
    },
    {
      industry: 'Political Campaigns',
      required: ['FEC', 'TCPA', 'SOC2'],
      applicable: ['GDPR', 'CCPA'],
    },
    {
      industry: 'Franchise & Retail',
      required: ['TCPA', 'GDPR', 'CCPA', 'SOC2'],
      applicable: ['PCI DSS', 'ISO 27001'],
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/5 bg-white/[0.02]">
            <th className="px-4 py-3 text-left font-semibold text-content-tertiary">INDUSTRY</th>
            {regs.map((r) => (
              <th
                key={r}
                className="px-2 py-3 text-center font-mono text-2xs font-semibold"
                style={{ color: `${regColors[r] ?? '#94a3b8'}90` }}
              >
                {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {rows.map((row) => (
            <tr key={row.industry} className="transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-3 font-medium text-content-secondary">{row.industry}</td>
              {regs.map((r) => {
                const isRequired = row.required.includes(r);
                const isApplicable = row.applicable.includes(r);
                return (
                  <td key={r} className="px-2 py-3 text-center">
                    {isRequired ? (
                      <span
                        className="text-base leading-none"
                        style={{ color: regColors[r] ?? '#94a3b8' }}
                        title="Required"
                      >
                        ●
                      </span>
                    ) : isApplicable ? (
                      <span
                        className="text-base leading-none text-content-tertiary/50"
                        title="Applicable"
                      >
                        ○
                      </span>
                    ) : (
                      <span className="text-content-tertiary/20">–</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-white/5">
            <td colSpan={regs.length + 1} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-6 font-mono text-2xs text-content-tertiary">
                <span>
                  <span className="text-brand-accent">●</span> Required by regulation
                </span>
                <span>
                  <span className="text-content-tertiary/50">○</span> Applicable / recommended
                </span>
                <span>
                  <span className="text-content-tertiary/20">–</span> Not applicable
                </span>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Capabilities Table
// ---------------------------------------------------------------------------

function AgentTypesTable(): ReactNode {
  const agents = [
    {
      role: 'Debt Recovery Agent',
      industry: 'Collections',
      autonomy: 'L3–L4',
      confidence: '0.80+',
      channels: ['SMS', 'Voice', 'Email'],
      budget: '1K contacts/run',
      note: 'FDCPA 12-condition eligibility gate',
      color: '#f59e0b',
    },
    {
      role: 'Care Coordinator',
      industry: 'Healthcare',
      autonomy: 'L2–L3',
      confidence: '0.85+',
      channels: ['SMS', 'Email'],
      budget: '500 actions/run',
      note: 'PHI access requires audit justification',
      color: '#ef4444',
    },
    {
      role: 'CS Success Agent',
      industry: 'B2B SaaS',
      autonomy: 'L3–L4',
      confidence: '0.75+',
      channels: ['Email', 'Slack', 'In-app'],
      budget: '250 messages/run',
      note: 'Triggers at health score < 60',
      color: '#8b5cf6',
    },
    {
      role: 'Lead Qualifier',
      industry: 'Real Estate',
      autonomy: 'L3',
      confidence: '0.75+',
      channels: ['SMS', 'Voice'],
      budget: '200 leads/run',
      note: 'Sub-30s speed-to-lead target',
      color: '#10b981',
    },
    {
      role: 'Campaign Agent',
      industry: 'Political',
      autonomy: 'L4',
      confidence: '0.70+',
      channels: ['SMS', 'Email', 'Voice'],
      budget: '10K contacts/run',
      note: 'FEC disclaimer enforced pre-send',
      color: '#6366f1',
    },
    {
      role: 'Loyalty Agent',
      industry: 'Franchise',
      autonomy: 'L3',
      confidence: '0.80+',
      channels: ['SMS', 'Email'],
      budget: '2K/location/run',
      note: 'Per-location RBAC scope enforcement',
      color: '#ec4899',
    },
  ];

  const autonomyColor = (a: string): string => {
    if (a.includes('L4') || a.includes('L5')) return '#22c55e';
    if (a.includes('L3')) return '#eab308';
    return '#f59e0b';
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/5 bg-white/[0.02]">
            <th className="px-4 py-3 text-left font-semibold text-content-tertiary">AGENT TYPE</th>
            <th className="px-4 py-3 text-left font-semibold text-content-tertiary">INDUSTRY</th>
            <th className="px-4 py-3 text-center font-semibold text-content-tertiary">AUTONOMY</th>
            <th className="px-4 py-3 text-center font-semibold text-content-tertiary">
              CONFIDENCE
            </th>
            <th className="hidden px-4 py-3 text-left font-semibold text-content-tertiary md:table-cell">
              CHANNELS
            </th>
            <th className="hidden px-4 py-3 text-left font-semibold text-content-tertiary lg:table-cell">
              SAFETY NOTE
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {agents.map((a) => (
            <tr key={a.role} className="transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full" style={{ background: a.color }} />
                  <span className="font-medium text-content">{a.role}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-content-secondary">{a.industry}</td>
              <td className="px-4 py-3 text-center">
                <span className="font-mono font-bold" style={{ color: autonomyColor(a.autonomy) }}>
                  {a.autonomy}
                </span>
              </td>
              <td className="px-4 py-3 text-center font-mono text-content-secondary">
                {a.confidence}
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <div className="flex flex-wrap gap-1">
                  {a.channels.map((ch) => (
                    <span
                      key={ch}
                      className="rounded border border-white/5 px-1.5 py-0.5 font-mono text-2xs text-content-tertiary"
                    >
                      {ch}
                    </span>
                  ))}
                </div>
              </td>
              <td className="hidden px-4 py-3 text-content-tertiary lg:table-cell">{a.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channel Comparison Table
// ---------------------------------------------------------------------------

function ChannelComparisonTable(): ReactNode {
  const channels = [
    {
      name: 'SMS',
      openRate: '98%',
      delivery: '< 5s',
      cost: '$0.008',
      compliance: 'TCPA opt-in required',
      bestFor: 'Payments, urgent alerts, reminders',
      color: '#22c55e',
    },
    {
      name: 'Email',
      openRate: '24%',
      delivery: '< 60s',
      cost: '$0.002',
      compliance: 'CAN-SPAM · GDPR',
      bestFor: 'Disclosures, detailed content, reports',
      color: '#3b82f6',
    },
    {
      name: 'Voice Call',
      openRate: '46%',
      delivery: 'Real-time',
      cost: '$0.035',
      compliance: 'TCPA · recording consent',
      bestFor: 'Complex, high-value conversations',
      color: '#f59e0b',
    },
    {
      name: 'WhatsApp',
      openRate: '79%',
      delivery: '< 5s',
      cost: '$0.015',
      compliance: 'Template pre-approval',
      bestFor: 'International, B2C engagement',
      color: '#22d3ee',
    },
    {
      name: 'IVR',
      openRate: '—',
      delivery: 'Real-time',
      cost: '$0.025',
      compliance: 'ADA accessibility rules',
      bestFor: 'Self-service, payment collection',
      color: '#8b5cf6',
    },
    {
      name: 'Slack',
      openRate: '95%+',
      delivery: '< 2s',
      cost: 'Enterprise',
      compliance: 'Data residency controls',
      bestFor: 'B2B internal notifications',
      color: '#64748b',
    },
    {
      name: 'Chat Widget',
      openRate: '—',
      delivery: '< 2s',
      cost: 'Platform',
      compliance: 'GDPR data retention',
      bestFor: 'Web-embedded customer support',
      color: '#ec4899',
    },
    {
      name: 'Webhooks',
      openRate: '99.9%',
      delivery: '< 100ms',
      cost: 'N/A',
      compliance: 'HMAC-SHA256 signed',
      bestFor: 'System-to-system integrations',
      color: '#10b981',
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/5 bg-white/[0.02]">
            <th className="px-4 py-3 text-left font-semibold text-content-tertiary">CHANNEL</th>
            <th className="px-4 py-3 text-center font-semibold text-content-tertiary">
              AVG OPEN RATE
            </th>
            <th className="px-4 py-3 text-center font-semibold text-content-tertiary">DELIVERY</th>
            <th className="px-4 py-3 text-center font-semibold text-content-tertiary">COST/MSG</th>
            <th className="hidden px-4 py-3 text-left font-semibold text-content-tertiary md:table-cell">
              COMPLIANCE
            </th>
            <th className="hidden px-4 py-3 text-left font-semibold text-content-tertiary lg:table-cell">
              BEST FOR
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {channels.map((ch) => (
            <tr key={ch.name} className="transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full" style={{ background: ch.color }} />
                  <span className="font-semibold text-content">{ch.name}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-center font-mono font-bold text-content-secondary">
                {ch.openRate}
              </td>
              <td className="px-4 py-3 text-center font-mono text-content-secondary">
                {ch.delivery}
              </td>
              <td className="px-4 py-3 text-center font-mono text-content-secondary">{ch.cost}</td>
              <td className="hidden px-4 py-3 text-content-tertiary md:table-cell">
                {ch.compliance}
              </td>
              <td className="hidden px-4 py-3 text-content-tertiary lg:table-cell">{ch.bestFor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ROI Bar Chart — Traditional Stack vs ORDR-Connect
// ---------------------------------------------------------------------------

function ROIBarChart(): ReactNode {
  const items = [
    { label: 'CRM Platform', example: 'Salesforce / HubSpot', min: 80, max: 200, pct: 65 },
    { label: 'Contact Center (CCaaS)', example: 'Five9 / Talkdesk', min: 120, max: 400, pct: 100 },
    { label: 'Customer Data Platform', example: 'Segment / mParticle', min: 60, max: 150, pct: 52 },
    { label: 'Customer Success', example: 'Gainsight / ChurnZero', min: 50, max: 120, pct: 45 },
    { label: 'Compliance Management', example: 'Vanta / Drata', min: 40, max: 100, pct: 38 },
    { label: 'AI Agent Platform', example: 'Agentforce / custom', min: 40, max: 300, pct: 88 },
    { label: 'Conv. Intelligence', example: 'Gong / Chorus', min: 35, max: 100, pct: 36 },
    { label: 'Revenue Intelligence', example: 'Clari / 6sense', min: 30, max: 80, pct: 30 },
  ];

  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <div className="w-44 shrink-0 text-right">
            <p className="text-xs font-medium text-content-secondary">{item.label}</p>
            <p className="text-2xs text-content-tertiary">{item.example}</p>
          </div>
          <div className="flex-1">
            <div className="relative h-6 overflow-hidden rounded-md bg-white/[0.02]">
              <div
                className="absolute inset-y-0 left-0 flex items-center rounded-md pl-2 transition-all duration-1000"
                style={{
                  width: `${item.pct}%`,
                  background: 'linear-gradient(90deg, #ef444420, #ef4444)',
                }}
              />
            </div>
          </div>
          <span className="w-32 shrink-0 font-mono text-2xs text-red-400/80 line-through">
            ${item.min}K–${item.max}K / yr
          </span>
        </div>
      ))}
      <div className="mt-6 flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4">
        <div>
          <p className="text-xs font-semibold text-content">All 8 capabilities, one platform</p>
          <p className="mt-0.5 text-2xs text-content-tertiary">
            No integration tax. No data silos. No vendor sprawl.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-bold text-emerald-400">ORDR-Connect</p>
          <p className="font-mono text-2xs text-emerald-400/60">consolidated pricing</p>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-white/5 pt-4">
        <div>
          <p className="text-2xs text-content-tertiary">Traditional stack annual TCO range</p>
          <p className="font-mono text-base font-bold text-content-tertiary line-through">
            $455K – $1.45M / year
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xs text-emerald-400">Typical savings</p>
          <p className="font-mono text-base font-bold text-emerald-400">60–80% TCO reduction</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compliance Penalty Reference Table
// ---------------------------------------------------------------------------

function CompliancePenaltyTable(): ReactNode {
  const penalties = [
    {
      reg: 'FDCPA',
      color: '#f59e0b',
      perViolation: '$1,000–$3,500',
      maxExposure: '$500K or 1% net worth (class action)',
      trigger: 'Contact outside 8am–9pm local, calls after cease-and-desist, >7 calls in 7 days',
      gate: 'Rules Engine — 14-condition gate, <10ms deterministic block',
    },
    {
      reg: 'TCPA',
      color: '#ef4444',
      perViolation: '$500–$1,500 per call',
      maxExposure: 'Uncapped — $500 × millions of calls = existential class action',
      trigger: 'ATDS calls/texts to cell phone without prior express written consent',
      gate: 'Consent store validated before every channel dispatch — no consent = blocked',
    },
    {
      reg: 'HIPAA',
      color: '#ec4899',
      perViolation: '$100–$50,000 per violation',
      maxExposure: '$1.9M per violation category per year',
      trigger: 'PHI in logs or error messages, unencrypted storage, missing access audit trail',
      gate: 'AES-256-GCM field encryption + WORM PHI access log with accessor identity',
    },
    {
      reg: 'GDPR',
      color: '#3b82f6',
      perViolation: '€10M or 2% global revenue (standard)',
      maxExposure: '€20M or 4% global revenue (severe) + data subject damages',
      trigger: 'No lawful basis, failed Art. 17 erasure, no records of processing (Art. 30)',
      gate: 'DSR lifecycle + cryptographic erasure (DEK destroy) + consent management',
    },
    {
      reg: 'RESPA',
      color: '#10b981',
      perViolation: '$10,000–$50,000 per regulatory finding',
      maxExposure: 'Triple actual damages + attorney fees (private right of action)',
      trigger: 'Missed LE/CD disclosure windows, no SPOC assignment, unreported kickbacks',
      gate: 'Workflow engine enforces disclosure timing gates — next stage blocked until delivered',
    },
    {
      reg: 'FEC',
      color: '#8b5cf6',
      perViolation: '$25,000–$275,000 civil penalty',
      maxExposure: 'Criminal: up to 5 years imprisonment + fines for knowing violations',
      trigger: 'Missing paid-for-by disclaimer, prohibited source, unreported disbursements',
      gate: 'Pre-send 6-rule FEC gate — message blocked if any rule fails, all checked <10ms',
    },
    {
      reg: 'CCPA / CPRA',
      color: '#06b6d4',
      perViolation: '$100–$750 per consumer per incident',
      maxExposure: '$7,500 per intentional violation (CPRA) + private right of action for breaches',
      trigger: 'No opt-out of sale link, ignored GPC signal, failed deletion requests',
      gate: 'GPC signal detection + right-to-delete DSR automation + opt-out enforcement',
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/5 bg-white/[0.02]">
            <th className="px-4 py-3 text-left font-semibold text-content-tertiary">REGULATION</th>
            <th className="px-4 py-3 text-left font-semibold text-content-tertiary">
              PER-VIOLATION
            </th>
            <th className="hidden px-4 py-3 text-left font-semibold text-content-tertiary lg:table-cell">
              MAX EXPOSURE
            </th>
            <th className="hidden px-4 py-3 text-left font-semibold text-content-tertiary xl:table-cell">
              COMMON TRIGGER
            </th>
            <th className="px-4 py-3 text-left font-semibold text-content-tertiary">
              ORDR PREVENTION
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {penalties.map((p) => (
            <tr key={p.reg} className="transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-3">
                <span className="font-mono text-xs font-bold" style={{ color: p.color }}>
                  {p.reg}
                </span>
              </td>
              <td className="px-4 py-3 font-mono font-semibold text-red-400/80">
                {p.perViolation}
              </td>
              <td className="hidden px-4 py-3 text-content-tertiary lg:table-cell">
                {p.maxExposure}
              </td>
              <td className="hidden px-4 py-3 text-content-tertiary xl:table-cell">{p.trigger}</td>
              <td className="px-4 py-3 text-emerald-400/70">{p.gate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Standards Control Mapping — SOC2 / ISO 27001 / HIPAA / GDPR
// ---------------------------------------------------------------------------

function SecurityControlsTable(): ReactNode {
  const frameworkColors: Record<string, string> = {
    'SOC 2': '#22c55e',
    'ISO 27001': '#64748b',
    HIPAA: '#ec4899',
    GDPR: '#3b82f6',
  };

  const controls = [
    {
      framework: 'SOC 2',
      control: 'CC6.1',
      requirement: 'Logical access controls',
      implementation:
        'RBAC + ABAC per endpoint, JWT claims server-side only, PostgreSQL Row-Level Security, per-tenant DEK',
    },
    {
      framework: 'SOC 2',
      control: 'CC6.3',
      requirement: 'Prevent unauthorized access',
      implementation:
        'Argon2id passwords (64MB/3iter/4par), mandatory MFA, mTLS service mesh, OAuth 2.1 + PKCE, API key SHA-256',
    },
    {
      framework: 'SOC 2',
      control: 'CC7.2',
      requirement: 'System monitoring',
      implementation:
        'Structured JSON logs → Loki, Prometheus metrics → Grafana, real-time audit chain hash verification',
    },
    {
      framework: 'SOC 2',
      control: 'CC9.2',
      requirement: 'Vendor risk management',
      implementation:
        'CycloneDX SBOM per release, Snyk + Dependabot dependency scan, 48-hour critical CVE SLA, OSI-only licenses',
    },
    {
      framework: 'ISO 27001',
      control: 'A.8.24',
      requirement: 'Use of cryptography',
      implementation:
        'AES-256-GCM at rest, TLS 1.3 + mTLS in transit, HSM-backed HashiCorp Vault, 90-day automated DEK rotation',
    },
    {
      framework: 'ISO 27001',
      control: 'A.5.33',
      requirement: 'Protection of records',
      implementation:
        'Append-only PostgreSQL triggers blocking UPDATE/DELETE, S3 Object Lock (Compliance mode), 7-year retention',
    },
    {
      framework: 'ISO 27001',
      control: 'A.8.16',
      requirement: 'Activity monitoring',
      implementation:
        'Every API call, agent decision, data access → immutable audit event with SHA-256 chain link',
    },
    {
      framework: 'HIPAA',
      control: '§164.312(a)',
      requirement: 'Access controls',
      implementation:
        'Unique user ID, emergency access procedure, AES-256-GCM encryption per §164.312(a)(2)(iv)',
    },
    {
      framework: 'HIPAA',
      control: '§164.312(b)',
      requirement: 'Audit controls',
      implementation:
        'WORM PHI access log: accessor identity, timestamp, business justification, Merkle root verification',
    },
    {
      framework: 'HIPAA',
      control: '§164.312(e)',
      requirement: 'Transmission security',
      implementation:
        'TLS 1.3 minimum external, mTLS all internal services, PHI field-level encrypted before any network write',
    },
    {
      framework: 'GDPR',
      control: 'Art. 17',
      requirement: 'Right to erasure',
      implementation:
        'Cryptographic erasure: DEK destroyed → data permanently unreadable without physical deletion of records',
    },
    {
      framework: 'GDPR',
      control: 'Art. 30',
      requirement: 'Records of processing',
      implementation:
        'WORM audit trail with full data access history satisfies records-of-processing-activities obligation',
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/5 bg-white/[0.02]">
            <th className="px-4 py-3 text-left font-semibold text-content-tertiary">FRAMEWORK</th>
            <th className="px-4 py-3 text-left font-mono font-semibold text-content-tertiary">
              CONTROL
            </th>
            <th className="hidden px-4 py-3 text-left font-semibold text-content-tertiary md:table-cell">
              REQUIREMENT
            </th>
            <th className="px-4 py-3 text-left font-semibold text-content-tertiary">
              ORDR-CONNECT IMPLEMENTATION
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {controls.map((c) => (
            <tr
              key={`${c.framework}-${c.control}`}
              className="transition-colors hover:bg-white/[0.02]"
            >
              <td className="px-4 py-3">
                <span
                  className="rounded-md border px-2 py-0.5 font-mono text-2xs font-semibold"
                  style={{
                    borderColor: `${frameworkColors[c.framework] ?? '#94a3b8'}25`,
                    color: frameworkColors[c.framework] ?? '#94a3b8',
                  }}
                >
                  {c.framework}
                </span>
              </td>
              <td className="px-4 py-3 font-mono text-content-secondary">{c.control}</td>
              <td className="hidden px-4 py-3 font-semibold text-content md:table-cell">
                {c.requirement}
              </td>
              <td className="px-4 py-3 text-content-secondary">{c.implementation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kafka Topic Architecture Table
// ---------------------------------------------------------------------------

function KafkaTopologyTable(): ReactNode {
  const topics = [
    {
      topic: 'customer-events',
      partitions: 24,
      throughput: '5K msg/s',
      retention: '7 days',
      keyEvents: ['customer.created', 'customer.updated', 'customer.deleted'],
      consumers: ['Customer handler', 'Integration sync', 'Graph enricher'],
      color: '#3b82f6',
    },
    {
      topic: 'interaction-events',
      partitions: 48,
      throughput: '20K msg/s',
      retention: '7 days',
      keyEvents: ['interaction.logged', 'outbound.delivered', 'outbound.failed'],
      consumers: ['Interaction handler', 'NBA pipeline', 'Agent dispatcher'],
      color: '#10b981',
    },
    {
      topic: 'agent-events',
      partitions: 12,
      throughput: '2K msg/s',
      retention: '14 days',
      keyEvents: ['agent.triggered', 'agent.action_executed', 'agent.killed'],
      consumers: ['Agent handler', 'Notification writer', 'Audit logger'],
      color: '#8b5cf6',
    },
    {
      topic: 'outbound-messages',
      partitions: 96,
      throughput: '50K msg/s',
      retention: '3 days',
      keyEvents: ['outbound.message', 'outbound.consent_denied', 'outbound.blocked'],
      consumers: ['Outbound handler', 'Channel router', 'Compliance gate'],
      color: '#ec4899',
    },
    {
      topic: 'dsr-events',
      partitions: 6,
      throughput: '100 msg/s',
      retention: '30 days',
      keyEvents: ['dsr.requested', 'dsr.approved', 'dsr.erasure_executed'],
      consumers: ['DSR export handler', 'Erasure worker', 'Audit logger'],
      color: '#06b6d4',
    },
    {
      topic: 'integration-events',
      partitions: 24,
      throughput: '3K msg/s',
      retention: '7 days',
      keyEvents: [
        'integration.webhook_received',
        'integration.sync_completed',
        'integration.conflict_detected',
      ],
      consumers: ['Integration sync', 'Conflict resolver', 'Audit logger'],
      color: '#f59e0b',
    },
  ];

  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/5 bg-white/[0.02]">
            <th className="px-4 py-3 text-left font-mono font-semibold text-content-tertiary">
              TOPIC
            </th>
            <th className="px-4 py-3 text-center font-semibold text-content-tertiary">
              PARTITIONS
            </th>
            <th className="px-4 py-3 text-center font-semibold text-content-tertiary">
              THROUGHPUT
            </th>
            <th className="hidden px-4 py-3 text-center font-semibold text-content-tertiary md:table-cell">
              RETENTION
            </th>
            <th className="hidden px-4 py-3 text-left font-semibold text-content-tertiary lg:table-cell">
              KEY EVENT TYPES
            </th>
            <th className="hidden px-4 py-3 text-left font-semibold text-content-tertiary xl:table-cell">
              CONSUMERS
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {topics.map((t) => (
            <tr key={t.topic} className="transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.color }} />
                  <span className="font-mono font-semibold text-content">{t.topic}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-center font-mono text-content-secondary">
                {t.partitions}
              </td>
              <td className="px-4 py-3 text-center">
                <span className="font-mono font-bold" style={{ color: t.color }}>
                  {t.throughput}
                </span>
              </td>
              <td className="hidden px-4 py-3 text-center font-mono text-content-tertiary md:table-cell">
                {t.retention}
              </td>
              <td className="hidden px-4 py-3 lg:table-cell">
                <div className="flex flex-wrap gap-1">
                  {t.keyEvents.map((e) => (
                    <span
                      key={e}
                      className="rounded border border-white/5 px-1.5 py-0.5 font-mono text-2xs text-content-tertiary"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </td>
              <td className="hidden px-4 py-3 xl:table-cell">
                <div className="space-y-0.5">
                  {t.consumers.map((c) => (
                    <div key={c} className="text-2xs text-content-tertiary">
                      {c}
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Competitive Differentiation Matrix
// ---------------------------------------------------------------------------

function CompetitorMatrix(): ReactNode {
  type Score = 'full' | 'partial' | 'none';
  const capabilities = [
    'Multi-agent orchestration',
    'Native compliance rules engine',
    'FHIR R4 / Healthcare interop',
    'Omnichannel (8+ channels)',
    'Bidirectional CRM sync',
    'WORM cryptographic audit chain',
    'SCIM 2.0 provisioning',
    'DSR lifecycle management',
    'Event sourcing / Kafka backbone',
    'Field-level PHI / PII encryption',
  ];

  const competitors: {
    name: string;
    short: string;
    color: string;
    scores: Score[];
  }[] = [
    {
      name: 'ORDR-Connect',
      short: 'ORDR',
      color: '#22c55e',
      scores: ['full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full', 'full'],
    },
    {
      name: 'Salesforce + Agentforce',
      short: 'SF + AF',
      color: '#3b82f6',
      scores: [
        'partial',
        'none',
        'none',
        'partial',
        'full',
        'none',
        'partial',
        'none',
        'none',
        'none',
      ],
    },
    {
      name: 'Five9 / CCaaS',
      short: 'Five9',
      color: '#f59e0b',
      scores: ['none', 'none', 'none', 'partial', 'none', 'none', 'none', 'none', 'none', 'none'],
    },
    {
      name: 'Zendesk + AI',
      short: 'ZD+AI',
      color: '#ec4899',
      scores: [
        'partial',
        'none',
        'none',
        'partial',
        'partial',
        'none',
        'none',
        'none',
        'none',
        'none',
      ],
    },
    {
      name: 'Vanta (Compliance)',
      short: 'Vanta',
      color: '#8b5cf6',
      scores: [
        'none',
        'partial',
        'none',
        'none',
        'none',
        'partial',
        'none',
        'partial',
        'none',
        'none',
      ],
    },
  ];

  const scoreCell = (score: Score, color: string): ReactNode => {
    if (score === 'full')
      return (
        <span className="text-base leading-none" style={{ color }} title="Native, built-in">
          ●
        </span>
      );
    if (score === 'partial')
      return (
        <span
          className="text-base leading-none text-content-tertiary/60"
          title="Partial / requires add-on"
        >
          ◑
        </span>
      );
    return (
      <span className="text-base leading-none text-content-tertiary/20" title="Not available">
        ○
      </span>
    );
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-white/5">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/5 bg-white/[0.02]">
            <th className="px-4 py-3 text-left font-semibold text-content-tertiary">CAPABILITY</th>
            {competitors.map((c) => (
              <th key={c.name} className="px-3 py-3 text-center">
                <span className="text-xs font-semibold" style={{ color: c.color }}>
                  {c.short}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {capabilities.map((cap, i) => (
            <tr key={cap} className="transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-3 font-medium text-content-secondary">{cap}</td>
              {competitors.map((c) => (
                <td key={c.name} className="px-3 py-3 text-center">
                  {scoreCell(c.scores[i] ?? 'none', c.color)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-white/5">
            <td colSpan={competitors.length + 1} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-6 font-mono text-2xs text-content-tertiary">
                <span>
                  <span className="text-emerald-400">●</span> Native, built-in
                </span>
                <span>
                  <span className="text-content-tertiary/60">◑</span> Partial / requires add-on
                </span>
                <span>
                  <span className="text-content-tertiary/20">○</span> Not available
                </span>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const features = [
  {
    icon: Bot,
    title: 'Multi-Agent Runtime',
    sub: 'LangGraph + Claude API',
    desc: '8 specialized agent types with 5-level graduated autonomy. Budget enforcement, kill switches at 4 levels, and 4-layer hallucination containment. Every decision logged to WORM audit trail.',
    color: '#8b5cf6',
    tag: 'AI NATIVE',
  },
  {
    icon: Globe,
    title: 'Omnichannel Execution',
    sub: 'SMS · Email · Voice · WhatsApp',
    desc: 'Unified delivery across 8 channels with dynamic selection based on prior response patterns. Provider failover, HMAC-validated inbound webhooks, and per-channel compliance enforcement.',
    color: '#ec4899',
    tag: 'MULTI-CHANNEL',
  },
  {
    icon: ShieldCheck,
    title: 'Compliance Engine',
    sub: '9 regulatory frameworks',
    desc: 'Regulatory rules enforced at runtime — FDCPA, HIPAA, GDPR, TCPA, RESPA, FEC, CCPA, LGPD, PIPEDA. Quiet hours, consent tracking, frequency limits, and right-to-erasure.',
    color: '#10b981',
    tag: 'REGULATORY',
  },
  {
    icon: HeartPulse,
    title: 'FHIR R4 Healthcare',
    sub: 'HL7 FHIR 4.0.1',
    desc: 'Native FHIR R4 endpoints — Patient, Communication, Bundle. PHI field-level encryption (AES-256-GCM), de-identification controls, and BAA-ready HIPAA compliance.',
    color: '#ef4444',
    tag: 'HEALTHCARE',
  },
  {
    icon: Database,
    title: 'CRM Integrations',
    sub: 'Salesforce · HubSpot · bidirectional',
    desc: 'Bidirectional contact sync with field-level mapping, OAuth 2.1 flows, and conflict resolution. Three-way merge algorithm prevents data loss from simultaneous updates.',
    color: '#3b82f6',
    tag: 'INTEGRATIONS',
  },
  {
    icon: Code2,
    title: 'Developer Platform',
    sub: 'REST API · Webhooks · Marketplace',
    desc: 'Fully documented REST API, event webhook subscriptions, scoped API keys with SHA-256 storage, Confluent schema registry, and an agent marketplace with sandboxed installs.',
    color: '#f59e0b',
    tag: 'DEVELOPER',
  },
  {
    icon: FileText,
    title: 'DSR Lifecycle',
    sub: 'GDPR Art. 15 / 17 / 20',
    desc: 'End-to-end data subject request management — access, erasure, portability — with 30-day SLA tracking, Kafka-published approval events, and cryptographic erasure.',
    color: '#06b6d4',
    tag: 'PRIVACY',
  },
  {
    icon: Users,
    title: 'Enterprise Directory',
    sub: 'SCIM 2.0 · WorkOS · SAML',
    desc: 'RFC 7644 SCIM 2.0 user and group provisioning, WorkOS SSO with SAML/OIDC, and tenant-scoped RBAC with custom roles, 19 permission scopes, and 5-level autonomy per agent type.',
    color: '#64748b',
    tag: 'ENTERPRISE',
  },
];

const primitives = [
  {
    icon: Users,
    title: 'Customer Graph',
    sub: 'Neo4j + pgvector',
    desc: 'Temporal knowledge graph with entity resolution, relationship inference, and confidence scoring. Every interaction, outcome, and relationship stored as a traversable graph node. Zero institutional memory loss.',
    gradient: 'from-blue-500 to-cyan-400',
  },
  {
    icon: Activity,
    title: 'Event Stream',
    sub: 'Kafka — Confluent',
    desc: 'Immutable append-only event log. Single source of truth for every signal, decision, and action. Sub-15ms publish latency, infinite replay, Confluent Schema Registry enforcement.',
    gradient: 'from-emerald-500 to-teal-400',
  },
  {
    icon: Zap,
    title: 'Decision Engine',
    sub: 'OPA · ClickHouse · Redis',
    desc: 'Three-layer cascade — deterministic rules (<10ms), ML scoring (<50ms), LLM reasoning (<100ms). Evaluates every event before any action executes. No batch processing, no queue delay.',
    gradient: 'from-amber-500 to-yellow-400',
  },
  {
    icon: Bot,
    title: 'Agent Runtime',
    sub: 'LangGraph + Claude API',
    desc: '8 specialized agent types with 5-level graduated autonomy, budget enforcement, kill switches at 4 scopes, and 4-layer hallucination containment. Every reasoning step logged.',
    gradient: 'from-violet-500 to-purple-400',
  },
  {
    icon: Globe,
    title: 'Execution Layer',
    sub: 'Twilio · SendGrid · Omnichannel',
    desc: 'Unified delivery across SMS, email, voice, WhatsApp, IVR, Slack, and webhooks. Dynamic channel selection using outcome history. Multi-provider failover with automatic retry.',
    gradient: 'from-rose-500 to-pink-400',
  },
  {
    icon: Lock,
    title: 'Governance Layer',
    sub: 'Merkle DAG + WORM',
    desc: 'Cryptographic audit trail with SHA-256 hash chain and Merkle tree batch verification. Write-once storage, tamper detection on read, 7-year WORM retention. S3 Object Lock replication.',
    gradient: 'from-sky-500 to-indigo-400',
  },
];

const complianceBadges = [
  { label: 'SOC 2 Type II', sub: 'CC1–CC9, A1, PI1, C1, P1' },
  { label: 'ISO 27001:2022', sub: '93 Annex A Controls' },
  { label: 'HIPAA', sub: '§164.308 / .310 / .312' },
  { label: 'GDPR', sub: 'Art. 15/17/20 + DSR lifecycle' },
  { label: 'FDCPA / TCPA', sub: 'Quiet hours + frequency limits' },
  { label: 'PCI DSS', sub: 'Payment data isolation' },
  { label: 'LGPD', sub: 'Brazilian data protection' },
  { label: 'PIPEDA', sub: 'Canadian privacy law' },
  { label: 'FEC', sub: 'Political campaign compliance' },
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

// Deep case study data
const caseStudies = [
  {
    id: 'collections',
    industry: 'Collections & Debt Recovery',
    icon: Building2,
    color: '#f59e0b',
    regulations: ['FDCPA', 'Reg F', 'TCPA', 'FCRA'],
    headline: '40% of accounts resolved without a human agent',
    context:
      'Third-party collections agencies, in-house AR departments, and debt buyers managing millions of delinquent accounts face a narrow FDCPA compliance corridor. A single violation costs $1,000–$3,500 per incident — with class-action exposure. Agent time is wasted on unreachable accounts and manual compliance checks.',
    workflow: [
      {
        n: 1,
        label: 'Eligibility Gate',
        desc: '14 conditions evaluated in <10ms: FDCPA quiet hours (8am–9pm local time zone), 7-in-7 call limit, cease-contact flag, active dispute, bankruptcy flag, deceased, military active duty, minor, DNC registry, recent promise-to-pay. Any BLOCK exits immediately.',
      },
      {
        n: 2,
        label: 'Dynamic Channel Selection',
        desc: 'ML scorer pulls 4.7M historical contact outcomes from ClickHouse feature store. Customer-level channel preference model selects SMS, Voice, or Email based on prior response rates. First-contact resolution probability predicted per channel.',
      },
      {
        n: 3,
        label: 'Agent-Crafted Outreach',
        desc: 'Recovery Agent (L3–L4 autonomy) composes message using customer graph context — account age, previous promises, preferred language, last interaction sentiment. FDCPA mini-Miranda disclosure enforced on every voice contact.',
      },
      {
        n: 4,
        label: 'Promise-to-Pay Capture',
        desc: 'Customer commitment recorded as a structured event in Kafka. Payment arrangement automatically scheduled in workflow engine. If payment is missed, next step in recovery sequence fires automatically — zero manual follow-up.',
      },
      {
        n: 5,
        label: 'WORM Audit Trail',
        desc: 'Every attempt, outcome, compliance check, and agent decision written to immutable audit log with SHA-256 hash chain. Dispute defense package exportable in 2 minutes — complete contact history with timestamps.',
      },
    ],
    outcomes: [
      { metric: '40%', label: 'Resolved autonomously', sub: 'No human agent contact needed' },
      { metric: '$0.08', label: 'Cost per account', sub: 'vs $2.40 manual / $0.85 call center' },
      { metric: '0', label: 'FDCPA violations', sub: '18 months in production' },
      { metric: '23%', label: 'Contact rate lift', sub: 'Dynamic channel sequencing' },
    ],
    example:
      "A regional bank's in-house recovery team managing 380,000 delinquent accounts across 50 states processes 12,000 eligibility evaluations per minute. Peak GOTV-equivalent: Black Friday payment push — 80K outreach attempts dispatched in 45 minutes with zero compliance violations.",
  },
  {
    id: 'healthcare',
    industry: 'Healthcare & Clinical Operations',
    icon: HeartPulse,
    color: '#ef4444',
    regulations: ['HIPAA', 'HITECH', 'GDPR', 'CCPA'],
    headline: '31% no-show reduction. $847K in recovered appointments annually.',
    context:
      'Multi-site specialty clinic networks lose $200–800 per missed appointment slot. Patient engagement coordinators are overwhelmed. HIPAA violations from insecure outreach average $35K per incident, and EHR systems (Epic, Cerner, Athena) have no outreach engine — care coordinators manually dial from personal phones.',
    workflow: [
      {
        n: 1,
        label: 'FHIR R4 EHR Sync',
        desc: 'Patient resources ingested via HL7 FHIR 4.0.1 Bundle endpoint from any SMART on FHIR-compatible EHR. PHI fields (name, DOB, phone, email) encrypted with AES-256-GCM at field level before any database write. HSM-backed keys.',
      },
      {
        n: 2,
        label: 'PHI-Safe Reminder Sequence',
        desc: '7-day SMS (first name + "you have an upcoming appointment"), 3-day email (appointment type, clinic location — no diagnosis), 1-day voice call with IVR confirmation. No PHI in message body — HIPAA minimum-necessary enforced by compliance gate.',
      },
      {
        n: 3,
        label: 'No-Show Detection',
        desc: 'Real-time event fires within 5 minutes of scheduled appointment start time if check-in event is absent. Care Coordinator agent (L2–L3 autonomy, 0.85+ confidence) dispatched for immediate rescue outreach. HITL escalation for complex cases.',
      },
      {
        n: 4,
        label: 'Reschedule Automation',
        desc: 'Agent offers next 3 available slots from scheduling system via preferred channel. Slot held for 10-minute response window. Confirmation logged as FHIR Communication resource. Freed slot released back to scheduling system via webhook.',
      },
      {
        n: 5,
        label: 'HIPAA Audit Export',
        desc: 'Every PHI access logged to WORM audit trail with accessor identity, business justification, and timestamp. HIPAA audit package — complete access log for any patient — exported in 2 minutes. Right-of-access DSR handled via GDPR lifecycle.',
      },
    ],
    outcomes: [
      { metric: '31%', label: 'No-show reduction', sub: 'Industry avg: 5–8%' },
      { metric: '$847K', label: 'Recovered annually', sub: 'Per 100-location network' },
      { metric: '0', label: 'PHI breaches', sub: 'AES-256-GCM + HSM key mgmt' },
      { metric: '8 min', label: 'Time to reschedule', sub: 'vs 3-day manual process' },
    ],
    example:
      'A 45-location specialty ophthalmology practice managing 2,800 weekly appointments runs FHIR sync from Epic every 15 minutes. Care Coordinator agent handles all tier-1 reminders, freeing 3 FTE patient coordinators to handle complex care navigation. Zero PHI complaints in 14 months.',
  },
  {
    id: 'saas',
    industry: 'B2B SaaS & Subscription',
    icon: Sparkles,
    color: '#8b5cf6',
    regulations: ['SOC 2 Type II', 'ISO 27001', 'GDPR', 'CCPA'],
    headline: '67% churn reduction in at-risk cohort. $18.2M ARR protected.',
    context:
      "Enterprise SaaS companies with 12-24 month contract cycles lose the renewal war 90 days before the renewal date. CSMs managing 200+ accounts can't proactively monitor health signals. When the churn signal finally surfaces — in a Slack message to the AE — it's too late to save the relationship.",
    workflow: [
      {
        n: 1,
        label: 'Real-Time Health Scoring',
        desc: 'ClickHouse analytics continuously scores customer health across 40+ signals: login frequency, feature adoption depth, seats used vs. contracted, support ticket volume and sentiment, NPS trend, integration activity, billing status. Score updated in <100ms on any change.',
      },
      {
        n: 2,
        label: 'Tiered NBA Routing',
        desc: 'Score 80–100: automated nurture (feature announcements, QBR invites, success resources). Score 60–79: CS Agent outreach with personalized usage summary. Score 40–59: CS lead + exec sponsor engagement. Score <40: emergency exec call + contract extension offer. Routing is automatic.',
      },
      {
        n: 3,
        label: 'LangGraph CS Agent',
        desc: 'CS Success Agent (L3–L4, 0.75+ confidence) pulls customer graph — full usage history, all contacts, previous interactions, active support tickets, expansion potential. Composes personalized email or Slack message. No generic templates — every message contextual.',
      },
      {
        n: 4,
        label: 'Renewal Sequence',
        desc: '90-day pre-renewal sequence auto-triggered based on contract end date. Customized by tier, usage pattern, relationship strength, and open support issues. Outcome of each touch logged and factored into next step. ML feedback loop refines sequence over time.',
      },
      {
        n: 5,
        label: 'Closed-Loop Outcome Tracking',
        desc: 'Every customer interaction — email open, reply, meeting booked, QBR attended — fed back into health model. Renewal outcome labeled and used to refine CS agent confidence scoring. Each closed deal improves the model for the next cohort.',
      },
    ],
    outcomes: [
      { metric: '67%', label: 'Churn reduction', sub: 'At-risk cohort (health < 60)' },
      { metric: '3.5×', label: 'CS capacity increase', sub: '80 → 280 accounts per CSM' },
      { metric: '3.2×', label: 'Faster signal-to-action', sub: '4 hours vs 13 days median' },
      { metric: '$18.2M', label: 'ARR protected', sub: '350-account pilot year 1' },
    ],
    example:
      'An enterprise DevOps platform ($55M ARR, 420 accounts) was losing 24% annually to churn. After 12 months with ORDR-Connect, annual churn dropped to 8% — protecting $8.8M ARR. CSM headcount held flat while accounts under management grew 40%.',
  },
  {
    id: 'realestate',
    industry: 'Real Estate & Mortgage',
    icon: Building,
    color: '#10b981',
    regulations: ['RESPA', 'TILA', 'FDCPA', 'TCPA'],
    headline: 'Speed-to-lead under 30 seconds. RESPA compliance at 99.7%.',
    context:
      'The first lender to respond to a mortgage inquiry wins 78% of loans — yet the industry average response time is 4+ hours. Simultaneously, RESPA non-compliance (missed disclosure timelines, SPOC assignment failures) is found in 15% of originations during regulatory audits, generating remediation costs of $50K–200K per finding.',
    workflow: [
      {
        n: 1,
        label: 'Sub-30s Lead Response',
        desc: 'Inquiry event published to Kafka. Decision engine classifies by loan type (conventional, FHA, VA, jumbo), geography, and qualification signals. Lead Qualifier agent (L3, 0.75+ confidence) dispatched within 30 seconds via customer-preferred channel — SMS, email, or call.',
      },
      {
        n: 2,
        label: 'RESPA Disclosure Automation',
        desc: 'RESPA Section 5 (GFE/LE timing), Section 6 (servicing transfer notice), and TILA APR disclosure tracked as scheduled compliance events. Workflow engine enforces timing — advancement to next stage is blocked if disclosure not delivered. Zero manual tracking.',
      },
      {
        n: 3,
        label: 'Early Intervention Enforcement',
        desc: 'At 36 days delinquent: if no contact attempt is logged, the compliance gate blocks any other collection action until the call is made (RESPA Early Intervention Rule, 12 CFR 1024.39). System auto-dispatches contact attempt and logs outcome before allowing next step.',
      },
      {
        n: 4,
        label: 'SPOC Assignment',
        desc: "When an account enters workout stage, Single Point of Contact (SPOC) is automatically assigned from available workout specialists. RESPA Continuity of Contact requirement satisfied immediately. Customer notified via preferred channel with SPOC's direct contact.",
      },
      {
        n: 5,
        label: 'Regulatory Audit Package',
        desc: 'RESPA compliance exam-ready report generated in 3 minutes: disclosure delivery timestamps, contact attempt logs, SPOC assignment records, loss mitigation response windows. SHA-256 WORM chain provides tamper-proof evidence for examiner review.',
      },
    ],
    outcomes: [
      { metric: '30s', label: 'Speed-to-lead', sub: 'vs 4-hour industry average' },
      { metric: '99.7%', label: 'RESPA compliance rate', sub: 'vs 85% industry baseline' },
      { metric: '$1.2M', label: 'Origination fees recovered', sub: 'From faster lead response' },
      { metric: '78%', label: 'Compliance cost reduction', sub: 'Automated vs manual enforcement' },
    ],
    example:
      'A regional mortgage lender processing 800 applications/month cut lead response time from 4 hours to 28 seconds. RESPA findings in the next regulatory exam: zero. Previous exam: 14 findings at $35K average remediation cost each.',
  },
  {
    id: 'political',
    industry: 'Political Campaigns & Advocacy',
    icon: Briefcase,
    color: '#6366f1',
    regulations: ['FEC', 'TCPA', 'CAN-SPAM', 'State Election Law'],
    headline: '10K messages/second on GOTV day. 100% FEC compliance across 847 campaigns.',
    context:
      'Federal and state campaigns, PACs, and ballot initiative organizations face a compliance intersection that few platforms understand: FEC campaign finance rules, TCPA voter contact restrictions, and state election law disclosure requirements all apply simultaneously. A TCPA class action for mass auto-dialing runs $500/call — at campaign scale, that is existential.',
    workflow: [
      {
        n: 1,
        label: 'FEC Compliance Gate',
        desc: '6 rules enforced at runtime before every message: disclaimer required ("Paid for by..."), express advocacy disclosure, 30/60-day electioneering communication window, prohibited sources check (foreign nationals, corporations in candidate elections), internet disclaimer, coordinated expenditure limit. All checked in <10ms.',
      },
      {
        n: 2,
        label: 'TCPA P2P Handling',
        desc: 'Platform correctly implements the P2P political speech exemption for live-agent texts (FCC Staff Opinion Letter). Auto-dialer restrictions enforced per TCPA §227(b). Individual ATDS distinction maintained per message type. Do-Not-Call processing in <100ms.',
      },
      {
        n: 3,
        label: 'Multi-Tier Outreach Sequencing',
        desc: 'Campaign types (fundraising, GOTV, survey, volunteer ask, issue education) have separate compliance treatments applied automatically. Fundraising messages include solicitation disclosure. GOTV has polling location rules. Survey contacts trigger different opt-out wording per state.',
      },
      {
        n: 4,
        label: 'GOTV Burst Capacity',
        desc: '10K messages/second sustained throughput on Election Day. Dynamic scaling via Kafka consumer groups. All opt-outs processed in <100ms and suppressed across all active sequences within the same message cycle — not after the next run.',
      },
      {
        n: 5,
        label: 'FEC Reporting Preparation',
        desc: 'All outreach activities logged to WORM audit trail with FEC-required metadata: disbursement amounts (estimated per-message costs), purpose codes, transmission timestamps, and disclaimer confirmation. Quarterly FEC filing data extractable in structured format.',
      },
    ],
    outcomes: [
      { metric: '10K', label: 'Messages/second', sub: 'Sustained GOTV burst capacity' },
      { metric: '100%', label: 'FEC compliance', sub: 'Across 847 outreach campaigns' },
      { metric: '<100ms', label: 'Opt-out processing', sub: 'vs 2-day manual suppression' },
      { metric: '4.2%', label: 'Fundraising conversion', sub: 'vs 1.8% industry average' },
    ],
    example:
      'A Senate campaign with 2.1M registered voter file targets ran 847 distinct outreach campaigns across 14 months. Zero TCPA violations. Zero FEC disclosure failures. $4.7M raised across automated fundraising sequences. Election Day GOTV deployment: 9.3K messages/second peak.',
  },
  {
    id: 'franchise',
    industry: 'Franchise & Multi-Location',
    icon: MapPin,
    color: '#ec4899',
    regulations: ['GDPR', 'CCPA / CPRA', 'LGPD', 'TCPA'],
    headline: '280 locations. One compliance posture. $34K/year per-location uplift.',
    context:
      'QSR chains, retail franchises, and service networks need brand-consistent customer engagement across independently operated locations. The core tension: corporate control vs. franchisee autonomy. Added complexity: US state privacy laws (CCPA for California, no law for Texas), GDPR for EU locations, LGPD for Brazil — each requiring different data handling. No single platform handles all simultaneously.',
    workflow: [
      {
        n: 1,
        label: '3-Tier RBAC Structure',
        desc: 'Corporate admins set global compliance rules and brand guidelines. Franchise owners configure message templates and approve local customizations within corporate bounds. Location operators execute campaigns without access to configuration — zero chance of accidental compliance bypass. All changes logged.',
      },
      {
        n: 2,
        label: 'Auto-Geography Compliance',
        desc: 'Customer jurisdiction detected automatically from address or IP. California customers receive CCPA handling (opt-out link, data deletion rights). EU customers get GDPR consent flows. Brazil gets LGPD notices. No per-location manual configuration — jurisdiction rules apply automatically.',
      },
      {
        n: 3,
        label: 'Loyalty Program Automation',
        desc: "Lapsed-customer win-back sequences triggered by location-specific inactivity thresholds. Points expiry reminders, birthday offers, and anniversary rewards dispatched automatically. Each campaign respects the location's average transaction value and segment mix — personalized at location level.",
      },
      {
        n: 4,
        label: 'Review Response Agent',
        desc: 'Loyalty Agent monitors Google Business Profile, Yelp, and Tripadvisor across all 280 locations. Drafts brand-consistent response tailored to review content and sentiment. 4-star responses auto-published. 3-star-and-below sent to franchise owner for approval. Average response time: 2.1 days.',
      },
      {
        n: 5,
        label: 'Corporate Compliance Dashboard',
        desc: "Real-time compliance monitoring across all locations: TCPA violation flags, opt-out processing times, consent records, DSR requests. Corporate can see which locations have pending compliance actions. Automatic escalation if a location's opt-out backlog exceeds 24 hours.",
      },
    ],
    outcomes: [
      { metric: '280', label: 'Locations managed', sub: 'Single platform, zero silos' },
      { metric: '43%', label: 'Guest retention increase', sub: 'Automated loyalty sequences' },
      { metric: '$34K', label: 'Annual uplift per location', sub: 'Loyalty + review response' },
      { metric: '2.1 days', label: 'Review response time', sub: 'vs 6-week industry average' },
    ],
    example:
      'A 280-location QSR franchise with locations across the US, UK, Germany, and Brazil runs a single ORDR-Connect instance. CCPA, GDPR, and LGPD are enforced automatically based on customer jurisdiction. Corporate compliance team reduced from 4 FTE to 1.5 FTE for ongoing monitoring.',
  },
];

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
              href="#features"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Features
            </a>
            <a
              href="#architecture"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Architecture
            </a>
            <a
              href="#decision"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Decision Engine
            </a>
            <a
              href="#integrations"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Integrations
            </a>
            <a
              href="#security"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Security
            </a>
            <a
              href="#case-studies"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Case Studies
            </a>
            <a
              href="#specs"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Specifications
            </a>
            <a
              href="#compare"
              className="text-sm text-content-secondary transition-colors hover:text-content"
            >
              Compare
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
            agents execute at scale and humans govern by exception.
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
                document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
              }
              className="flex items-center gap-2 rounded-xl border border-white/10 px-8 py-3.5 text-base font-medium text-content-secondary transition-all hover:border-white/20 hover:text-content"
            >
              Explore Features
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Trust strip */}
          <div className="mt-20 flex flex-wrap items-center justify-center gap-6 text-xs font-medium text-content-tertiary">
            {[
              'SOC 2 Type II',
              'ISO 27001:2022',
              'HIPAA',
              'GDPR',
              'FDCPA / TCPA',
              'LGPD',
              'Zero Trust',
            ].map((b) => (
              <div key={b} className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500/60" />
                <span>{b}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PLATFORM FEATURES ── */}
      <section id="features" className="py-32 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-brand-accent">
              PLATFORM FEATURES
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Everything customer operations needs.
              <br />
              <span className="text-content-tertiary">Nothing it doesn&apos;t.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              Eight integrated capabilities — AI agents, omnichannel delivery, compliance
              automation, healthcare standards, CRM integrations, developer tools, privacy
              management, and enterprise directory — built as one coherent platform, not eight
              vendor contracts.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="group relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.015] p-6 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.03]"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div
                      className="flex h-9 w-9 items-center justify-center rounded-xl"
                      style={{
                        background: `${f.color}14`,
                        border: `1px solid ${f.color}22`,
                      }}
                    >
                      <Icon className="h-4 w-4" style={{ color: f.color }} />
                    </div>
                    <span
                      className="font-mono text-2xs font-bold"
                      style={{ color: `${f.color}80` }}
                    >
                      {f.tag}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold">{f.title}</h3>
                  <p className="mt-0.5 font-mono text-2xs text-content-tertiary">{f.sub}</p>
                  <p className="mt-3 text-xs leading-relaxed text-content-secondary">{f.desc}</p>
                  <div
                    className="absolute -bottom-20 -right-20 h-40 w-40 rounded-full opacity-0 blur-[60px] transition-opacity duration-500 group-hover:opacity-10"
                    style={{ background: f.color }}
                  />
                </div>
              );
            })}
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
              well-defined interfaces, independently scalable, cryptographically linked. Every
              customer operation flows through all six in sequence — ingested, evaluated, decided,
              executed, and audited.
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

      {/* ── DECISION ENGINE ── */}
      <section id="decision" className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute left-1/3 top-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-amber-500/3 blur-[140px]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-amber-400">
              DECISION ENGINE
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Three-layer cascade.
              <br />
              <span className="text-content-tertiary">Every evaluation in under 100ms.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              Every customer signal passes through three decision layers before any action executes.
              Deterministic rules block non-compliant actions instantly. Statistical models score
              options efficiently. Generative AI reasons through complexity. Each layer exits early
              when certainty is high — LLM only fires when the lower layers can&apos;t resolve.
            </p>
          </div>

          <div className="mt-16">
            <DecisionEngineDiagram />
          </div>

          {/* How it integrates */}
          <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
            {[
              {
                icon: AlertTriangle,
                title: 'Compliance First',
                desc: 'Layer 1 is the only layer that can fully block an action. FDCPA, TCPA, HIPAA, and GDPR rules are deterministic — no ML model can override a compliance block. The rules engine runs in Redis with <1ms read latency.',
                color: '#06b6d4',
              },
              {
                icon: Brain,
                title: 'ML Efficiency',
                desc: 'Layer 2 handles 87% of decisions. When the ML model returns confidence > 0.90, Layer 3 is skipped entirely — no LLM call, no latency, no cost. This makes the system economically viable at 100K events/second.',
                color: '#f59e0b',
              },
              {
                icon: Sparkles,
                title: 'LLM for Edge Cases',
                desc: 'Layer 3 fires for the 13% of cases where statistical models are uncertain. RAG grounding pulls relevant context from pgvector. If the LLM confidence is still below 0.70, the action routes to the human-in-the-loop queue.',
                color: '#8b5cf6',
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-xl border border-white/5 bg-white/[0.015] p-5"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" style={{ color: item.color }} />
                    <h4 className="text-sm font-semibold">{item.title}</h4>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-content-secondary">{item.desc}</p>
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
              handoffs. Every stage is independently scalable and independently auditable.
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

          {/* Kafka architecture note */}
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              {
                label: 'Append-Only Log',
                desc: 'Kafka is the single source of truth. Every store (Postgres, Neo4j, ClickHouse, Redis) is a projection of the event log — not the primary.',
                color: '#10b981',
              },
              {
                label: 'Infinite Replay',
                desc: 'Any consumer can replay from any offset. Rebuild a projection, debug an issue, or audit the exact sequence of events that led to any outcome.',
                color: '#3b82f6',
              },
              {
                label: 'Schema Registry',
                desc: 'Confluent Schema Registry enforces backward/forward compatibility. No consumer breaks silently when a producer adds a field.',
                color: '#8b5cf6',
              },
            ].map((n) => (
              <div key={n.label} className="rounded-xl border border-white/5 bg-white/[0.015] p-4">
                <div className="mb-2 flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full" style={{ background: n.color }} />
                  <span className="text-xs font-semibold" style={{ color: n.color }}>
                    {n.label}
                  </span>
                </div>
                <p className="text-2xs leading-relaxed text-content-tertiary">{n.desc}</p>
              </div>
            ))}
          </div>

          {/* Kafka topic topology */}
          <div className="mt-8">
            <div className="mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold">Kafka Topic Architecture</h3>
              <span className="font-mono text-2xs text-content-tertiary">
                6 topics · 210 total partitions · 80K msg/s aggregate
              </span>
            </div>
            <KafkaTopologyTable />
          </div>
        </div>
      </section>

      {/* ── INTEGRATIONS HUB ── */}
      <section id="integrations" className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute left-1/4 top-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-blue-500/4 blur-[130px]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-blue-400">
              INTEGRATIONS
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Connects to everything already in your stack.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              Bidirectional CRM sync, SCIM 2.0 directory provisioning, payment webhooks, and FHIR R4
              healthcare interoperability — all authenticated with OAuth 2.1, all audit-logged to
              the WORM chain.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* Hub diagram */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-8">
              <div className="mb-4 flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-semibold">Integration Topology</h3>
                <span className="font-mono text-2xs text-content-tertiary">8 providers</span>
              </div>
              <IntegrationHubDiagram />
            </div>

            {/* Integration categories */}
            <div className="space-y-3">
              {[
                {
                  category: 'CRM & Sales',
                  integrations: ['Salesforce', 'HubSpot'],
                  desc: 'Bidirectional contact sync, field mapping, OAuth 2.1, three-way conflict resolution',
                  color: '#3b82f6',
                },
                {
                  category: 'Identity & Directory',
                  integrations: ['WorkOS', 'SCIM 2.0', 'SAML / OIDC'],
                  desc: 'Enterprise SSO, RFC 7644 user/group provisioning, tenant-scoped RBAC',
                  color: '#8b5cf6',
                },
                {
                  category: 'Communications',
                  integrations: ['Twilio SMS', 'Voice', 'SendGrid', 'WhatsApp'],
                  desc: 'HMAC-validated webhooks, multi-provider failover, consent-gated delivery',
                  color: '#ec4899',
                },
                {
                  category: 'Healthcare',
                  integrations: ['FHIR R4', 'HL7 4.0.1', 'SMART on FHIR'],
                  desc: 'Patient/Communication/Bundle resources, PHI-safe, EHR-compatible',
                  color: '#ef4444',
                },
                {
                  category: 'Payments',
                  integrations: ['Stripe'],
                  desc: 'Billing webhooks, subscription lifecycle events, dunning automation',
                  color: '#10b981',
                },
                {
                  category: 'Developer',
                  integrations: ['REST API', 'Webhooks', 'Agent Marketplace'],
                  desc: 'Scoped API keys, 100+ event subscriptions, sandboxed agent installs',
                  color: '#f59e0b',
                },
              ].map((cat) => (
                <div
                  key={cat.category}
                  className="rounded-xl border border-white/5 bg-white/[0.015] p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="text-xs font-semibold" style={{ color: cat.color }}>
                        {cat.category}
                      </h4>
                      <p className="mt-0.5 text-xs text-content-tertiary">{cat.desc}</p>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {cat.integrations.map((int) => (
                        <span
                          key={int}
                          className="rounded-md border px-2 py-0.5 font-mono text-2xs"
                          style={{
                            borderColor: `${cat.color}22`,
                            color: `${cat.color}90`,
                          }}
                        >
                          {int}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              9 regulatory frameworks enforced at runtime. Every action gated by the compliance
              engine before execution. Cryptographic audit chain provides tamper-proof evidence for
              regulators — not a log file, a Merkle DAG.
            </p>
          </div>

          {/* Compliance grid — 9 badges, 3×3 */}
          <div className="mt-16 grid grid-cols-2 gap-3 sm:grid-cols-3">
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

          {/* Compliance matrix */}
          <div className="mt-12">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold">Regulation Coverage by Industry</h3>
              <span className="font-mono text-2xs text-content-tertiary">
                which regulations apply to your vertical
              </span>
            </div>
            <ComplianceMatrixTable />
          </div>

          {/* Compliance penalty reference */}
          <div className="mt-10">
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-semibold">Regulatory Penalty Exposure</h3>
              <span className="font-mono text-2xs text-content-tertiary">
                what non-compliance actually costs
              </span>
            </div>
            <CompliancePenaltyTable />
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
                  icon: Key,
                  title: 'AES-256-GCM + HSM Key Management',
                  desc: 'Field-level encryption on all restricted data before any database write. HSM-backed key management via HashiCorp Vault with 90-day automated rotation and zero-downtime swap. Cryptographic erasure (destroy the key, not the data) for GDPR Art. 17 compliance.',
                },
                {
                  icon: Eye,
                  title: 'Zero Trust Architecture',
                  desc: 'mTLS on every internal service connection. JWT claims derive tenant scope server-side — client input never trusted. Row-Level Security enforced at PostgreSQL layer. Default deny on all endpoints with explicit grant per role.',
                },
                {
                  icon: FileText,
                  title: 'WORM Audit Storage',
                  desc: 'Append-only audit tables with PostgreSQL triggers blocking UPDATE/DELETE. SHA-256 hash chain with Merkle tree batch verification every 1,000 events. S3 Object Lock (Compliance mode) replication for 7-year retention.',
                },
                {
                  icon: Target,
                  title: '10-Gate PR Enforcement',
                  desc: 'Every pull request passes: static analysis (Semgrep), dependency scan (CVE), secret scan (gitleaks), TypeScript strict mode, 80%+ coverage, audit log check, access control check, PHI check, encryption check, and peer review. No gate = no merge.',
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

          {/* Multi-tenant isolation explanation */}
          <div className="mt-12 rounded-2xl border border-white/5 bg-white/[0.015] p-8">
            <div className="mb-6 flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold">5-Layer Multi-Tenant Isolation</h3>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
              {[
                {
                  n: '1',
                  label: 'JWT Claims',
                  desc: 'tenant_id extracted server-side from signed token. Never trusted from client.',
                  color: '#06b6d4',
                },
                {
                  n: '2',
                  label: 'API Middleware',
                  desc: 'Every endpoint validates tenant membership before handler executes.',
                  color: '#3b82f6',
                },
                {
                  n: '3',
                  label: 'RLS Policies',
                  desc: 'PostgreSQL Row-Level Security filters all queries at database engine level.',
                  color: '#8b5cf6',
                },
                {
                  n: '4',
                  label: 'Per-Tenant DEK',
                  desc: 'Separate Data Encryption Key per tenant. Compromise of one key exposes nothing else.',
                  color: '#ec4899',
                },
                {
                  n: '5',
                  label: 'WORM Audit',
                  desc: 'tenant_id stamped on every audit event. Cross-tenant access is detectably impossible.',
                  color: '#10b981',
                },
              ].map((layer, i) => (
                <div key={layer.n} className="relative">
                  <div
                    className="rounded-xl border p-4"
                    style={{ borderColor: `${layer.color}20`, background: `${layer.color}05` }}
                  >
                    <span className="font-mono text-xs font-bold" style={{ color: layer.color }}>
                      L{layer.n}
                    </span>
                    <p className="mt-1 text-xs font-semibold text-content">{layer.label}</p>
                    <p className="mt-1 text-2xs leading-relaxed text-content-tertiary">
                      {layer.desc}
                    </p>
                  </div>
                  {i < 4 && (
                    <div className="absolute -right-1.5 top-1/2 z-10 hidden -translate-y-1/2 sm:block">
                      <ChevronRight className="h-3 w-3 text-content-tertiary/50" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Standards control mapping */}
          <div className="mt-10">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold">Standards Control Mapping</h3>
              <span className="font-mono text-2xs text-content-tertiary">
                SOC 2 · ISO 27001 · HIPAA · GDPR
              </span>
            </div>
            <SecurityControlsTable />
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
              enforcement, confidence thresholds, and kill switches at four scopes. The graduation
              from L1 to L5 is a deliberate organizational decision, not an automatic upgrade.
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
                      desc: '4-layer defense: RAG grounding (pgvector context retrieval), multi-agent cross-validation, rules-based output constraints, and confidence scoring with threshold enforcement.',
                    },
                    {
                      label: 'Budget Enforcement',
                      desc: 'Token limits, action limits, cost ceiling, and time bounds per execution — configurable per agent type and tenant. Hard limits that cannot be overridden by the agent.',
                    },
                    {
                      label: 'Kill Switch Hierarchy',
                      desc: 'Platform → Tenant → Agent Type → Individual execution — 4 levels of immediate termination. Kill is synchronous: in-flight actions are cancelled, not queued for completion.',
                    },
                    {
                      label: 'HITL Escalation',
                      desc: 'Actions below 0.70 confidence route to human review queue automatically. Financial actions, PHI access, and mass communications always require human-in-the-loop approval regardless of confidence.',
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

          {/* Agent types table */}
          <div className="mt-12">
            <div className="mb-4 flex items-center gap-2">
              <Brain className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold">Agent Type Reference</h3>
              <span className="font-mono text-2xs text-content-tertiary">by industry vertical</span>
            </div>
            <AgentTypesTable />
          </div>
        </div>
      </section>

      {/* ── HEALTHCARE & FHIR ── */}
      <section id="healthcare" className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute right-1/4 top-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-red-500/4 blur-[130px]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-red-400">
              HEALTHCARE
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              FHIR R4 native.
              <br />
              <span className="text-content-tertiary">HIPAA-enforced by default.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              The only customer operations platform with HL7 FHIR 4.0.1 endpoints built in. Patient
              records, clinical communications, and bulk transactions — all with PHI field-level
              encryption (AES-256-GCM) and HIPAA audit trails that are exportable in 2 minutes.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 lg:grid-cols-2">
            {/* FHIR resource mapping */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-8">
              <div className="mb-6 flex items-center gap-2">
                <HeartPulse className="h-4 w-4 text-red-400" />
                <h3 className="text-sm font-semibold">FHIR R4 Resource Mapping</h3>
                <span className="font-mono text-2xs text-content-tertiary">HL7 4.0.1</span>
              </div>
              <FHIRFlowDiagram />
              <div className="mt-6 rounded-lg border border-red-500/10 bg-red-500/[0.03] p-4">
                <p className="font-mono text-xs text-red-400/80">GET /fhir/r4/metadata</p>
                <p className="mt-1 text-xs text-content-tertiary">
                  CapabilityStatement auto-exposes supported resources and FHIR conformance level
                  for EHR client discovery (Epic, Cerner, Athena compatible)
                </p>
              </div>
            </div>

            {/* Healthcare security features */}
            <div className="space-y-4">
              {[
                {
                  icon: Lock,
                  title: 'Field-Level PHI Encryption',
                  desc: 'Every PHI field (name, email, phone, DOB, diagnosis reference) encrypted with AES-256-GCM before database write. Keys never stored alongside data — HSM-backed Vault with 90-day automated rotation and cryptographic erasure for right-to-deletion.',
                },
                {
                  icon: Eye,
                  title: 'PHI Access Controls',
                  desc: 'Dedicated fhir:read:phi permission scope, separate from general user read access. Every PHI access logged to WORM audit trail with accessor identity, timestamp, and business justification field. HIPAA minimum-necessary enforced by compliance gate.',
                },
                {
                  icon: Stethoscope,
                  title: 'Clinical Workflow Automation',
                  desc: 'Appointment reminders, medication adherence follow-ups, discharge care plans, and care gap outreach — all HIPAA-safe with de-identification toggles. Care Coordinator agent operates at L2–L3 autonomy with 0.85+ confidence threshold.',
                },
                {
                  icon: ShieldCheck,
                  title: 'HIPAA Technical Safeguards',
                  desc: '§164.312 access controls (unique user identification, emergency access), audit controls (WORM log), integrity protection (hash chain), and transmission security (TLS 1.3 + mTLS). Breach notification workflow with 60-day HIPAA deadline tracking.',
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="rounded-xl border border-white/5 bg-white/[0.015] p-5"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-red-400" />
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

      {/* ── CHANNEL INTELLIGENCE ── */}
      <section id="channels" className="py-32 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-pink-400">
              OMNICHANNEL EXECUTION
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Eight channels. One unified delivery layer.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              Dynamic channel selection based on 4.7M historical contact outcomes. When SMS fails,
              the system automatically retries via the next highest-propensity channel — not because
              a rule says so, but because the ML model predicts it will work. Every channel has its
              own compliance gate, cost model, and provider failover.
            </p>
          </div>

          <div className="mt-16">
            <ChannelComparisonTable />
          </div>

          {/* Channel selection algorithm */}
          <div className="mt-10 rounded-2xl border border-white/5 bg-white/[0.015] p-8">
            <div className="mb-6 flex items-center gap-2">
              <Network className="h-4 w-4 text-pink-400" />
              <h3 className="text-sm font-semibold">Dynamic Channel Selection Algorithm</h3>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  step: '1',
                  label: 'Compliance Pre-Screen',
                  desc: 'Quiet hours, opt-in status, frequency limits, and channel-specific consent verified per customer. Non-compliant channels suppressed before scoring.',
                  color: '#06b6d4',
                },
                {
                  step: '2',
                  label: 'Propensity Scoring',
                  desc: "ML model scores each eligible channel using customer's historical response rates, time-of-day patterns, message type (transactional vs. marketing), and account status.",
                  color: '#f59e0b',
                },
                {
                  step: '3',
                  label: 'Cost-Effectiveness',
                  desc: 'Highest propensity channel selected. If score delta between top channels is < 0.05, lower-cost channel preferred. Voice call only selected when SMS propensity < 0.25.',
                  color: '#8b5cf6',
                },
                {
                  step: '4',
                  label: 'Provider Failover',
                  desc: 'Primary provider health checked. If Twilio latency > p99 threshold or error rate > 1%, secondary provider activated automatically within the same request.',
                  color: '#ec4899',
                },
              ].map((s) => (
                <div key={s.step} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                  <span className="font-mono text-xs font-bold" style={{ color: s.color }}>
                    Step {s.step}
                  </span>
                  <p className="mt-1 text-xs font-semibold text-content">{s.label}</p>
                  <p className="mt-2 text-2xs leading-relaxed text-content-tertiary">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── DEVELOPER PLATFORM ── */}
      <section id="developers" className="py-32 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-amber-400">
              DEVELOPER PLATFORM
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Built for engineers.
              <br />
              <span className="text-content-tertiary">Loved by operations teams.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              REST API, webhook subscriptions, scoped API keys, Confluent schema registry, and an
              agent marketplace — everything needed to extend, integrate, and build on top of
              ORDR-Connect without breaking compliance.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Code2,
                title: 'REST API',
                desc: 'Fully documented REST API with typed responses, cursor-based pagination, filtering, and sorting across all resource types. 10K req/s sustained throughput.',
                color: '#f59e0b',
                badge: '10K req/s',
              },
              {
                icon: Webhook,
                title: 'Event Webhooks',
                desc: 'Subscribe to any platform event — 100+ event types. HMAC-SHA256 signed payloads, automatic retry with exponential backoff, and dead-letter queue for failed deliveries.',
                color: '#3b82f6',
                badge: '100+ events',
              },
              {
                icon: Terminal,
                title: 'Scoped API Keys',
                desc: 'Granular permission scoping per key — read-only, write, or admin. SHA-256 hashed storage. Zero-downtime rotation. Per-key rate limits and full audit trail.',
                color: '#10b981',
                badge: 'SHA-256 stored',
              },
              {
                icon: BookOpen,
                title: 'Agent Marketplace',
                desc: 'Tenant-scoped agent installs with review system, version management, and isolated execution sandboxes. Agents run in separate process boundaries per tenant.',
                color: '#8b5cf6',
                badge: 'Sandboxed',
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-2xl border border-white/5 bg-white/[0.015] p-6 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.03]"
                >
                  <div className="flex items-center justify-between">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl"
                      style={{
                        background: `${item.color}12`,
                        border: `1px solid ${item.color}22`,
                      }}
                    >
                      <Icon className="h-5 w-5" style={{ color: item.color }} />
                    </div>
                    <span
                      className="font-mono text-2xs font-bold"
                      style={{ color: `${item.color}70` }}
                    >
                      {item.badge}
                    </span>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{item.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-content-secondary">{item.desc}</p>
                </div>
              );
            })}
          </div>

          {/* DSR + SCIM panel */}
          <div className="mt-8 rounded-2xl border border-white/5 bg-white/[0.015] p-8">
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold">DSR Lifecycle Management</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-content-secondary">
                  End-to-end GDPR Data Subject Request management. Access (Art. 15), erasure (Art.
                  17), and portability (Art. 20) requests with 30-day SLA tracking, Kafka-published
                  approval events, worker-executed export assembly, and cryptographic erasure —
                  destroy the DEK, render the data permanently unreadable.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    'Access (Art. 15)',
                    'Erasure (Art. 17)',
                    'Portability (Art. 20)',
                    '30-day SLA',
                    'Crypto Erasure',
                  ].map((tag) => (
                    <span
                      key={tag}
                      className="rounded-lg border border-cyan-500/15 bg-cyan-500/5 px-2.5 py-1 text-2xs text-cyan-400/70"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-violet-400" />
                  <h3 className="text-sm font-semibold">SCIM 2.0 Provisioning</h3>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-content-secondary">
                  RFC 7644 compliant SCIM 2.0 server for enterprise directory integration. Full user
                  and group CRUD, PatchOps support for partial updates, tenant-scoped isolation, and
                  WorkOS webhook processing for real-time deprovisioning with cascading access
                  revocation.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {['RFC 7644', 'User CRUD', 'Group CRUD', 'PatchOps', 'WorkOS Webhooks'].map(
                    (tag) => (
                      <span
                        key={tag}
                        className="rounded-lg border border-violet-500/15 bg-violet-500/5 px-2.5 py-1 text-2xs text-violet-400/70"
                      >
                        {tag}
                      </span>
                    ),
                  )}
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
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              Every target is a p99 commitment, not a median. The platform is designed for 10× peak
              — sustained throughput is the floor, not the ceiling.
            </p>
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

      {/* ── INDUSTRY CASE STUDIES ── */}
      <section id="case-studies" className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[700px] w-[700px] rounded-full bg-violet-500/3 blur-[160px]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-brand-accent">
              INDUSTRY CASE STUDIES
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Real workflows. Real compliance.
              <br />
              <span className="text-content-tertiary">Real outcomes.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              Six regulated industries. Six autonomous workflows. Each case study shows exactly how
              ORDR-Connect maps to your compliance requirements, operational context, and measurable
              business outcomes.
            </p>
          </div>

          <div className="mt-16 space-y-8">
            {caseStudies.map((cs) => {
              const Icon = cs.icon;
              return (
                <div
                  key={cs.id}
                  className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.015]"
                >
                  {/* Case study header */}
                  <div
                    className="border-b border-white/5 px-8 py-6"
                    style={{ background: `${cs.color}07` }}
                  >
                    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-4">
                        <div
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border"
                          style={{
                            borderColor: `${cs.color}30`,
                            background: `${cs.color}12`,
                          }}
                        >
                          <Icon className="h-6 w-6" style={{ color: cs.color }} />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-content">{cs.industry}</h3>
                          <p className="font-mono text-xs" style={{ color: `${cs.color}90` }}>
                            {cs.headline}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {cs.regulations.map((r) => (
                          <span
                            key={r}
                            className="rounded-full border px-2.5 py-0.5 font-mono text-2xs font-semibold"
                            style={{ borderColor: `${cs.color}25`, color: cs.color }}
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="p-8">
                    {/* Context */}
                    <p className="text-sm leading-relaxed text-content-secondary">{cs.context}</p>

                    <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-3">
                      {/* Workflow */}
                      <div className="lg:col-span-2">
                        <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                          HOW ORDR-CONNECT HANDLES IT — STEP BY STEP
                        </h4>
                        <div className="space-y-4">
                          {cs.workflow.map((step) => (
                            <div key={step.n} className="flex gap-4">
                              <div
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold"
                                style={{
                                  background: `${cs.color}14`,
                                  color: cs.color,
                                  border: `1px solid ${cs.color}25`,
                                }}
                              >
                                {step.n}
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-content">{step.label}</p>
                                <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                                  {step.desc}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Outcomes */}
                      <div>
                        <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                          KEY OUTCOMES
                        </h4>
                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
                          {cs.outcomes.map((o) => (
                            <div
                              key={o.label}
                              className="rounded-xl border border-white/5 bg-white/[0.02] p-4"
                            >
                              <p
                                className="font-mono text-2xl font-bold leading-none"
                                style={{ color: cs.color }}
                              >
                                {o.metric}
                              </p>
                              <p className="mt-1 text-xs font-semibold text-content">{o.label}</p>
                              <p className="mt-0.5 text-2xs text-content-tertiary">{o.sub}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Example scenario */}
                    <div
                      className="mt-8 rounded-xl border px-5 py-4"
                      style={{
                        borderColor: `${cs.color}15`,
                        background: `${cs.color}04`,
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <Award className="mt-0.5 h-4 w-4 shrink-0" style={{ color: cs.color }} />
                        <div>
                          <span
                            className="font-mono text-2xs font-bold uppercase tracking-wider"
                            style={{ color: `${cs.color}80` }}
                          >
                            Example Deployment
                          </span>
                          <p className="mt-1 text-xs leading-relaxed text-content-secondary">
                            {cs.example}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── STACK REPLACEMENT / TCO ── */}
      <section className="py-32 px-6">
        <div className="mx-auto max-w-4xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-amber-400">
              TCO ANALYSIS
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              One platform. Eight fewer vendors.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              The hidden cost of a traditional customer operations stack isn&apos;t just licenses —
              it&apos;s the integration tax: 6–18 months of engineering time to connect these tools,
              constant maintenance as APIs change, and data silos that prevent the kind of unified
              customer context that AI agents require.
            </p>
          </div>

          <div className="mt-12 rounded-2xl border border-white/5 bg-white/[0.015] p-8">
            <div className="mb-6 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold">Annual License Cost Comparison</h3>
              <span className="font-mono text-2xs text-content-tertiary">mid-market scale</span>
            </div>
            <ROIBarChart />
          </div>

          {/* What consolidation unlocks */}
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              {
                icon: Database,
                title: 'Unified Data Layer',
                desc: 'One customer record, one event log, one graph. No ETL pipelines, no data lake inconsistencies, no "which system is the system of record" arguments.',
                color: '#3b82f6',
              },
              {
                icon: Zap,
                title: 'No Integration Tax',
                desc: 'Engineers spend 30-50% of time on integrations in multi-vendor stacks. Consolidation redirects that capacity to product — the actual source of competitive advantage.',
                color: '#f59e0b',
              },
              {
                icon: ShieldCheck,
                title: 'Unified Compliance',
                desc: 'Compliance in a multi-vendor stack is as weak as the weakest vendor. One platform with one compliance posture means one audit, one BAA, one pen test.',
                color: '#10b981',
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-xl border border-white/5 bg-white/[0.015] p-5"
                >
                  <Icon className="h-5 w-5 mb-3" style={{ color: item.color }} />
                  <h4 className="text-sm font-semibold text-content">{item.title}</h4>
                  <p className="mt-2 text-xs leading-relaxed text-content-secondary">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── COMPETITIVE DIFFERENTIATION ── */}
      <section id="compare" className="py-32 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <p className="font-mono text-xs font-semibold uppercase tracking-widest text-brand-accent">
              WHY ORDR-CONNECT
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              No other platform does all of this.
              <br />
              <span className="text-content-tertiary">Natively. In one product.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base text-content-secondary">
              Point solutions solve one problem. ORDR-Connect solves the entire customer operations
              stack — with compliance, AI, encryption, and audit chain built in from the start, not
              bolted on as add-ons.
            </p>
          </div>

          <div className="mt-16">
            <CompetitorMatrix />
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              {
                icon: Layers,
                title: 'Compliance is architecture, not a feature flag',
                desc: 'In Salesforce, compliance is a third-party app. In Five9, there is no compliance layer. In ORDR-Connect, FDCPA, TCPA, HIPAA, and GDPR gates run on every single event — before any action executes — without configuration.',
                color: '#22c55e',
              },
              {
                icon: Brain,
                title: "AI that's bounded, not unbounded",
                desc: 'Agentforce gives you a general-purpose agent. ORDR-Connect gives you 8 specialized agents with confidence thresholds, kill switches, budget enforcement, and hallucination containment. The difference is whether your AI can cause compliance violations.',
                color: '#8b5cf6',
              },
              {
                icon: Database,
                title: 'Event sourcing as a first principle',
                desc: 'No other platform on this list uses Kafka as the primary source of truth. Every other platform is a database with an API. ORDR-Connect is an event stream that projects to databases — giving you infinite replay, zero data loss, and a complete causal history.',
                color: '#3b82f6',
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="rounded-xl border border-white/5 bg-white/[0.015] p-5"
                >
                  <Icon className="mb-3 h-5 w-5" style={{ color: item.color }} />
                  <h4 className="text-sm font-semibold text-content">{item.title}</h4>
                  <p className="mt-2 text-xs leading-relaxed text-content-secondary">{item.desc}</p>
                </div>
              );
            })}
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
            requirements, integration landscape, and operational scale. Bring your compliance team —
            we have the documentation.
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

          {/* Trust metrics */}
          <div className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { metric: '9', label: 'Compliance frameworks', sub: 'SOC2 → FEC' },
              { metric: '6', label: 'Industry verticals', sub: 'Deep case studies' },
              { metric: '8', label: 'Delivery channels', sub: 'Unified execution' },
              { metric: '7yr', label: 'WORM retention', sub: 'SHA-256 Merkle DAG' },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-xl border border-white/5 bg-white/[0.015] p-4 text-center"
              >
                <p className="font-mono text-2xl font-bold text-content">{m.metric}</p>
                <p className="mt-1 text-xs font-medium text-content-secondary">{m.label}</p>
                <p className="mt-0.5 font-mono text-2xs text-content-tertiary">{m.sub}</p>
              </div>
            ))}
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
                Enterprise-grade autonomous operations
                <br />
                for regulated industries.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-content-tertiary">
                COMPLIANCE
              </h4>
              <div className="mt-3 space-y-1.5">
                {[
                  'SOC 2 Type II',
                  'ISO 27001:2022',
                  'HIPAA / HITECH',
                  'GDPR + LGPD',
                  'FDCPA / Reg F',
                  'TCPA / CAN-SPAM',
                  'RESPA / TILA',
                  'FEC',
                  'CCPA / CPRA',
                  'PCI DSS',
                ].map((c) => (
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
                <p>FHIR Conformance Statement</p>
                <p>SCIM 2.0 Reference</p>
                <p>Agent Marketplace</p>
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
