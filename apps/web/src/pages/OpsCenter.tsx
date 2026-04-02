/**
 * OpsCenter — ORDR Ops Command Center
 *
 * Full application shell and primary operational interface for ORDR Ops.
 * Implements the ORDR Ops Design System v1.0:
 *   – Dark luxury aesthetic: #060608 / amber #fbbf24 / glass surfaces
 *   – Framer Motion throughout: springs, layout animations, AnimatePresence
 *   – SSE-simulation (mock data matches live API event shapes)
 *   – HITL queue, live topology, event stream, dashboard, customer 360, compliance
 *
 * Route: /ops (full-screen, bypasses Layout shell — see App.tsx)
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Bell,
  Check,
  ChevronRight,
  Command,
  Cpu,
  Globe,
  Layers,
  Layout,
  Lock,
  MessageSquare,
  Search,
  Shield,
  ShieldAlert,
  User,
  X,
  Zap,
  Database,
  AlertTriangle,
  Play,
  Fingerprint,
  Users,
  DollarSign,
  TrendingUp,
  Mail,
  Phone,
  FileText,
  GitMerge,
  Radio,
  Settings,
  TerminalSquare,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type RouteId = 'ops' | 'dashboard' | 'customers' | 'compliance';
type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'brand' | 'purple';
type ActorType = 'AI' | 'Human';

interface HitlTask {
  id: string;
  priority: number;
  agent: string;
  client: string;
  action: string;
  confidence: number;
  time: string;
}

interface ActivityEntry {
  id: string;
  actor: ActorType;
  name: string;
  action: string;
  target: string;
  time: string;
  hash: string;
}

interface NavItemDef {
  id: RouteId;
  icon: ReactNode;
  label: string;
  badge?: string;
}

interface NavSection {
  label: string;
  items: NavItemDef[];
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const INITIAL_HITL: HitlTask[] = [
  {
    id: 'h1',
    priority: 95,
    agent: 'Comms Agent',
    client: 'Acme Corp',
    action: 'SLA breach apology draft — confidence below 0.70 threshold',
    confidence: 0.62,
    time: '2m ago',
  },
  {
    id: 'h2',
    priority: 88,
    agent: 'Router Agent',
    client: 'Globex',
    action: 'Route high-value inbound lead to Tier 1 Support',
    confidence: 0.68,
    time: '5m ago',
  },
  {
    id: 'h3',
    priority: 75,
    agent: 'Analyst Agent',
    client: 'Initech',
    action: 'Elevated churn risk signal — recommend executive outreach',
    confidence: 0.65,
    time: '12m ago',
  },
];

const INITIAL_ACTIVITY: ActivityEntry[] = [
  {
    id: 'a1',
    actor: 'AI',
    name: 'Scout Agent',
    action: 'identified off-pipeline opportunity',
    target: 'Stark Ind.',
    time: 'Just now',
    hash: '0x8f…3a9b',
  },
  {
    id: 'a2',
    actor: 'Human',
    name: 'Sarah Chen',
    action: 'approved Comms Agent draft',
    target: 'Wayne Ent.',
    time: '1m ago',
    hash: '0x2c…11f0',
  },
  {
    id: 'a3',
    actor: 'AI',
    name: 'Router Agent',
    action: 'classified inbound email → Support',
    target: 'Ticket #8821',
    time: '3m ago',
    hash: '0x9a…88b2',
  },
  {
    id: 'a4',
    actor: 'AI',
    name: 'Compliance Agent',
    action: 'screened outbound message — Pass',
    target: 'Acme Corp',
    time: '4m ago',
    hash: '0x11…ff3e',
  },
  {
    id: 'a5',
    actor: 'AI',
    name: 'Analyst Agent',
    action: 'calculated customer health score',
    target: 'Globex (88)',
    time: '10m ago',
    hash: '0x44…a1b2',
  },
  {
    id: 'a6',
    actor: 'Human',
    name: 'Admin',
    action: 'revoked API key — rotation policy',
    target: 'ordr_sk_••3f',
    time: '14m ago',
    hash: '0x33…cc91',
  },
];

// Deterministic heatmap — avoids Math.random() on render
const HEATMAP_VALUES = [
  0.9, 0.4, 0.7, 0.2, 0.8, 0.3, 0.6, 0.1, 0.95, 0.5, 0.3, 0.85, 0.45, 0.7, 0.2, 0.6, 0.35, 0.9,
  0.55, 0.15, 0.75, 0.4, 0.65, 0.3, 0.8, 0.5, 0.25, 0.7,
];

// ─── Animation Variants ───────────────────────────────────────────────────────

const PANEL_ENTER = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.18, ease: 'easeOut' },
};

const CARD_ENTER = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: 8 },
  transition: { type: 'spring', stiffness: 300, damping: 26 },
};

const HITL_ENTER = {
  initial: { opacity: 0, x: 50, scale: 0.92 },
  animate: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.85, transition: { duration: 0.15 } },
  transition: { type: 'spring', stiffness: 400, damping: 28 },
};

const STREAM_ENTER = {
  initial: { opacity: 0, y: -18 },
  animate: { opacity: 1, y: 0 },
  transition: { type: 'spring', stiffness: 350, damping: 30 },
};

// ─── Badge ────────────────────────────────────────────────────────────────────

const BADGE_STYLES: Record<BadgeVariant, string> = {
  default: 'bg-white/[0.04] border-white/10 text-[#94a3b8]',
  success: 'bg-[#10b981]/10 border-[#10b981]/20 text-[#10b981]',
  warning: 'bg-[#f59e0b]/10 border-[#f59e0b]/20 text-[#f59e0b]',
  danger:
    'bg-[#ef4444]/15 border-[#ef4444]/30 text-[#ef4444] shadow-[0_0_10px_rgba(239,68,68,0.15)]',
  brand:
    'bg-[#fbbf24]/15 border-[#fbbf24]/30 text-[#fbbf24] shadow-[0_0_10px_rgba(251,191,36,0.12)]',
  purple:
    'bg-purple-500/15 border-purple-500/30 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.12)]',
};

function Badge({
  children,
  variant = 'default',
  className = '',
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}): ReactNode {
  return (
    <span
      className={`px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-[0.1em] ${BADGE_STYLES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function Card({
  children,
  className = '',
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}): ReactNode {
  return (
    <div
      className={`bg-[#0d0d12]/80 backdrop-blur-md border border-white/[0.06] rounded-xl relative overflow-hidden shadow-lg ${className}`}
    >
      {glow && (
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#fbbf24]/[0.03] rounded-full blur-[40px] -mt-8 -mr-8 pointer-events-none" />
      )}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// ─── Topology Canvas ──────────────────────────────────────────────────────────

/**
 * SVG coordinate space: viewBox="0 0 1000 340" preserveAspectRatio="none"
 * HTML nodes are absolutely positioned; x_html = x_svg / 10, y_html = y_svg / 340 * 100
 */
function TopologyCanvas({ load }: { load: number }): ReactNode {
  const isOverloaded = load > 80;
  const particleSpeed = Math.max(1.5, 4 - (load / 100) * 2.5);

  return (
    <div className="h-[340px] bg-gradient-to-b from-[#0d0d12] to-[#060608] border border-white/[0.08] rounded-2xl relative overflow-hidden shadow-2xl flex-shrink-0">
      {/* Dot grid */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]" />

      {/* SVG connections + particles */}
      <svg
        viewBox="0 0 1000 340"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none z-0"
      >
        <defs>
          <linearGradient id="tg-normal" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(59,130,246,0.15)" />
            <stop offset="50%" stopColor="rgba(251,191,36,0.50)" />
            <stop offset="100%" stopColor="rgba(168,85,247,0.15)" />
          </linearGradient>
          <linearGradient id="tg-warn" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(239,68,68,0.0)" />
            <stop offset="50%" stopColor="rgba(239,68,68,0.6)" />
            <stop offset="100%" stopColor="rgba(239,68,68,0.0)" />
          </linearGradient>
          <filter id="tg-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Path defs for animateMotion */}
          <path id="tp1" d="M 180 70  C 300 70  380 170 490 170" />
          <path id="tp2" d="M 180 170 C 300 170 380 170 490 170" />
          <path id="tp3" d="M 180 270 C 300 270 380 170 490 170" />
          <path id="tp4" d="M 490 170 C 600 170 700 100 820 100" />
          <path id="tp5" d="M 490 170 C 600 170 700 240 820 240" />
        </defs>

        {/* Base tracks */}
        {['tp1', 'tp2', 'tp3', 'tp4', 'tp5'].map((id) => (
          <use
            key={id}
            href={`#${id}`}
            fill="none"
            stroke="rgba(255,255,255,0.03)"
            strokeWidth={6}
          />
        ))}
        {/* Animated flow strokes */}
        {['tp1', 'tp2', 'tp3', 'tp4', 'tp5'].map((id, i) => (
          <use
            key={`${id}-f`}
            href={`#${id}`}
            fill="none"
            stroke={id === 'tp3' && isOverloaded ? 'url(#tg-warn)' : 'url(#tg-normal)'}
            strokeWidth={i === 1 ? 3.5 : 2}
            strokeDasharray="10 28"
            className="ops-flow"
            style={{ animationDuration: `${particleSpeed + i * 0.4}s` }}
          />
        ))}

        {/* Particles */}
        <circle r="5" fill="#3b82f6" filter="url(#tg-glow)" opacity="0.9">
          <animateMotion dur={`${particleSpeed + 0.5}s`} repeatCount="indefinite">
            <mpath href="#tp1" />
          </animateMotion>
        </circle>
        <circle r="6" fill="#fbbf24" filter="url(#tg-glow)" opacity="1">
          <animateMotion dur={`${particleSpeed}s`} repeatCount="indefinite">
            <mpath href="#tp2" />
          </animateMotion>
        </circle>
        <circle
          r="4"
          fill={isOverloaded ? '#ef4444' : '#a855f7'}
          filter="url(#tg-glow)"
          opacity="0.85"
        >
          <animateMotion dur={`${particleSpeed + 1}s`} repeatCount="indefinite">
            <mpath href="#tp3" />
          </animateMotion>
        </circle>
        <circle r="5" fill="#a855f7" filter="url(#tg-glow)" opacity="0.8">
          <animateMotion dur={`${particleSpeed + 0.3}s`} repeatCount="indefinite">
            <mpath href="#tp4" />
          </animateMotion>
        </circle>
        <circle r="4" fill="#ef4444" filter="url(#tg-glow)" opacity="0.7">
          <animateMotion dur={`${particleSpeed + 0.8}s`} repeatCount="indefinite">
            <mpath href="#tp5" />
          </animateMotion>
        </circle>
      </svg>

      {/* ── Source Nodes (left) ───────────────────────────────────────────── */}
      {/* CRM: x=18% y=20.6% */}
      <div
        className="absolute"
        style={{ left: '18%', top: '20.6%', transform: 'translate(-50%,-50%)' }}
      >
        <div className="bg-black/70 backdrop-blur-md border border-white/[0.08] rounded-xl p-3 w-[170px] flex items-center gap-3 hover:border-[#3b82f6]/40 transition-colors">
          <div className="w-8 h-8 rounded-lg border flex items-center justify-center bg-[#3b82f6]/10 border-[#3b82f6]/30 text-[#3b82f6] flex-shrink-0">
            <Database size={14} />
          </div>
          <div>
            <div className="text-[9px] font-mono text-[#94a3b8] uppercase tracking-wider">
              CRM Pipeline
            </div>
            <div className="text-sm font-semibold text-[#f1f5f9]">347 contacts</div>
          </div>
        </div>
      </div>
      {/* Event Bus: x=18% y=50% */}
      <div
        className="absolute"
        style={{ left: '18%', top: '50%', transform: 'translate(-50%,-50%)' }}
      >
        <div className="bg-black/70 backdrop-blur-md border border-[#fbbf24]/20 rounded-xl p-3 w-[170px] flex items-center gap-3 ring-1 ring-[#fbbf24]/15 hover:ring-[#fbbf24]/30 transition-all">
          <div className="w-8 h-8 rounded-lg border flex items-center justify-center bg-[#fbbf24]/10 border-[#fbbf24]/30 text-[#fbbf24] flex-shrink-0">
            <Radio size={14} />
          </div>
          <div>
            <div className="text-[9px] font-mono text-[#94a3b8] uppercase tracking-wider">
              Event Stream
            </div>
            <div className="text-sm font-semibold text-[#f1f5f9]">
              {Math.round(load * 15)} msgs/s
            </div>
          </div>
        </div>
      </div>
      {/* Inbound: x=18% y=79.4% */}
      <div
        className="absolute"
        style={{ left: '18%', top: '79.4%', transform: 'translate(-50%,-50%)' }}
      >
        <div
          className={`bg-black/70 backdrop-blur-md border rounded-xl p-3 w-[170px] flex items-center gap-3 transition-all ${isOverloaded ? 'border-[#ef4444]/40 ring-1 ring-[#ef4444]/20' : 'border-white/[0.08]'}`}
        >
          <div
            className={`w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 ${isOverloaded ? 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444]' : 'bg-[#10b981]/10 border-[#10b981]/30 text-[#10b981]'}`}
          >
            <MessageSquare size={14} />
          </div>
          <div>
            <div className="text-[9px] font-mono text-[#94a3b8] uppercase tracking-wider">
              Inbound Queue
            </div>
            <div className="text-sm font-semibold text-[#f1f5f9]">18 unread</div>
          </div>
        </div>
      </div>

      {/* ── AI Brain (center) ─────────────────────────────────────────────── */}
      <div
        className="absolute"
        style={{ left: '49%', top: '50%', transform: 'translate(-50%,-50%)' }}
      >
        <div className="relative flex items-center justify-center">
          {/* Orbit rings */}
          <div className="absolute w-52 h-52 rounded-full border border-[#fbbf24]/10 border-t-[#fbbf24]/35 border-b-[#fbbf24]/35 animate-[spin_12s_linear_infinite]" />
          <div className="absolute w-44 h-44 rounded-full border border-purple-500/10 border-l-purple-500/35 border-r-purple-500/35 animate-[spin_8s_linear_infinite_reverse]" />
          {/* Ambient glow */}
          <div className="absolute w-32 h-32 rounded-full bg-[#fbbf24]/[0.06] blur-[40px]" />

          <motion.div
            animate={{
              boxShadow: isOverloaded
                ? [
                    '0 0 20px rgba(239,68,68,0.15)',
                    '0 0 40px rgba(239,68,68,0.35)',
                    '0 0 20px rgba(239,68,68,0.15)',
                  ]
                : [
                    '0 0 20px rgba(251,191,36,0.08)',
                    '0 0 35px rgba(251,191,36,0.18)',
                    '0 0 20px rgba(251,191,36,0.08)',
                  ],
            }}
            transition={{ repeat: Infinity, duration: 2.5 }}
            className={`relative z-10 bg-black/85 backdrop-blur-xl border-2 rounded-2xl p-5 w-[230px] transition-colors duration-500 ${isOverloaded ? 'border-[#ef4444]/50' : 'border-[#fbbf24]/35'}`}
          >
            <div className="flex items-center gap-2 mb-4">
              <Cpu
                size={15}
                className={isOverloaded ? 'text-[#ef4444] animate-pulse' : 'text-[#fbbf24]'}
              />
              <span className="text-[10px] font-black tracking-[0.15em] text-[#f1f5f9] uppercase">
                ORDR Ops Core
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <div className="text-[9px] text-[#475569] font-mono uppercase mb-0.5">Compute</div>
                <div
                  className={`font-mono text-xl font-light ${isOverloaded ? 'text-[#ef4444]' : 'text-[#f1f5f9]'}`}
                >
                  {load.toFixed(1)}
                  <span className="text-xs text-[#475569]">%</span>
                </div>
              </div>
              <div>
                <div className="text-[9px] text-[#475569] font-mono uppercase mb-0.5">Agents</div>
                <div className="font-mono text-xl font-light text-[#f1f5f9]">
                  7<span className="text-xs text-[#475569]">/8</span>
                </div>
              </div>
            </div>
            <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
              <motion.div
                animate={{ width: `${load}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className={`h-full rounded-full ${isOverloaded ? 'bg-[#ef4444]' : 'bg-gradient-to-r from-[#fbbf24] to-[#f59e0b]'}`}
              />
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Output Nodes (right) ──────────────────────────────────────────── */}
      {/* Comms: x=82% y=29.4% */}
      <div
        className="absolute"
        style={{ left: '82%', top: '29.4%', transform: 'translate(-50%,-50%)' }}
      >
        <div className="bg-black/70 backdrop-blur-md border border-white/[0.08] rounded-xl p-3 w-[170px] flex items-center gap-3 hover:border-purple-500/40 transition-colors">
          <div className="w-8 h-8 rounded-lg border flex items-center justify-center bg-purple-500/10 border-purple-500/30 text-purple-400 flex-shrink-0">
            <Mail size={14} />
          </div>
          <div>
            <div className="text-[9px] font-mono text-[#94a3b8] uppercase tracking-wider">
              Customer Comms
            </div>
            <div className="text-sm font-semibold text-[#f1f5f9]">142 sent/hr</div>
          </div>
        </div>
      </div>
      {/* Workflows: x=82% y=70.6% */}
      <div
        className="absolute"
        style={{ left: '82%', top: '70.6%', transform: 'translate(-50%,-50%)' }}
      >
        <div className="bg-black/70 backdrop-blur-md border border-white/[0.08] rounded-xl p-3 w-[170px] flex items-center gap-3 hover:border-[#ef4444]/40 transition-colors">
          <div className="w-8 h-8 rounded-lg border flex items-center justify-center bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444] flex-shrink-0">
            <GitMerge size={14} />
          </div>
          <div>
            <div className="text-[9px] font-mono text-[#94a3b8] uppercase tracking-wider">
              Workflow Engine
            </div>
            <div className="text-sm font-semibold text-[#f1f5f9]">38 running</div>
          </div>
        </div>
      </div>

      {/* Status label */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 border border-[#10b981]/20 backdrop-blur-md">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] shadow-[0_0_8px_#10b981] animate-pulse" />
          <span className="text-[9px] font-mono text-[#10b981] tracking-[0.15em] uppercase">
            Live · {load.toFixed(0)}% Load
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Activity Stream ──────────────────────────────────────────────────────────

function ActivityStream({ feed }: { feed: ActivityEntry[] }): ReactNode {
  return (
    <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[100px_150px_1fr_90px] items-center py-2 px-4 border-b border-white/[0.06] bg-black/30">
        {['Actor', 'Hash', 'Event Payload', 'Time'].map((h, i) => (
          <span
            key={h}
            className={`text-[9px] font-mono text-[#475569] uppercase tracking-[0.1em] ${i === 3 ? 'text-right' : ''}`}
          >
            {h}
          </span>
        ))}
      </div>

      {/* Timeline line */}
      <div className="flex-1 overflow-y-auto ops-scrollbar relative">
        <div className="absolute left-[62px] top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/[0.08] to-transparent z-0" />

        <div className="p-2 flex flex-col gap-1 relative z-10">
          <AnimatePresence initial={false}>
            {feed.map((item) => (
              <motion.div
                key={item.id}
                layout
                {...STREAM_ENTER}
                className="grid grid-cols-[100px_150px_1fr_90px] items-center py-2.5 px-2 bg-white/[0.01] hover:bg-white/[0.04] border border-transparent hover:border-white/[0.06] transition-colors rounded-lg group cursor-default"
              >
                {/* Actor badge + chain node */}
                <div className="flex items-center gap-2 relative">
                  <Badge
                    variant={item.actor === 'AI' ? 'purple' : 'brand'}
                    className="w-[52px] text-center"
                  >
                    {item.actor}
                  </Badge>
                  <div
                    className={`absolute left-[48px] w-2 h-2 rounded-full border-[2px] border-[#0d0d12] shadow-[0_0_6px_currentColor] z-20 ${item.actor === 'AI' ? 'bg-purple-400 text-purple-400' : 'bg-[#fbbf24] text-[#fbbf24]'}`}
                  />
                </div>
                {/* Hash */}
                <div className="text-[10px] font-mono text-[#475569] flex items-center gap-1 group-hover:text-[#94a3b8] transition-colors">
                  <Shield size={9} className="opacity-40 flex-shrink-0" />
                  {item.hash}
                </div>
                {/* Payload */}
                <div className="flex items-center gap-2 pr-4 min-w-0">
                  <span className="font-semibold text-sm text-[#f1f5f9] flex-shrink-0">
                    {item.name}
                  </span>
                  <span className="text-sm text-[#94a3b8] truncate">{item.action}</span>
                  <span className="text-[11px] bg-[#fbbf24]/10 border border-[#fbbf24]/20 text-[#fbbf24] px-1.5 py-0.5 rounded flex-shrink-0 whitespace-nowrap">
                    {item.target}
                  </span>
                </div>
                {/* Time */}
                <div className="text-right text-[10px] font-mono text-[#475569]">{item.time}</div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </Card>
  );
}

// ─── HITL Queue ───────────────────────────────────────────────────────────────

function HitlQueue({
  queue,
  onApprove,
  onDismiss,
}: {
  queue: HitlTask[];
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
}): ReactNode {
  return (
    <div className="w-[380px] flex-shrink-0 border-l border-white/[0.06] bg-[#060608]/95 backdrop-blur-xl flex flex-col shadow-[-20px_0_48px_rgba(0,0,0,0.7)]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.06] bg-gradient-to-b from-[#111118]/80 to-transparent flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="font-black text-base tracking-tight text-[#f1f5f9]">Action Queue</h3>
            <AnimatePresence mode="popLayout">
              {queue.length > 0 && (
                <motion.span
                  key={queue.length}
                  initial={{ scale: 1.6, opacity: 0.5 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-[#fbbf24] text-[#060608] text-[11px] font-black px-2 py-0.5 rounded-md shadow-[0_0_14px_rgba(251,191,36,0.35)] tabular-nums"
                >
                  {queue.length}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <p className="text-[9px] font-mono text-[#475569] uppercase tracking-[0.12em] mt-0.5">
            Human-in-the-Loop Required
          </p>
        </div>
        <div className="text-[9px] font-mono text-[#475569] flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.02] border border-white/[0.04]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#f59e0b] animate-pulse" />
          Threshold 0.70
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto ops-scrollbar p-4 flex flex-col gap-3">
        <AnimatePresence>
          {queue.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center h-full text-[#475569] gap-3 py-16"
            >
              <div className="w-14 h-14 rounded-full border border-white/[0.04] flex items-center justify-center bg-white/[0.02]">
                <Check size={28} className="opacity-20" />
              </div>
              <p className="text-sm font-medium">All queues are clear</p>
            </motion.div>
          ) : (
            queue.map((task) => (
              <motion.div
                key={task.id}
                layout
                {...HITL_ENTER}
                className={`flex flex-col gap-4 p-5 bg-[#0d0d12]/90 backdrop-blur-md border border-white/[0.06] rounded-xl relative overflow-hidden group shadow-xl border-t-[3px] ${task.priority > 90 ? 'border-t-[#ef4444]' : 'border-t-[#fbbf24]'}`}
              >
                {/* Subtle gradient overlay */}
                <div
                  className={`absolute inset-0 opacity-[0.04] ${task.priority > 90 ? 'bg-gradient-to-br from-[#ef4444]' : 'bg-gradient-to-br from-[#fbbf24]'} to-transparent pointer-events-none`}
                />

                {/* Header row */}
                <div className="flex items-center justify-between relative z-10">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-9 h-9 rounded-lg border flex items-center justify-center font-mono font-black text-xs shadow-inner ${task.priority > 90 ? 'bg-[#ef4444]/10 border-[#ef4444]/30 text-[#ef4444]' : 'bg-[#fbbf24]/10 border-[#fbbf24]/30 text-[#fbbf24]'}`}
                    >
                      P{task.priority}
                    </div>
                    <div>
                      <div className="text-[9px] font-mono text-[#94a3b8] uppercase tracking-[0.1em] flex items-center gap-1">
                        <Cpu size={9} className="text-purple-400" />
                        {task.agent}
                      </div>
                      <div className="text-[10px] font-mono text-[#3b82f6] flex items-center gap-1 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />
                        {(task.confidence * 100).toFixed(0)}% confidence
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-[#475569]">{task.time}</span>
                </div>

                {/* Content */}
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-bold text-[#f1f5f9] text-sm">{task.client}</span>
                    {task.priority > 90 && (
                      <AlertTriangle size={13} className="text-[#ef4444] flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-sm text-[#94a3b8] leading-relaxed border-l-2 border-white/[0.08] pl-3">
                    {task.action}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2 relative z-10">
                  <button
                    onClick={() => {
                      onApprove(task.id);
                    }}
                    className="flex-1 bg-gradient-to-r from-[#fbbf24] to-[#d97706] hover:from-[#fcd34d] hover:to-[#fbbf24] text-[#060608] font-bold text-sm px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all shadow-[0_4px_14px_rgba(251,191,36,0.22)] hover:shadow-[0_6px_20px_rgba(251,191,36,0.38)] active:scale-95"
                  >
                    <Play size={13} className="fill-current" />
                    Execute
                  </button>
                  <button
                    onClick={() => {
                      onDismiss(task.id);
                    }}
                    className="bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.08] hover:border-[#ef4444]/40 hover:text-[#ef4444] text-[#94a3b8] p-2.5 rounded-lg w-11 flex items-center justify-center transition-all"
                  >
                    <X size={17} />
                  </button>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Views ────────────────────────────────────────────────────────────────────

function OpsCenterView({
  hitl,
  setHitl,
  activity,
  load,
}: {
  hitl: HitlTask[];
  setHitl: React.Dispatch<React.SetStateAction<HitlTask[]>>;
  activity: ActivityEntry[];
  load: number;
}): ReactNode {
  const approve = useCallback(
    (id: string) => {
      setHitl((q) => q.filter((t) => t.id !== id));
    },
    [setHitl],
  );
  const dismiss = useCallback(
    (id: string) => {
      setHitl((q) => q.filter((t) => t.id !== id));
    },
    [setHitl],
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left — topology + stream */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto ops-scrollbar p-6 gap-5">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#fbbf24]/10 border border-[#fbbf24]/20 flex items-center justify-center">
              <Globe size={17} className="text-[#fbbf24]" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight text-[#f1f5f9] leading-none">
                System Topology
              </h2>
              <p className="text-[9px] font-mono text-[#94a3b8] uppercase tracking-[0.12em] mt-0.5">
                Live Architectural Event Flow
              </p>
            </div>
          </div>
        </div>

        <TopologyCanvas load={load} />

        {/* Stream */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
            <Layers size={17} className="text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight text-[#f1f5f9] leading-none">
              WORM Event Stream
            </h2>
            <p className="text-[9px] font-mono text-[#94a3b8] uppercase tracking-[0.12em] mt-0.5">
              Immutable audit chain · SHA-256 verified
            </p>
          </div>
        </div>

        <ActivityStream feed={activity} />
      </div>

      {/* Right — HITL */}
      <HitlQueue queue={hitl} onApprove={approve} onDismiss={dismiss} />
    </div>
  );
}

function DashboardView(): ReactNode {
  const kpis = [
    {
      label: 'AI Action Rate',
      value: '14.2k',
      unit: '/hr',
      icon: <Activity size={12} />,
      trend: '↑ 12%',
      ok: true,
    },
    {
      label: 'SLA Breaches Prevented',
      value: '892',
      unit: '',
      icon: <ShieldAlert size={12} />,
      trend: '↑ 5%',
      ok: true,
    },
    {
      label: 'Customer Health Avg',
      value: '88',
      unit: '/100',
      icon: <User size={12} />,
      trend: '+3 pts',
      ok: true,
    },
    {
      label: 'HITL Queue Depth',
      value: '3',
      unit: '',
      icon: <TerminalSquare size={12} />,
      trend: 'Optimal',
      ok: true,
    },
  ];

  const bars = [20, 30, 40, 62, 80, 95, 85, 62, 40, 30];

  return (
    <div className="flex-1 overflow-y-auto ops-scrollbar p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-black tracking-tighter text-[#f1f5f9]">Platform Overview</h2>
        <p className="text-sm text-[#94a3b8] mt-0.5">
          Live KPI summaries and trend analysis across all tenants
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-5 mb-6">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            {...CARD_ENTER}
            transition={{ ...CARD_ENTER.transition, delay: i * 0.06 }}
          >
            <Card className="p-5" glow>
              <div className="text-[9px] font-mono uppercase text-[#94a3b8] mb-3 flex items-center gap-1.5">
                <span className="text-[#475569]">{k.icon}</span>
                {k.label}
              </div>
              <div className="text-3xl font-black font-mono text-[#f1f5f9] tabular-nums">
                {k.value}
                <span className="text-sm text-[#475569] font-light ml-0.5">{k.unit}</span>
              </div>
              <div
                className={`text-xs mt-2 font-mono ${k.ok ? 'text-[#10b981]' : 'text-[#ef4444]'}`}
              >
                {k.trend}
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-5 mb-5">
        <Card className="p-5 h-[280px] flex flex-col">
          <h3 className="text-sm font-bold text-[#f1f5f9] mb-1">Agent Confidence Distribution</h3>
          <p className="text-[10px] text-[#475569] font-mono mb-4">
            Actions by confidence band · threshold at 0.70
          </p>
          <div className="flex-1 flex items-end gap-1.5">
            {bars.map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-[#111118] border border-white/[0.03] rounded-t-sm relative group overflow-hidden"
                  style={{ height: `${h}%` }}
                >
                  <div
                    className={`absolute inset-0 rounded-t-sm opacity-75 group-hover:opacity-100 transition-opacity ${h > 70 ? 'bg-gradient-to-t from-[#fbbf24] to-[#f59e0b]' : h > 40 ? 'bg-[#3b82f6]/70' : 'bg-white/[0.08]'}`}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[9px] font-mono text-[#475569]">
            <span>0.1</span>
            <span className="text-[#fbbf24]/60">0.70 ▲</span>
            <span>1.0</span>
          </div>
        </Card>

        <Card className="p-5 h-[280px] flex flex-col">
          <h3 className="text-sm font-bold text-[#f1f5f9] mb-1">Orchestration Heatmap</h3>
          <p className="text-[10px] text-[#475569] font-mono mb-4">
            Activity density by hour × day-of-week
          </p>
          <div className="flex-1 grid grid-cols-7 gap-1">
            {HEATMAP_VALUES.map((v, i) => {
              const bg =
                v > 0.8
                  ? 'bg-[#fbbf24]'
                  : v > 0.6
                    ? 'bg-[#fbbf24]/55'
                    : v > 0.35
                      ? 'bg-[#fbbf24]/25'
                      : 'bg-white/[0.03]';
              return (
                <div key={i} className={`rounded-sm ${bg}`} title={`${(v * 100).toFixed(0)}%`} />
              );
            })}
          </div>
          <div className="flex justify-between mt-2 text-[9px] font-mono text-[#475569]">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-3 gap-5">
        {[
          {
            label: 'Total Pipeline',
            val: '$4.2M',
            sub: '+$380k this week',
            icon: <DollarSign size={14} />,
            pct: 68,
          },
          {
            label: 'Active Accounts',
            val: '347',
            sub: '42 high-intent',
            icon: <Users size={14} />,
            pct: 82,
          },
          {
            label: 'CSAT Score',
            val: '4.7',
            sub: '/ 5.0 · last 30d',
            icon: <TrendingUp size={14} />,
            pct: 94,
          },
        ].map((item) => (
          <Card key={item.label} className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-md bg-white/[0.04] text-[#fbbf24]">{item.icon}</div>
              <span className="text-[10px] font-mono text-[#94a3b8] uppercase tracking-[0.1em]">
                {item.label}
              </span>
            </div>
            <div className="text-2xl font-black font-mono text-[#f1f5f9] mb-1">{item.val}</div>
            <div className="text-[10px] text-[#475569] mb-3">{item.sub}</div>
            <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#fbbf24] to-[#f59e0b] rounded-full"
                style={{ width: `${item.pct}%` }}
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Customer360View(): ReactNode {
  const [tab, setTab] = useState<'overview' | 'tickets' | 'interactions'>('overview');
  const tabs: { id: typeof tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tickets', label: 'Active Tickets (2)' },
    { id: 'interactions', label: 'Interactions' },
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left sidebar */}
      <div className="w-[300px] flex-shrink-0 bg-[#0d0d12] border-r border-white/[0.06] flex flex-col z-10 shadow-xl">
        {/* Avatar */}
        <div className="p-6 border-b border-white/[0.06] text-center">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#fbbf24] to-[#f59e0b] mx-auto mb-4 flex items-center justify-center text-2xl font-black text-[#060608] shadow-[0_0_24px_rgba(251,191,36,0.3)]">
            AC
          </div>
          <h2 className="text-xl font-bold text-[#f1f5f9]">Acme Corp</h2>
          <div className="mt-2 flex justify-center gap-2">
            <Badge variant="brand">Enterprise</Badge>
            <Badge variant="success">Healthy</Badge>
          </div>
        </div>

        {/* Health gauge */}
        <div className="p-5 border-b border-white/[0.06] flex flex-col items-center">
          <span className="text-[9px] font-mono uppercase text-[#94a3b8] tracking-[0.12em] mb-3">
            Customer Health
          </span>
          <div className="relative w-28 h-28">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="rgba(255,255,255,0.04)"
                strokeWidth="10"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="#10b981"
                strokeWidth="10"
                strokeDasharray="263.9"
                strokeDashoffset="26.4"
                strokeLinecap="round"
                className="drop-shadow-[0_0_10px_rgba(16,185,129,0.6)]"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-black font-mono text-[#10b981] tabular-nums">90</span>
              <span className="text-[9px] font-mono text-[#475569]">/100</span>
            </div>
          </div>
        </div>

        {/* Fields */}
        <div className="p-5 flex-1 overflow-y-auto ops-scrollbar space-y-4">
          {[
            {
              label: 'Assigned CSM',
              val: 'Sarah Chen',
              icon: <User size={13} className="text-[#94a3b8]" />,
            },
            {
              label: 'Contact Email',
              val: '•••@acme.com',
              reveal: true,
              icon: <Mail size={13} className="text-[#94a3b8]" />,
            },
            {
              label: 'Phone',
              val: '•••••••4821',
              reveal: true,
              icon: <Phone size={13} className="text-[#94a3b8]" />,
            },
            {
              label: 'Annual ARR',
              val: '$145,000',
              icon: <DollarSign size={13} className="text-[#94a3b8]" />,
            },
          ].map((f) => (
            <div key={f.label}>
              <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-[#475569] mb-1">
                {f.label}
              </div>
              <div className="text-sm font-medium text-[#f1f5f9] flex items-center gap-2">
                {f.icon}
                {f.val}
                {f.reveal === true && (
                  <button className="text-[9px] bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.06] px-1.5 py-0.5 rounded font-mono text-[#94a3b8] transition-colors">
                    Reveal
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-white/[0.06] px-6 bg-[#0a0a0e]/50 backdrop-blur flex-shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
              }}
              className={`relative px-4 py-3.5 text-sm font-medium transition-colors ${tab === t.id ? 'text-[#fbbf24]' : 'text-[#94a3b8] hover:text-[#f1f5f9]'}`}
            >
              {t.label}
              {tab === t.id && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-px bg-[#fbbf24]"
                />
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto ops-scrollbar p-6">
          {/* AI Insights card */}
          <Card className="p-5 mb-5 border-l-[3px] border-l-[#fbbf24]" glow>
            <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
              <Cpu size={15} className="text-[#fbbf24]" />
              AI Analyst Insights
              <Badge variant="brand" className="ml-auto">
                Live
              </Badge>
            </h3>
            <ul className="space-y-2 text-sm text-[#94a3b8]">
              <li className="flex gap-2">
                <span className="text-[#fbbf24] flex-shrink-0">•</span>Usage of Orchestration Engine
                increased 40% in last 30 days.
              </li>
              <li className="flex gap-2">
                <span className="text-[#fbbf24] flex-shrink-0">•</span>Detected positive sentiment
                across support tickets #8819–#8821.
              </li>
              <li className="flex gap-2">
                <span className="text-[#fbbf24] flex-shrink-0">•</span>Renewal in 60 days.
                Recommended action: schedule executive sync.
              </li>
            </ul>
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-[#f1f5f9]">Recent Interactions</h3>
            <div className="flex gap-2">
              <button className="text-xs bg-[#0d0d12] border border-white/[0.08] text-[#94a3b8] px-3 py-1.5 rounded-lg hover:text-[#f1f5f9] transition-colors">
                Remote Assist
              </button>
              <button className="text-xs bg-gradient-to-r from-[#fbbf24] to-[#d97706] text-[#060608] font-bold px-4 py-1.5 rounded-lg shadow-[0_0_12px_rgba(251,191,36,0.2)]">
                New Comms Draft
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {[
              {
                type: 'email',
                icon: <Mail size={15} className="text-[#3b82f6]" />,
                title: 'Automated Check-in Email',
                actor: 'Comms Agent',
                status: 'success' as BadgeVariant,
                statusLabel: 'Delivered',
                preview: '"Hi Team, noticed you\'ve been utilizing the new pipeline features..."',
                time: '2 days ago',
              },
              {
                type: 'call',
                icon: <Phone size={15} className="text-[#10b981]" />,
                title: 'Quarterly Business Review Call',
                actor: 'Sarah Chen',
                status: 'success' as BadgeVariant,
                statusLabel: 'Completed',
                preview: 'Duration 42 min. Notes: discussed Q3 roadmap and expansion seats.',
                time: '1 week ago',
              },
              {
                type: 'doc',
                icon: <FileText size={15} className="text-[#a855f7]" />,
                title: 'Contract Renewal — Draft v2',
                actor: 'Legal AI Agent',
                status: 'warning' as BadgeVariant,
                statusLabel: 'Pending',
                preview: 'Renewal terms updated. Awaiting signature from account owner.',
                time: '2 weeks ago',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="bg-[#0d0d12] border border-white/[0.06] p-4 rounded-xl flex gap-4 hover:border-white/10 transition-colors"
              >
                <div className="mt-0.5 flex-shrink-0">{item.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="font-bold text-sm text-[#f1f5f9]">{item.title}</span>
                    <span className="text-[10px] text-[#475569]">by {item.actor}</span>
                    <Badge variant={item.status}>{item.statusLabel}</Badge>
                  </div>
                  <p className="text-sm text-[#94a3b8] truncate">{item.preview}</p>
                </div>
                <div className="text-[10px] font-mono text-[#475569] flex-shrink-0 mt-0.5">
                  {item.time}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ComplianceView({ activity }: { activity: ActivityEntry[] }): ReactNode {
  return (
    <div className="flex-1 overflow-y-auto ops-scrollbar p-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tighter text-[#f1f5f9]">
            Compliance & Audit
          </h2>
          <p className="text-sm text-[#94a3b8] mt-0.5">
            WORM hash chain · SOC 2 · ISO 27001 · HIPAA
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="success" className="text-xs px-3 py-1">
            SOC 2 TYPE II
          </Badge>
          <Badge variant="brand" className="text-xs px-3 py-1">
            ISO 27001:2022
          </Badge>
          <Badge variant="purple" className="text-xs px-3 py-1">
            HIPAA
          </Badge>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          {
            label: 'Chain Integrity',
            val: '100% Valid',
            sub: 'All SHA-256 hashes matched',
            icon: <Fingerprint size={13} />,
            border: 'border-l-[#10b981]',
            valColor: 'text-[#10b981]',
          },
          {
            label: 'Active Violations',
            val: '0',
            sub: 'Clear across all tenants',
            icon: <ShieldAlert size={13} />,
            border: 'border-l-white/10',
            valColor: 'text-[#f1f5f9]',
          },
          {
            label: 'PHI Access Events',
            val: '14',
            sub: 'Last 24h — HIPAA logged',
            icon: <Lock size={13} />,
            border: 'border-l-[#fbbf24]',
            valColor: 'text-[#fbbf24]',
          },
        ].map((c) => (
          <Card key={c.label} className={`p-5 border-l-[3px] ${c.border}`}>
            <div className="text-[9px] font-mono uppercase text-[#94a3b8] mb-2 flex items-center gap-1.5 tracking-[0.12em]">
              <span className="text-[#475569]">{c.icon}</span>
              {c.label}
            </div>
            <div className={`text-2xl font-black font-mono ${c.valColor}`}>{c.val}</div>
            <div className="text-[10px] text-[#475569] mt-1">{c.sub}</div>
          </Card>
        ))}
      </div>

      {/* WORM Ledger */}
      <Card className="flex-1 flex flex-col min-h-[400px]">
        <div className="p-4 border-b border-white/[0.06] flex items-center justify-between bg-black/20 rounded-t-xl flex-shrink-0">
          <h3 className="font-bold text-[#f1f5f9] flex items-center gap-2">
            <Layers size={15} className="text-purple-400" />
            WORM Audit Ledger
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter hash or actor…"
              className="bg-[#060608] border border-white/[0.08] rounded-lg px-3 py-1.5 text-[11px] font-mono text-[#94a3b8] w-52 focus:outline-none focus:border-[#fbbf24]/40 transition-colors"
            />
            <Badge variant="success">Chain OK</Badge>
          </div>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[120px_1fr_100px] items-center py-2 px-4 bg-black/10 text-[9px] font-mono text-[#475569] uppercase tracking-[0.1em] border-b border-white/[0.04] flex-shrink-0">
          <span>Time · Hash</span>
          <span>Event</span>
          <span className="text-right">Action</span>
        </div>

        <div className="flex-1 overflow-y-auto ops-scrollbar relative">
          {/* Chain line */}
          <div className="absolute left-[56px] top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/[0.07] to-transparent z-0" />

          <div className="flex flex-col relative z-10 p-2 gap-1">
            {activity.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[120px_1fr_100px] items-center py-2.5 px-3 bg-white/[0.01] hover:bg-white/[0.04] border border-transparent hover:border-white/[0.05] rounded-lg group transition-colors"
              >
                {/* Time + chain node */}
                <div className="flex items-center gap-3 relative">
                  <span className="text-[9px] font-mono text-[#475569] w-10">{item.time}</span>
                  <div
                    className={`absolute left-[44px] w-2.5 h-2.5 rounded-full border-[2px] border-[#060608] shadow-[0_0_8px_currentColor] z-20 ${item.actor === 'AI' ? 'bg-purple-400 text-purple-400' : 'bg-[#10b981] text-[#10b981]'}`}
                  />
                </div>
                {/* Event */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <Badge
                    variant={item.actor === 'AI' ? 'purple' : 'brand'}
                    className="flex-shrink-0"
                  >
                    {item.actor}
                  </Badge>
                  <span className="text-[10px] font-mono text-[#475569] flex-shrink-0">
                    {item.hash}
                  </span>
                  <span className="text-sm font-semibold text-[#f1f5f9] flex-shrink-0">
                    {item.name}
                  </span>
                  <span className="text-sm text-[#94a3b8] truncate">{item.action}</span>
                  <span className="text-[10px] bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded text-[#f1f5f9] flex-shrink-0">
                    {item.target}
                  </span>
                </div>
                {/* Action */}
                <div className="text-right">
                  <button className="text-[9px] font-mono text-[#fbbf24] hover:underline opacity-0 group-hover:opacity-100 transition-opacity uppercase tracking-[0.1em]">
                    View JSON
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Navigation ───────────────────────────────────────────────────────────────

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Operations',
    items: [
      { id: 'ops', icon: <Layout size={17} />, label: 'Ops Center' },
      { id: 'dashboard', icon: <Activity size={17} />, label: 'Dashboard' },
      { id: 'customers', icon: <User size={17} />, label: 'Customer 360' },
    ],
  },
  {
    label: 'Compliance',
    items: [{ id: 'compliance', icon: <ShieldAlert size={17} />, label: 'Audit & Compliance' }],
  },
];

function NavItem({
  item,
  active,
  collapsed,
  onClick,
}: {
  item: NavItemDef;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg w-full transition-all duration-150 group overflow-hidden mb-0.5
        ${
          active
            ? 'bg-white/[0.06] text-[#fbbf24] border border-white/[0.05] shadow-inner'
            : 'text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-white/[0.03] border border-transparent'
        }
        ${collapsed ? 'justify-center' : ''}`}
    >
      {active && (
        <motion.div
          layoutId="nav-active"
          className="absolute left-0 top-[20%] bottom-[20%] w-[3px] bg-[#fbbf24] rounded-r-full shadow-[0_0_10px_rgba(251,191,36,0.5)]"
        />
      )}
      <span
        className={`flex-shrink-0 z-10 transition-colors ${active ? 'text-[#fbbf24]' : 'text-[#475569] group-hover:text-[#94a3b8]'}`}
      >
        {item.icon}
      </span>
      {!collapsed && <span className="text-sm font-medium z-10 truncate">{item.label}</span>}
      {!collapsed && item.badge !== undefined && (
        <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.07] text-[#94a3b8] z-10">
          {item.badge}
        </span>
      )}
    </button>
  );
}

// ─── Main Shell ───────────────────────────────────────────────────────────────

export function OpsCenter(): ReactNode {
  const [route, setRoute] = useState<RouteId>('ops');
  const [collapsed, setCollapsed] = useState(false);
  const [hitl, setHitl] = useState(INITIAL_HITL);
  const [activity] = useState(INITIAL_ACTIVITY);
  const [load, setLoad] = useState(42);

  // Simulate SSE topology load updates
  useEffect(() => {
    const id = setInterval(() => {
      setLoad((p) => Math.max(15, Math.min(94, p + (Math.random() * 24 - 12))));
    }, 1600);
    return () => {
      clearInterval(id);
    };
  }, []);

  const navigate = useCallback((id: RouteId) => {
    setRoute(id);
  }, []);

  return (
    <div className="flex h-screen w-screen bg-[#060608] text-[#f1f5f9] font-sans overflow-hidden selection:bg-[#fbbf24]/25">
      {/* ── Ambient background FX ──────────────────────────────────────────── */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(251,191,36,0.04)_0%,transparent_55%),radial-gradient(circle_at_100%_100%,rgba(59,130,246,0.04)_0%,transparent_55%)]" />
        <div className="absolute inset-0 opacity-[0.025] bg-[linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.12)_1px,transparent_1px)] bg-[size:32px_32px]" />
      </div>

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <motion.aside
        animate={{ width: collapsed ? 64 : 240 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="flex-shrink-0 border-r border-white/[0.06] bg-[#060608]/90 backdrop-blur-2xl z-40 flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.5)] overflow-hidden"
      >
        {/* Brand */}
        <div className="h-[56px] flex items-center px-4 border-b border-white/[0.06] flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#fbbf24] to-[#d97706] flex items-center justify-center flex-shrink-0 shadow-[0_0_16px_rgba(251,191,36,0.4)]">
            <Zap size={17} className="text-[#060608] fill-[#060608]" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
                className="ml-3 font-black tracking-tighter text-lg text-transparent bg-clip-text bg-gradient-to-r from-white to-[#94a3b8] whitespace-nowrap"
              >
                ORDR Ops
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 overflow-y-auto ops-scrollbar px-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-4">
              {!collapsed && (
                <div className="px-3 text-[9px] font-mono text-[#475569] mb-2 tracking-[0.15em] uppercase">
                  {section.label}
                </div>
              )}
              {section.items.map((item) => (
                <NavItem
                  key={item.id}
                  item={item}
                  active={route === item.id}
                  collapsed={collapsed}
                  onClick={() => {
                    navigate(item.id);
                  }}
                />
              ))}
            </div>
          ))}
        </nav>

        {/* User card */}
        <div
          className={`p-3 border-t border-white/[0.06] flex items-center gap-3 bg-[#0d0d12]/40 flex-shrink-0 ${collapsed ? 'justify-center' : ''}`}
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#3b82f6] to-[#8b5cf6] flex items-center justify-center flex-shrink-0 text-xs font-bold border border-white/10">
            AD
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">Admin User</div>
              <div className="text-[9px] font-mono text-[#475569] truncate tracking-[0.1em]">
                super_admin
              </div>
            </div>
          )}
        </div>
      </motion.aside>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 z-10">
        {/* TopBar */}
        <header className="h-[56px] flex-shrink-0 border-b border-white/[0.06] bg-[#0a0a0e]/80 backdrop-blur-xl flex items-center justify-between px-5 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setCollapsed((c) => !c);
              }}
              className="p-1.5 rounded-lg hover:bg-white/[0.05] text-[#475569] hover:text-[#94a3b8] transition-colors border border-transparent hover:border-white/[0.06]"
            >
              <Command size={15} />
            </button>
            <div className="flex items-center gap-2 text-sm text-[#94a3b8]">
              <span className="capitalize">{route === 'ops' ? 'Operations' : route}</span>
              <ChevronRight size={13} className="text-[#475569]" />
              <span className="text-[#f1f5f9] font-medium capitalize">
                {route === 'ops'
                  ? 'Ops Center'
                  : route === 'customers'
                    ? 'Customer 360'
                    : route === 'compliance'
                      ? 'Audit & Compliance'
                      : 'Dashboard'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div className="relative flex items-center w-60 bg-[#060608] border border-white/[0.07] rounded-lg px-3 py-1.5 focus-within:border-[#fbbf24]/40 focus-within:ring-1 focus-within:ring-[#fbbf24]/20 transition-all">
              <Search size={13} className="text-[#475569] mr-2 flex-shrink-0" />
              <input
                type="text"
                placeholder="Search… (⌘K)"
                className="bg-transparent border-none outline-none text-xs font-mono text-[#94a3b8] placeholder:text-[#475569] w-full"
              />
            </div>
            {/* HITL badge */}
            <button
              onClick={() => {
                navigate('ops');
              }}
              className="relative p-2 text-[#94a3b8] hover:text-[#fbbf24] transition-colors bg-white/[0.02] rounded-lg border border-white/[0.04] hover:border-[#fbbf24]/20"
            >
              <TerminalSquare size={17} />
              <AnimatePresence>
                {hitl.length > 0 && (
                  <motion.span
                    key={hitl.length}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute -top-1 -right-1 bg-[#fbbf24] text-[#060608] text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(251,191,36,0.4)]"
                  >
                    {hitl.length}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
            {/* Notifications */}
            <button className="relative p-2 text-[#94a3b8] hover:text-[#f1f5f9] transition-colors bg-white/[0.02] rounded-lg border border-white/[0.04]">
              <Bell size={17} />
              <span className="absolute top-2 right-2 w-1.5 h-1.5 bg-[#ef4444] rounded-full shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
            </button>
            {/* Settings */}
            <button className="p-2 text-[#475569] hover:text-[#94a3b8] transition-colors bg-white/[0.02] rounded-lg border border-white/[0.04]">
              <Settings size={17} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <AnimatePresence mode="wait">
          <motion.div key={route} {...PANEL_ENTER} className="flex-1 flex overflow-hidden">
            {route === 'ops' && (
              <OpsCenterView hitl={hitl} setHitl={setHitl} activity={activity} load={load} />
            )}
            {route === 'dashboard' && <DashboardView />}
            {route === 'customers' && <Customer360View />}
            {route === 'compliance' && <ComplianceView activity={activity} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Global styles ──────────────────────────────────────────────────── */}
      <style>{`
        .ops-scrollbar::-webkit-scrollbar { width: 3px; height: 3px; }
        .ops-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .ops-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
        .ops-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(251,191,36,0.3); }

        @keyframes opsFlow {
          from { stroke-dashoffset: 50; }
          to   { stroke-dashoffset: 0; }
        }
        .ops-flow {
          animation-name: opsFlow;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
      `}</style>
    </div>
  );
}
