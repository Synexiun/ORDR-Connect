import { type ReactNode, useEffect, useState, useRef, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  Bot,
  Activity,
  Lock,
  LayoutDashboard,
  Clock,
  Building2,
  Users,
  ArrowUpRight,
  ChevronRight,
  CheckCircle2,
  MessageSquare,
  Cpu,
  Target,
  Eye,
  FileText,
  HeartPulse,
  Database,
  Brain,
  BarChart3,
  Key,
  AlertTriangle,
  Sparkles,
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
// Live Demo Preview — 7-module grid linking to /demo/*
// ---------------------------------------------------------------------------

function DemoPreviewCards(): ReactNode {
  const modules = [
    {
      path: '/demo',
      label: 'Operations',
      badge: 'CORE',
      icon: LayoutDashboard,
      desc: 'AI agent queue, real-time signal feed, autonomous action log, compliance alert panel',
      color: '#f59e0b',
    },
    {
      path: '/demo/agents',
      label: 'Agent Runtime',
      badge: 'AI',
      icon: Bot,
      desc: 'Active agent sessions, reasoning chains, confidence scores, 4-scope kill switch controls',
      color: '#8b5cf6',
    },
    {
      path: '/demo/customers',
      label: 'Customer Intel',
      badge: 'DATA',
      icon: Users,
      desc: 'Temporal knowledge graph, full interaction history, NBA decision trace, relationship map',
      color: '#3b82f6',
    },
    {
      path: '/demo/channels',
      label: 'Channel Command',
      badge: 'DELIVERY',
      icon: MessageSquare,
      desc: 'Unified omnichannel inbox, delivery status, consent state, per-channel performance metrics',
      color: '#ec4899',
    },
    {
      path: '/demo/compliance',
      label: 'Compliance',
      badge: 'GOVERNANCE',
      icon: ShieldCheck,
      desc: 'Live violation feed, regulation coverage heatmap, WORM audit chain verifier',
      color: '#10b981',
    },
    {
      path: '/demo/events',
      label: 'Event Stream',
      badge: 'INFRA',
      icon: Activity,
      desc: 'Real-time Kafka event viewer, topic throughput, consumer lag, schema registry browser',
      color: '#06b6d4',
    },
    {
      path: '/demo/analytics',
      label: 'Analytics',
      badge: 'INTELLIGENCE',
      icon: BarChart3,
      desc: 'ClickHouse-powered dashboards, cohort analysis, agent ROI, funnel and retention metrics',
      color: '#f59e0b',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {modules.map((m) => {
        const Icon = m.icon;
        return (
          <a
            key={m.path}
            href={m.path}
            className="group relative overflow-hidden rounded-xl border border-white/5 bg-white/[0.015] p-5 transition-all duration-300 hover:border-white/10 hover:bg-white/[0.03]"
          >
            <div className="flex items-start justify-between gap-2">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: `${m.color}14`, border: `1px solid ${m.color}22` }}
              >
                <Icon className="h-4 w-4" style={{ color: m.color }} />
              </div>
              <span className="font-mono text-2xs font-bold" style={{ color: `${m.color}70` }}>
                {m.badge}
              </span>
            </div>
            <h4 className="mt-3 text-sm font-semibold text-content">{m.label}</h4>
            <p className="mt-1 text-2xs leading-relaxed text-content-secondary">{m.desc}</p>
            <div
              className="mt-3 flex items-center gap-1 font-mono text-2xs"
              style={{ color: m.color }}
            >
              <span>Explore →</span>
            </div>
            <div
              className="absolute -bottom-16 -right-16 h-32 w-32 rounded-full opacity-0 blur-[50px] transition-opacity duration-500 group-hover:opacity-10"
              style={{ background: m.color }}
            />
          </a>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Implementation Timeline — 5 milestones from Day 1 to Month 6
// ---------------------------------------------------------------------------

function ImplementationTimeline(): ReactNode {
  const stages = [
    {
      stage: 'Day 1',
      label: 'Foundation',
      color: '#06b6d4',
      items: [
        'Tenant provisioned, SSO via WorkOS',
        'First API keys scoped and issued',
        'Compliance baseline rules active',
        'WORM audit chain initialized',
      ],
    },
    {
      stage: 'Week 2',
      label: 'First Agents Live',
      color: '#3b82f6',
      items: [
        'First agent deployed, sandboxed at L2',
        'FDCPA / TCPA compliance gates configured',
        'CRM read-only sync initiated',
        'Channel providers authenticated',
      ],
    },
    {
      stage: 'Month 1',
      label: 'Full Deployment',
      color: '#8b5cf6',
      items: [
        'Full 8-agent suite at L3 autonomy',
        'FHIR R4 EHR sync live (healthcare)',
        'Bidirectional CRM write-back enabled',
        'DSR lifecycle (GDPR/CCPA) operational',
      ],
    },
    {
      stage: 'Month 3',
      label: 'Optimization',
      color: '#f59e0b',
      items: [
        'ML model trained on 90 days of outcomes',
        'Custom workflows and triggers deployed',
        'Marketplace agents installed + reviewed',
        'Agents promoted to L4 autonomy',
      ],
    },
    {
      stage: 'Month 6',
      label: 'Compliance Ready',
      color: '#10b981',
      items: [
        'SOC 2 audit evidence collection complete',
        'WORM archive: 6-month verified Merkle chain',
        'Breach notification workflow tested',
        'Pen test conducted, findings closed',
      ],
    },
  ];

  return (
    <div className="relative">
      <div className="absolute left-[14px] top-6 hidden h-[calc(100%-48px)] w-px bg-white/5 sm:left-1/2 sm:block" />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-5">
        {stages.map((s, i) => (
          <div key={s.stage} className="relative flex flex-col items-center text-center">
            <div
              className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-canvas"
              style={{ borderColor: s.color }}
            >
              <span className="font-mono text-2xs font-bold" style={{ color: s.color }}>
                {i + 1}
              </span>
            </div>
            <div
              className="mt-4 w-full rounded-xl border p-4"
              style={{ borderColor: `${s.color}20`, background: `${s.color}05` }}
            >
              <p
                className="font-mono text-2xs font-bold uppercase tracking-widest"
                style={{ color: s.color }}
              >
                {s.stage}
              </p>
              <h4 className="mt-1 text-xs font-semibold text-content">{s.label}</h4>
              <div className="mt-3 space-y-1.5">
                {s.items.map((item) => (
                  <div key={item} className="flex items-start gap-1.5">
                    <CheckCircle2
                      className="mt-0.5 h-3 w-3 shrink-0"
                      style={{ color: `${s.color}70` }}
                    />
                    <span className="text-left text-2xs leading-relaxed text-content-tertiary">
                      {item}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
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
// Live Decision Stream — animated terminal hero component
// ---------------------------------------------------------------------------

interface DecisionEvent {
  type: string;
  detail: string;
  layer: string;
  ms: number;
  ok: boolean;
}

const ALL_EVENTS: DecisionEvent[] = [
  {
    type: 'DECISION',
    detail: 'customer:cust-8821  routing → billing-queue',
    layer: 'RULES',
    ms: 3,
    ok: true,
  },
  {
    type: 'COMPLIANCE',
    detail: 'TCPA-DNC check  channel:sms  consent:verified',
    layer: 'RULES',
    ms: 2,
    ok: true,
  },
  {
    type: 'AGENT',
    detail: 'sentiment-monitor  confidence:0.82  escalated → tier-2',
    layer: 'ML',
    ms: 28,
    ok: true,
  },
  {
    type: 'FRAUD',
    detail: 'velocity-check  47/hr (threshold 20)  → blocked',
    layer: 'RULES',
    ms: 4,
    ok: false,
  },
  {
    type: 'DECISION',
    detail: 'customer:cust-3390  next-best-action → follow_up',
    layer: 'LLM',
    ms: 94,
    ok: true,
  },
  {
    type: 'AUDIT',
    detail: 'WORM event logged  hash:a3f9c1...  chain:intact',
    layer: 'AUDIT',
    ms: 1,
    ok: true,
  },
  {
    type: 'AGENT',
    detail: 'debt-recovery-agent  dispatched → cust-5521  L4',
    layer: 'AGENT',
    ms: 187,
    ok: true,
  },
  {
    type: 'DECISION',
    detail: 'customer:cust-2287  channel-selection → email  EST 9am',
    layer: 'RULES',
    ms: 4,
    ok: true,
  },
  {
    type: 'COMPLIANCE',
    detail: 'HIPAA-PHI access logged  actor:agent-7  audit-chain+1',
    layer: 'AUDIT',
    ms: 1,
    ok: true,
  },
  {
    type: 'DECISION',
    detail: 'customer:cust-9934  sentiment:ambiguous  → human-review',
    layer: 'LLM',
    ms: 102,
    ok: false,
  },
];

const TYPE_COLORS: Record<string, string> = {
  DECISION: '#3b82f6',
  COMPLIANCE: '#10b981',
  AGENT: '#8b5cf6',
  FRAUD: '#ef4444',
  AUDIT: '#06b6d4',
};

function LiveDecisionStream(): ReactNode {
  const [lines, setLines] = useState<(DecisionEvent & { id: number; ts: string })[]>([]);
  const counterRef = useRef(0);
  const eventIdxRef = useRef(0);

  useEffect(() => {
    const initial = ALL_EVENTS.slice(0, 5).map((ev, i) => {
      const h = String(9 + Math.floor(i / 2)).padStart(2, '0');
      const m = String((i * 7) % 60).padStart(2, '0');
      const s = String((i * 13) % 60).padStart(2, '0');
      return { ...ev, id: counterRef.current++, ts: `${h}:${m}:${s}` };
    });
    setLines(initial);
    eventIdxRef.current = 5 % ALL_EVENTS.length;

    const interval = setInterval(() => {
      const now = new Date();
      const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      const ev = ALL_EVENTS[eventIdxRef.current % ALL_EVENTS.length];
      if (ev === undefined) return;
      eventIdxRef.current = (eventIdxRef.current + 1) % ALL_EVENTS.length;
      const newLine = { ...ev, id: counterRef.current++, ts };
      setLines((prev) => [...prev, newLine].slice(-8));
    }, 1200);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <div
      className="rounded-2xl border border-white/[0.08] bg-[#0a0a0f] overflow-hidden"
      style={{ boxShadow: '0 0 80px rgba(16,185,129,0.06)' }}
    >
      <div className="bg-[#0f0f18] border-b border-white/5 px-4 py-2.5 flex items-center gap-2">
        <div className="h-3 w-3 rounded-full bg-red-500/70" />
        <div className="h-3 w-3 rounded-full bg-yellow-500/70" />
        <div className="h-3 w-3 rounded-full bg-green-500/70" />
        <span className="ml-3 font-mono text-xs text-content-tertiary">
          ordr-connect · decision-engine · live
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono text-2xs text-emerald-400/70">streaming</span>
        </div>
      </div>
      <div className="p-4 space-y-1 font-mono text-xs min-h-[220px]">
        {lines.map((line) => {
          const typeColor = TYPE_COLORS[line.type] ?? '#94a3b8';
          return (
            <div
              key={line.id}
              className="flex items-start gap-2 opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]"
            >
              <span className="shrink-0 text-content-tertiary/50 text-2xs pt-px">{line.ts}</span>
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-2xs font-bold uppercase"
                style={{ background: `${typeColor}15`, color: typeColor }}
              >
                {line.type}
              </span>
              <span className="flex-1 text-content-secondary text-2xs leading-relaxed">
                {line.detail}
              </span>
              <span className="shrink-0 text-content-tertiary/40 text-2xs">{line.layer}</span>
              <span className="shrink-0 font-bold text-2xs" style={{ color: `${typeColor}90` }}>
                {line.ms}ms
              </span>
              <span className="shrink-0 text-2xs">
                {line.ok ? (
                  <span className="text-emerald-400">✓</span>
                ) : (
                  <span className="text-red-400">✗</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nav Ticker
// ---------------------------------------------------------------------------

const TICKER_MESSAGES = ['48,291 decisions today', '99.99% uptime', '0 violations'];

function NavTicker(): ReactNode {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((prev) => (prev + 1) % TICKER_MESSAGES.length);
        setVisible(true);
      }, 300);
    }, 3000);
    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="hidden items-center gap-2 lg:flex">
      <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
      <span
        className="font-mono text-xs text-content-tertiary transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {TICKER_MESSAGES[idx]}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const caseStudies = [
  {
    id: 'collections',
    industry: 'Collections & Debt Recovery',
    icon: Building2,
    color: '#f59e0b',
    regulations: ['FDCPA', 'Reg F', 'TCPA', 'FCRA'],
    headline: '40% of accounts resolved without a human agent',
    context:
      'Third-party collections agencies, in-house AR departments, and debt buyers managing millions of delinquent accounts face a narrow FDCPA compliance corridor. A single violation costs $1,000–$3,500 per incident — with class-action exposure.',
    outcomes: [
      { metric: '40%', label: 'Resolved autonomously', sub: 'No human agent contact needed' },
      { metric: '$0.08', label: 'Cost per account', sub: 'vs $2.40 manual / $0.85 call center' },
      { metric: '0', label: 'FDCPA violations', sub: '18 months in production' },
      { metric: '23%', label: 'Contact rate lift', sub: 'Dynamic channel sequencing' },
    ],
  },
  {
    id: 'healthcare',
    industry: 'Healthcare & Clinical Operations',
    icon: HeartPulse,
    color: '#ef4444',
    regulations: ['HIPAA', 'HITECH', 'GDPR', 'CCPA'],
    headline: '31% no-show reduction. $847K in recovered appointments annually.',
    context:
      'Multi-site specialty clinic networks lose $200–800 per missed appointment slot. HIPAA violations from insecure outreach average $35K per incident, and EHR systems have no outreach engine.',
    outcomes: [
      { metric: '31%', label: 'No-show reduction', sub: 'Industry avg: 5–8%' },
      { metric: '$847K', label: 'Recovered annually', sub: 'Per 100-location network' },
      { metric: '0', label: 'PHI breaches', sub: 'AES-256-GCM + HSM key mgmt' },
      { metric: '8 min', label: 'Time to reschedule', sub: 'vs 3-day manual process' },
    ],
  },
  {
    id: 'saas',
    industry: 'B2B SaaS & Subscription',
    icon: Sparkles,
    color: '#8b5cf6',
    regulations: ['SOC 2 Type II', 'ISO 27001', 'GDPR', 'CCPA'],
    headline: '67% churn reduction in at-risk cohort. $18.2M ARR protected.',
    context:
      "Enterprise SaaS companies with 12–24 month contract cycles lose the renewal war 90 days before the date. CSMs managing 200+ accounts can't proactively monitor health signals.",
    outcomes: [
      { metric: '67%', label: 'Churn reduction', sub: 'At-risk cohort (health < 60)' },
      { metric: '3.5×', label: 'CS capacity increase', sub: '80 → 280 accounts per CSM' },
      { metric: '3.2×', label: 'Faster signal-to-action', sub: '4 hours vs 13 days median' },
      { metric: '$18.2M', label: 'ARR protected', sub: '350-account pilot year 1' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Landing Page
// ---------------------------------------------------------------------------

export function Landing(): ReactNode {
  const navigate = useNavigate();
  const [statsRef, statsVisible] = useInView(0.3);

  const s1 = useCountUp(48291, 2000, statsVisible);
  const s2 = useCountUp(9999, 2000, statsVisible);
  const s3 = useCountUp(9, 1500, statsVisible);
  const s4 = useCountUp(10, 1800, statsVisible);

  return (
    <div className="min-h-screen bg-[#030305] text-content antialiased">
      {/* ── NAV ── */}
      <nav className="sticky top-0 z-50 w-full border-b border-white/5 backdrop-blur-md bg-[#030305]/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-xs font-bold text-[#030305]">
              O
            </div>
            <span className="font-mono text-sm font-bold tracking-tight">
              ORDR<span className="text-content-tertiary">.</span>Connect
            </span>
          </div>
          <NavTicker />
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                void navigate('/login');
              }}
              className="rounded-lg border border-white/10 px-4 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:border-white/20 hover:text-content"
            >
              Sign in
            </button>
            <button
              onClick={() => {
                void navigate('/login');
              }}
              className="rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-[#030305] transition-all hover:bg-white/90"
            >
              Get access →
            </button>
          </div>
        </div>
      </nav>

      {/* ── SECTION 01 — HERO ── */}
      <section className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.015) 1px, transparent 0)',
              backgroundSize: '40px 40px',
            }}
          />
          <div className="absolute left-1/2 top-1/3 -translate-x-1/2 h-[600px] w-[600px] rounded-full bg-emerald-500/5 blur-[160px]" />
        </div>

        <div className="relative mx-auto max-w-6xl">
          <div className="mb-4 font-mono text-xs text-content-tertiary">01 / 08</div>
          <div className="mb-5">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-400">
              INTRODUCING A NEW SOFTWARE CATEGORY
            </span>
          </div>

          <h1 className="text-5xl sm:text-7xl font-bold leading-[0.95] tracking-tight max-w-4xl">
            Customer operations
            <br />
            finally has an
            <br />
            <span className="text-content-tertiary">operating system.</span>
          </h1>

          <p className="mt-8 max-w-2xl text-base leading-relaxed text-content-secondary">
            ORDR-Connect replaces 8 disconnected tools with one event-sourced, multi-agent,
            compliance-native platform — built for enterprises where a single wrong message costs
            $50,000.
          </p>

          <div className="mt-12">
            <LiveDecisionStream />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono text-xs text-content-secondary">48K decisions/day</span>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2">
              <span className="font-mono text-xs text-content-secondary">&lt;10ms rules</span>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2">
              <span className="font-mono text-xs text-content-secondary">
                9 compliance frameworks
              </span>
            </div>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => {
                void navigate('/login');
              }}
              className="flex items-center justify-center gap-2 rounded-xl bg-white px-8 py-3.5 text-sm font-semibold text-[#030305] transition-all hover:bg-white/90"
            >
              Enter the platform →
            </button>
            <button
              onClick={() => {
                document.getElementById('section-03')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-8 py-3.5 text-sm font-medium text-content-secondary transition-all hover:border-white/20 hover:text-content"
            >
              Read the architecture
            </button>
          </div>
        </div>
      </section>

      {/* ── SECTION 02 — THE BROKEN STACK ── */}
      <section className="py-32 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 font-mono text-xs text-content-tertiary">02 / 08</div>
          <div className="mb-5">
            <span className="font-mono text-xs uppercase tracking-widest text-red-400">
              THE STATUS QUO
            </span>
          </div>

          <h2 className="text-4xl sm:text-5xl font-bold leading-[1.05] tracking-tight max-w-3xl mb-8">
            {`You're not running customer ops.`}
            <br />
            {`You're managing 8 vendors' problems.`}
          </h2>

          <p className="max-w-2xl text-base text-content-secondary mb-12">
            The average enterprise pays $455K–$1.45M annually for a stack of disconnected tools that
            were never designed to work together. 6–18 months of engineering to connect them.
            Constant maintenance. Data silos that prevent unified context. And compliance built
            nowhere.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              { cat: 'CRM', tool: 'Salesforce / HubSpot', price: '$80–200K/yr' },
              { cat: 'Contact Center', tool: 'Five9 / Talkdesk', price: '$120–400K/yr' },
              { cat: 'Compliance', tool: 'Vanta / Drata', price: '$40–100K/yr' },
              { cat: 'AI Platform', tool: 'Agentforce / custom', price: '$40–300K/yr' },
              { cat: 'Scheduler', tool: 'Calendly / custom', price: '$20–60K/yr' },
              { cat: 'Analytics', tool: 'Mixpanel / Heap', price: '$30–80K/yr' },
              { cat: 'Messaging', tool: 'Twilio / SendGrid', price: '$35–100K/yr' },
              { cat: 'Encryption', tool: 'Custom / HashiCorp', price: '$40–80K/yr' },
            ].map((item) => (
              <div
                key={item.cat}
                className="rounded-xl border border-red-500/10 bg-red-500/[0.02] p-4"
              >
                <p className="text-xs font-semibold text-content-secondary line-through decoration-red-500/40">
                  {item.cat}
                </p>
                <p className="mt-1 text-2xs text-content-tertiary">{item.tool}</p>
                <p className="mt-1.5 font-mono text-2xs text-red-400/70">{item.price}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4 mb-12">
            <div className="flex-1 h-px bg-white/5" />
            <span className="font-mono text-xs text-content-tertiary">replaced by</span>
            <div className="flex-1 h-px bg-white/5" />
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 mb-12 flex items-center justify-between gap-6">
            <div>
              <p className="font-mono text-lg font-bold text-emerald-400">ORDR-Connect</p>
              <p className="text-sm text-content-secondary mt-1">
                All 8 capabilities. One event-sourced platform. Compliance native, not bolted on.
              </p>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white text-sm font-bold text-[#030305]">
              O
            </div>
          </div>

          <ROIBarChart />
        </div>
      </section>

      {/* ── SECTION 03 — THE PLATFORM ── */}
      <section id="section-03" className="py-32 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 font-mono text-xs text-content-tertiary">03 / 08</div>
          <div className="mb-5">
            <span className="font-mono text-xs uppercase tracking-widest text-blue-400">
              THE ARCHITECTURE
            </span>
          </div>

          <h2 className="text-4xl sm:text-5xl font-bold leading-[1.05] tracking-tight max-w-3xl mb-8">
            Event-sourced. Multi-agent.
            <br />
            <span className="text-content-tertiary">Millisecond decisions.</span>
          </h2>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 mb-16">
            <div>
              <p className="text-base text-content-secondary leading-relaxed mb-6">
                Six architectural primitives with well-defined interfaces. Every customer operation
                flows through all six in sequence — ingested, evaluated, decided, executed, and
                cryptographically audited. Kafka is the single source of truth. Everything else is a
                projection.
              </p>
              <div className="space-y-3">
                {[
                  { label: 'Customer Graph', sub: 'Neo4j + pgvector', color: '#3b82f6' },
                  { label: 'Event Stream', sub: 'Kafka — Confluent', color: '#10b981' },
                  { label: 'Decision Engine', sub: 'OPA · ClickHouse · Redis', color: '#f59e0b' },
                  { label: 'Agent Runtime', sub: 'LangGraph + Claude API', color: '#8b5cf6' },
                  {
                    label: 'Execution Layer',
                    sub: 'Twilio · SendGrid · Omnichannel',
                    color: '#ec4899',
                  },
                  { label: 'Governance Layer', sub: 'Merkle DAG + WORM', color: '#06b6d4' },
                ].map((p) => (
                  <div key={p.label} className="flex items-center gap-3">
                    <div
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: p.color }}
                    />
                    <span className="text-sm font-semibold text-content">{p.label}</span>
                    <span className="font-mono text-2xs text-content-tertiary">{p.sub}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-6">
              <ArchitectureDiagram />
            </div>
          </div>

          <div className="mb-8 rounded-2xl border border-white/5 bg-white/[0.015] p-8">
            <div className="mb-4 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-content-tertiary" />
              <h3 className="text-sm font-semibold">End-to-End Latency Waterfall</h3>
              <span className="font-mono text-2xs text-content-tertiary">p99 targets</span>
            </div>
            <LatencyWaterfall />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.015] p-8">
            <EventFlowDiagram />
          </div>
        </div>
      </section>

      {/* ── SECTION 04 — THE DECISION ENGINE ── */}
      <section className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute left-1/3 top-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-amber-500/4 blur-[140px]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-4 font-mono text-xs text-content-tertiary">04 / 08</div>
          <div className="mb-5">
            <span className="font-mono text-xs uppercase tracking-widest text-amber-400">
              INTELLIGENCE LAYER
            </span>
          </div>

          <div className="mb-12 max-w-2xl">
            <p className="text-4xl sm:text-5xl font-bold leading-[1.1] tracking-tight">
              Rules decide in &lt;10ms.
            </p>
            <p className="text-3xl sm:text-4xl font-bold leading-[1.1] tracking-tight text-content-secondary mt-2">
              ML decides in &lt;50ms.
            </p>
            <p className="text-2xl sm:text-3xl font-bold leading-[1.1] tracking-tight text-content-tertiary mt-2">
              Claude decides in &lt;100ms.
            </p>
            <p className="text-xl sm:text-2xl font-bold leading-[1.1] tracking-tight text-content-tertiary/50 mt-2">
              Humans decide never.
            </p>
          </div>

          <div className="mb-12">
            <DecisionEngineDiagram />
          </div>

          <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-8">
            <div className="mb-6 flex items-center gap-2">
              <Bot className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold">Graduated Autonomy Model</h3>
            </div>
            <AutonomyLevelsDiagram />
          </div>
        </div>
      </section>

      {/* ── SECTION 05 — COMPLIANCE FOUNDATION ── */}
      <section className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute left-1/4 top-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-emerald-500/4 blur-[120px]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-4 font-mono text-xs text-content-tertiary">05 / 08</div>
          <div className="mb-5">
            <span className="font-mono text-xs uppercase tracking-widest text-emerald-400">
              COMPLIANCE ARCHITECTURE
            </span>
          </div>

          <h2 className="text-4xl sm:text-5xl font-bold leading-[1.05] tracking-tight max-w-3xl mb-8">
            {`Compliance isn't a feature.`}
            <br />
            <span className="text-content-tertiary">{`It's the execution layer.`}</span>
          </h2>

          <p className="max-w-2xl text-base text-content-secondary mb-4">
            Nine regulatory frameworks enforced at runtime — before any action executes. Every event
            passes through the compliance engine. A BLOCK exits the pipeline immediately; no ML
            model, no agent, no channel fires.
          </p>
          <p className="max-w-2xl text-sm text-content-tertiary mb-12">
            The cryptographic audit chain provides tamper-proof evidence — not a log file, but a
            Merkle DAG with SHA-256 chain verification on every read. WORM-stored for 7 years.
          </p>

          <div className="mb-10">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold">Regulation Coverage by Industry</h3>
            </div>
            <ComplianceMatrixTable />
          </div>

          <div className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-8">
              <div className="mb-4 flex items-center gap-2">
                <Lock className="h-4 w-4 text-emerald-400" />
                <h3 className="text-sm font-semibold">Merkle DAG Audit Chain</h3>
              </div>
              <AuditChainDiagram />
            </div>
            <div className="space-y-3">
              {[
                {
                  icon: Key,
                  title: 'AES-256-GCM + HSM Key Management',
                  desc: 'Field-level encryption on all restricted data before any database write. HSM-backed key management via HashiCorp Vault with 90-day automated rotation and zero-downtime swap.',
                },
                {
                  icon: Eye,
                  title: 'Zero Trust Architecture',
                  desc: 'mTLS on every internal service connection. JWT claims derive tenant scope server-side. Row-Level Security enforced at PostgreSQL layer. Default deny on all endpoints.',
                },
                {
                  icon: FileText,
                  title: 'WORM Audit Storage',
                  desc: 'Append-only audit tables with PostgreSQL triggers blocking UPDATE/DELETE. SHA-256 hash chain with Merkle tree batch verification every 1,000 events. S3 Object Lock replication.',
                },
                {
                  icon: Target,
                  title: '10-Gate PR Enforcement',
                  desc: 'Every pull request passes static analysis, dependency scan, secret scan, TypeScript strict mode, 80%+ coverage, audit log check, access control check, PHI check, encryption check, and peer review.',
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

          <div className="mb-10">
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <h3 className="text-sm font-semibold">Regulatory Penalty Exposure</h3>
              <span className="font-mono text-2xs text-content-tertiary">
                what non-compliance actually costs
              </span>
            </div>
            <CompliancePenaltyTable />
          </div>

          <div>
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

      {/* ── SECTION 06 — AGENTS & INTEGRATIONS ── */}
      <section className="py-32 px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 font-mono text-xs text-content-tertiary">06 / 08</div>
          <div className="mb-5">
            <span className="font-mono text-xs uppercase tracking-widest text-violet-400">
              AI AGENTS
            </span>
          </div>

          <h2 className="text-4xl sm:text-5xl font-bold leading-[1.05] tracking-tight max-w-3xl mb-8">
            Six specialized agents.
            <br />
            <span className="text-content-tertiary">Bounded, audited, killable.</span>
          </h2>

          <p className="max-w-2xl text-base text-content-secondary mb-12">
            Every agent operates within explicit boundaries — permission allowlists, budget
            enforcement, confidence thresholds, and kill switches at four scopes. Graduation from L1
            to L5 is a deliberate organizational decision, not an automatic upgrade.
          </p>

          <div className="mb-10">
            <div className="mb-4 flex items-center gap-2">
              <Brain className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold">Agent Type Reference</h3>
              <span className="font-mono text-2xs text-content-tertiary">by industry vertical</span>
            </div>
            <AgentTypesTable />
          </div>

          <div className="mb-10 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-8">
              <div className="mb-4 flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-semibold">Integration Topology</h3>
                <span className="font-mono text-2xs text-content-tertiary">8 providers</span>
              </div>
              <IntegrationHubDiagram />
            </div>

            <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-8">
              <div className="mb-6 flex items-center gap-2">
                <HeartPulse className="h-4 w-4 text-red-400" />
                <h3 className="text-sm font-semibold">FHIR R4 Resource Mapping</h3>
                <span className="font-mono text-2xs text-content-tertiary">HL7 4.0.1</span>
              </div>
              <FHIRFlowDiagram />
            </div>
          </div>

          <div className="rounded-2xl border border-white/5 bg-white/[0.015] p-8">
            <div className="mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold">Channel Comparison</h3>
            </div>
            <ChannelComparisonTable />
          </div>

          <div className="mt-8 rounded-2xl border border-white/5 bg-white/[0.015] p-8">
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

      {/* ── SECTION 07 — PROOF ── */}
      <section ref={statsRef} className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[700px] w-[700px] rounded-full bg-violet-500/3 blur-[160px]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-4 font-mono text-xs text-content-tertiary">07 / 08</div>
          <div className="mb-5">
            <span className="font-mono text-xs uppercase tracking-widest text-brand-accent">
              SOCIAL PROOF
            </span>
          </div>

          <h2 className="text-4xl sm:text-5xl font-bold leading-[1.05] tracking-tight mb-12">
            The numbers speak.
          </h2>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-16">
            {[
              { val: s1.toLocaleString(), label: 'Decisions made today', sub: 'Live, autonomous' },
              {
                val: `${(s2 / 100).toFixed(2)}%`,
                label: 'Platform uptime SLA',
                sub: 'Multi-region failover',
              },
              { val: String(s3), label: 'Compliance frameworks', sub: 'Native, not add-ons' },
              { val: `<${String(s4)}ms`, label: 'Rules engine p99', sub: 'Deterministic block' },
            ].map((m) => (
              <div
                key={m.label}
                className="flex flex-col items-center rounded-2xl border border-white/5 bg-white/[0.015] p-8 text-center"
              >
                <span className="font-mono text-4xl font-bold tracking-tight text-content">
                  {m.val}
                </span>
                <span className="mt-2 text-sm font-medium text-content-secondary">{m.label}</span>
                <span className="mt-1 font-mono text-2xs text-content-tertiary">{m.sub}</span>
              </div>
            ))}
          </div>

          <div className="mb-16 space-y-6">
            {caseStudies.map((cs) => {
              const Icon = cs.icon;
              return (
                <div
                  key={cs.id}
                  className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.015]"
                >
                  <div
                    className="border-b border-white/5 px-8 py-5"
                    style={{ background: `${cs.color}07` }}
                  >
                    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-4">
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                          style={{ borderColor: `${cs.color}30`, background: `${cs.color}12` }}
                        >
                          <Icon className="h-5 w-5" style={{ color: cs.color }} />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-content">{cs.industry}</h3>
                          <p
                            className="font-mono text-xs mt-0.5"
                            style={{ color: `${cs.color}90` }}
                          >
                            {cs.headline}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {cs.regulations.map((r) => (
                          <span
                            key={r}
                            className="rounded-full border px-2 py-0.5 font-mono text-2xs font-semibold"
                            style={{ borderColor: `${cs.color}25`, color: cs.color }}
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="p-8">
                    <p className="text-sm leading-relaxed text-content-secondary mb-6">
                      {cs.context}
                    </p>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
              );
            })}
          </div>

          <div>
            <div className="mb-6 text-center">
              <h3 className="text-xl font-bold">No other platform does all of this.</h3>
              <p className="mt-2 text-sm text-content-tertiary">Natively. In one product.</p>
            </div>
            <CompetitorMatrix />
          </div>
        </div>
      </section>

      {/* ── SECTION 08 — CTA ── */}
      <section className="relative py-32 px-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-brand-accent/5 blur-[160px]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-4 font-mono text-xs text-content-tertiary">08 / 08</div>

          <div className="max-w-4xl mb-16">
            <h2 className="text-5xl sm:text-7xl font-bold leading-[0.95] tracking-tight">
              The category exists.
              <br />
              The question is whether
              <br />
              <span className="text-content-tertiary">{`you're first in your market.`}</span>
            </h2>
            <p className="mt-8 text-base text-content-secondary max-w-xl">
              Talk to our engineering team. Bring your compliance officer.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => {
                  void navigate('/login');
                }}
                className="flex items-center justify-center gap-2 rounded-xl bg-white px-8 py-3.5 text-sm font-semibold text-[#030305] transition-all hover:bg-white/90"
              >
                Request access →
              </button>
              <button
                onClick={() => {
                  void navigate('/login');
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-8 py-3.5 text-sm font-medium text-content-secondary transition-all hover:border-white/20 hover:text-content"
              >
                <ArrowUpRight className="h-4 w-4" />
                Explore the live demo
              </button>
            </div>
          </div>

          <div className="mb-16">
            <div className="mb-6 flex items-center gap-2">
              <Clock className="h-4 w-4 text-brand-accent" />
              <h3 className="text-sm font-semibold">
                From contract to full autonomy in six months.
              </h3>
            </div>
            <ImplementationTimeline />
          </div>

          <div className="mb-16">
            <div className="mb-6 text-center">
              <h3 className="text-xl font-bold">Explore the platform — no signup required.</h3>
              <p className="mt-2 text-sm text-content-tertiary">
                Seven fully interactive modules with real-time simulated data.
              </p>
            </div>
            <DemoPreviewCards />
          </div>

          <TechSpecsTable />
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 py-16 px-6">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 gap-12 sm:grid-cols-3">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-2xs font-bold text-[#030305]">
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
