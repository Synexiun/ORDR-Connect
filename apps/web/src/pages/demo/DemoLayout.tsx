/**
 * DemoLayout — ORDR-Connect Demo Shell
 *
 * Shared layout for /demo/* routes. Dark topology aesthetic with
 * grouped sidebar navigation across all platform capabilities.
 *
 * COMPLIANCE:
 * - No PHI in demo data (Rule 6)
 * - No secrets exposed (Rule 5)
 * - All data is synthetic mock data
 */

import { type ReactNode, type ComponentType } from 'react';
import { Outlet, NavLink, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  Users,
  MessageSquare,
  ShieldCheck,
  Activity,
  BarChart3,
  Sparkles,
  Zap,
} from '../../components/icons';

// --- Types ---

interface NavItem {
  path: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// --- Navigation Config ---

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'CORE',
    items: [
      { path: '/demo', label: 'Operations', icon: LayoutDashboard, end: true },
      { path: '/demo/agents', label: 'Agent Runtime', icon: Bot },
      { path: '/demo/customers', label: 'Customer Intel', icon: Users },
    ],
  },
  {
    title: 'DELIVERY',
    items: [{ path: '/demo/channels', label: 'Channels', icon: MessageSquare }],
  },
  {
    title: 'GOVERNANCE',
    items: [
      { path: '/demo/compliance', label: 'Compliance', icon: ShieldCheck },
      { path: '/demo/events', label: 'Event Stream', icon: Activity },
    ],
  },
  {
    title: 'INTELLIGENCE',
    items: [{ path: '/demo/analytics', label: 'Analytics', icon: BarChart3 }],
  },
];

// --- Component ---

export function DemoLayout(): ReactNode {
  return (
    <div className="flex h-screen bg-[#060608] font-sans text-slate-300 selection:bg-amber-500/30">
      {/* Background Effects */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-80"
        style={{
          backgroundImage:
            'url("data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wMSkiLz48L3N2Zz4=")',
        }}
      />
      <div className="pointer-events-none fixed left-[-10%] top-[-20%] z-0 h-[50%] w-[50%] rounded-full bg-amber-900/10 blur-[150px]" />
      <div className="pointer-events-none fixed bottom-[-20%] right-[-10%] z-0 h-[50%] w-[50%] rounded-full bg-blue-900/10 blur-[150px]" />

      {/* Sidebar */}
      <aside className="relative z-50 flex w-[220px] shrink-0 flex-col border-r border-white/5 bg-[#0a0a0f]/90 backdrop-blur-xl">
        {/* Logo */}
        <Link
          to="/demo"
          className="flex items-center gap-2.5 px-5 py-6 transition-opacity hover:opacity-80"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 shadow-[0_0_20px_rgba(251,191,36,0.15)]">
            <Sparkles className="h-5 w-5 text-black" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tighter text-white">
              ORDR<span className="font-light text-amber-400">.ai</span>
            </h1>
            <p className="font-mono text-[9px] tracking-widest text-slate-600">OPERATIONS OS</p>
          </div>
        </Link>

        {/* Nav Sections */}
        <nav className="demo-scrollbar flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="mb-2 px-3 font-mono text-[9px] tracking-[0.2em] text-slate-600">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items.map(({ path, label, icon: Icon, end }) => (
                  <NavLink
                    key={path}
                    to={path}
                    end={end}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200 ${
                        isActive
                          ? 'border border-amber-500/20 bg-amber-500/10 text-amber-400'
                          : 'border border-transparent text-slate-500 hover:bg-white/5 hover:text-slate-300'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* System Status */}
        <div className="border-t border-white/5 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
            <span className="font-mono text-[10px] font-bold tracking-widest text-emerald-400">
              ALL SYSTEMS ACTIVE
            </span>
          </div>
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between font-mono text-[10px] text-slate-600">
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" /> Agents
              </span>
              <span className="text-emerald-500">6 online</span>
            </div>
            <div className="flex items-center justify-between font-mono text-[10px] text-slate-600">
              <span className="flex items-center gap-1">
                <Activity className="h-3 w-3" /> Events
              </span>
              <span className="text-blue-400">1.2K/s</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden">
        <Outlet />
      </main>

      {/* Shared Animations */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .demo-scrollbar::-webkit-scrollbar { width: 4px; }
        .demo-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .demo-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
        .demo-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(251,191,36,0.4); }
        @keyframes dashFlow { from { stroke-dashoffset: 50; } to { stroke-dashoffset: 0; } }
        .data-flow-animation { animation-name: dashFlow; animation-timing-function: linear; animation-iteration-count: infinite; }
        @keyframes pulseRing { 0% { transform: scale(1); opacity: 0.4; } 100% { transform: scale(1.4); opacity: 0; } }
        .pulse-ring { animation: pulseRing 2s ease-out infinite; }
      `,
        }}
      />
    </div>
  );
}
