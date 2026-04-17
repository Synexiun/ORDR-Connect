/**
 * Sidebar — Grouped navigation with collapsible state.
 *
 * Sections: Operations, Intelligence, Reporting, Compliance, Platform, System.
 * Brand header, compliance badge, and user card at bottom.
 *
 * SECURITY:
 * - No PHI/PII in navigation labels (Rule 6)
 * - User card shows name/role only — no tokens or tenant secrets (Rule 5)
 * - Logout clears in-memory auth state only (Rule 2)
 */

import { type ReactNode, type ComponentType, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { useAuth } from '../../lib/auth';
import { useBranding } from '../ThemeProvider';
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  Ticket,
  Bot,
  BarChart3,
  FileText,
  ScrollText,
  ShieldCheck,
  Store,
  Code,
  Heart,
  Handshake,
  Settings,
  HelpCircle,
  LogOut,
  X,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Link2,
  Clock,
  Search,
  DollarSign,
  Network,
  ToggleRight,
  Lock,
  Building2,
  Monitor,
  Send,
  RefreshCw,
  MessageCircle,
  Bell,
} from '../icons';

// ─── Navigation Config ───────────────────────────────────────

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: 'OPERATIONS',
    items: [
      { to: '/ops', label: 'Ops Center', icon: Network },
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/customers', label: 'Customers', icon: Users },
      { to: '/interactions', label: 'Interactions', icon: MessageSquare },
      { to: '/messages', label: 'Messages', icon: Send },
      { to: '/chat', label: 'Team Chat', icon: MessageCircle },
      { to: '/notifications', label: 'Notifications', icon: Bell },
      { to: '/tickets', label: 'Tickets', icon: Ticket },
      { to: '/search', label: 'Search', icon: Search },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { to: '/agents', label: 'Agent Activity', icon: Bot },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'REPORTING',
    items: [
      { to: '/reports', label: 'Reports', icon: FileText },
      { to: '/audit-log', label: 'Audit Log', icon: ScrollText },
    ],
  },
  {
    label: 'COMPLIANCE',
    items: [
      { to: '/compliance', label: 'Compliance', icon: ShieldCheck },
      { to: '/sla', label: 'SLA Monitor', icon: Clock },
      { to: '/dsr', label: 'DSR Management', icon: FileText },
      { to: '/feature-flags', label: 'Feature Flags', icon: ToggleRight },
      { to: '/roles', label: 'Roles & Permissions', icon: Lock },
      { to: '/organizations', label: 'Organizations', icon: Building2 },
      { to: '/consent', label: 'Consent Records', icon: ShieldCheck },
    ],
  },
  {
    label: 'AUTOMATION',
    items: [
      { to: '/workflows', label: 'Workflows', icon: GitBranch },
      { to: '/integrations', label: 'Integrations', icon: Link2 },
      { to: '/integrations/sync', label: 'Sync History', icon: RefreshCw },
      { to: '/scheduler', label: 'Scheduler', icon: Clock },
    ],
  },
  {
    label: 'PLATFORM',
    items: [
      { to: '/marketplace', label: 'Marketplace', icon: Store },
      { to: '/marketplace/review', label: 'Agent Review', icon: ShieldCheck },
      { to: '/developer', label: 'Developer', icon: Code },
      { to: '/healthcare', label: 'Healthcare', icon: Heart },
      { to: '/partner', label: 'Partner', icon: Handshake },
      { to: '/billing', label: 'Billing', icon: DollarSign },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/tenant', label: 'Tenant', icon: Building2 },
      { to: '/cobrowse', label: 'Co-Browse', icon: Monitor },
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/help', label: 'Help', icon: HelpCircle },
    ],
  },
];

// ─── Props ───────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

// ─── Component ───────────────────────────────────────────────

export function Sidebar({
  collapsed,
  onToggle,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps): ReactNode {
  const { user, logout } = useAuth();
  const { brand } = useBranding();
  const navigate = useNavigate();

  const handleLogout = useCallback(() => {
    logout();
    void navigate('/login');
  }, [logout, navigate]);

  const handleNavClick = useCallback(() => {
    onMobileClose?.();
  }, [onMobileClose]);

  const userInitials =
    user !== null && user.name !== ''
      ? user.name
          .split(' ')
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
      : 'U';

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-surface',
        'transition-all duration-200 ease-in-out',
        'lg:static lg:translate-x-0',
        collapsed ? 'w-16' : 'w-64',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      )}
      aria-label="Main navigation"
    >
      {/* ─── Brand Header ─────────────────────────────────── */}
      <div className="flex h-14 items-center border-b border-border px-3">
        <div className="flex items-center gap-3">
          {brand.logoUrl !== null && brand.logoUrl !== '' ? (
            <img
              src={brand.logoUrl}
              alt="Logo"
              className="h-7 w-7 shrink-0 rounded-lg object-contain"
            />
          ) : (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-accent text-xs font-bold text-[#060608]">
              O
            </div>
          )}
          {!collapsed && (
            <h1 className="font-mono text-sm font-bold tracking-tight text-content">
              ORDR<span className="text-content-tertiary">.</span>Connect
            </h1>
          )}
        </div>

        {/* Mobile close button */}
        <button
          onClick={onMobileClose}
          className={cn(
            'ml-auto rounded-lg p-1 text-content-tertiary hover:text-content lg:hidden',
            collapsed && 'hidden',
          )}
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Desktop collapse toggle */}
        <button
          onClick={onToggle}
          className={cn(
            'hidden rounded-lg p-1 text-content-tertiary transition-colors hover:bg-surface-tertiary hover:text-content lg:block',
            collapsed ? 'mx-auto' : 'ml-auto',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* ─── Navigation Sections ──────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-2 py-3" role="navigation">
        {navSections.map((section) => (
          <div key={section.label} className="mb-1">
            {!collapsed && (
              <p className="mb-1 px-2 pt-3 text-2xs font-semibold uppercase tracking-wider text-content-tertiary first:pt-0">
                {section.label}
              </p>
            )}
            {collapsed && <div className="my-2 border-t border-border/50" />}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to + item.label}
                    to={item.to}
                    onClick={handleNavClick}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'nav-link',
                        collapsed && 'justify-center px-0',
                        isActive && 'nav-link-active',
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ─── Compliance Badge ─────────────────────────────── */}
      {!collapsed && (
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-content-secondary">Compliance: Active</span>
          </div>
          <p className="mt-1 text-2xs text-content-tertiary">SOC 2 · ISO 27001 · HIPAA</p>
        </div>
      )}
      {collapsed && (
        <div className="border-t border-border py-3 text-center" title="Compliance: Active">
          <span className="mx-auto block h-2 w-2 rounded-full bg-emerald-400" />
        </div>
      )}

      {/* ─── User Card ────────────────────────────────────── */}
      <div className="border-t border-border px-3 py-3">
        <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-3')}>
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-accent/20 text-xs font-semibold text-brand-accent"
            aria-hidden="true"
            title={collapsed ? (user?.name ?? 'User') : undefined}
          >
            {userInitials}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-content">{user?.name ?? 'User'}</p>
                <p className="truncate text-2xs text-content-tertiary">
                  {user?.role ?? 'Operator'}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="rounded-lg p-1.5 text-content-tertiary transition-colors hover:bg-surface-tertiary hover:text-content"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
