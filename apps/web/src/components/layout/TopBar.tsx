/**
 * TopBar — Top navigation bar with breadcrumbs, notifications, and user menu.
 *
 * SECURITY:
 * - No PHI/PII in breadcrumb labels or notifications (Rule 6)
 * - User dropdown actions use in-memory auth only (Rule 2)
 * - Notification count is a number — no sensitive content displayed (Rule 7)
 */

import { type ReactNode, useState, useCallback, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { useAuth } from '../../lib/auth';
import { Bell, Menu, ChevronRight, LogOut, Settings, User, Users } from '../icons';

// ─── Route → Label Map ──────────────────────────────────────

const routeLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  customers: 'Customers',
  interactions: 'Interactions',
  tickets: 'Tickets',
  agents: 'Agent Activity',
  analytics: 'Analytics',
  reports: 'Reports',
  'audit-log': 'Audit Log',
  compliance: 'Compliance',
  marketplace: 'Marketplace',
  developer: 'Developer',
  healthcare: 'Healthcare',
  partner: 'Partner',
  settings: 'Settings',
  help: 'Help',
  notifications: 'Notifications',
};

// ─── Props ───────────────────────────────────────────────────

interface TopBarProps {
  onMenuToggle: () => void;
  notificationCount?: number;
}

// ─── Component ───────────────────────────────────────────────

export function TopBar({ onMenuToggle, notificationCount = 3 }: TopBarProps): ReactNode {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Build breadcrumbs from current path
  const pathSegments = location.pathname.split('/').filter(Boolean);
  const breadcrumbs = pathSegments.map((segment, index) => {
    const href = '/' + pathSegments.slice(0, index + 1).join('/');
    const label = routeLabels[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
    return { label, href };
  });

  const handleLogout = useCallback(() => {
    setUserMenuOpen(false);
    logout();
    void navigate('/login');
  }, [logout, navigate]);

  const handleNavigate = useCallback(
    (path: string) => {
      setUserMenuOpen(false);
      void navigate(path);
    },
    [navigate],
  );

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }

    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [userMenuOpen]);

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
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4 lg:px-6">
      {/* ─── Left: Menu toggle + Breadcrumbs ──────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="rounded-lg p-2 text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content lg:hidden"
          aria-label="Toggle navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Breadcrumbs */}
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Breadcrumbs">
          <Link
            to="/dashboard"
            className="text-sm text-content-tertiary transition-colors hover:text-content"
          >
            Home
          </Link>
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.href} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-content-tertiary" aria-hidden="true" />
              {index === breadcrumbs.length - 1 ? (
                <span className="text-sm font-medium text-content">{crumb.label}</span>
              ) : (
                <Link
                  to={crumb.href}
                  className="text-sm text-content-tertiary transition-colors hover:text-content"
                >
                  {crumb.label}
                </Link>
              )}
            </span>
          ))}
        </nav>

        {/* Mobile: current page name */}
        <span className="text-sm font-medium text-content lg:hidden">
          {breadcrumbs[breadcrumbs.length - 1]?.label ?? 'Dashboard'}
        </span>
      </div>

      {/* ─── Right: Actions ───────────────────────────── */}
      <div className="flex items-center gap-2">
        {/* Compliance indicator */}
        <div className="hidden items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="text-xs font-medium text-emerald-400">Compliant</span>
        </div>

        {/* Notifications */}
        <button
          onClick={() => {
            void navigate('/notifications');
          }}
          className="relative rounded-lg p-2 text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content"
          aria-label={`Notifications${notificationCount > 0 ? ` (${notificationCount} unread)` : ''}`}
          title="Notifications"
        >
          <Bell className="h-5 w-5" />
          {notificationCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-kpi-amber text-[9px] font-bold text-white">
              {notificationCount > 9 ? '9+' : notificationCount}
            </span>
          )}
        </button>

        {/* User avatar dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => {
              setUserMenuOpen((prev) => !prev);
            }}
            className="flex items-center gap-2 rounded-lg p-1.5 transition-colors hover:bg-surface-tertiary"
            aria-label="User menu"
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-accent/20 text-xs font-semibold text-brand-accent">
              {userInitials}
            </div>
          </button>

          {/* Dropdown menu */}
          {userMenuOpen && (
            <div
              className={cn(
                'absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-surface py-1 shadow-lg',
                'animate-in fade-in-0 zoom-in-95',
              )}
              role="menu"
              aria-label="User actions"
            >
              {/* User info */}
              <div className="border-b border-border px-3 py-2">
                <p className="truncate text-sm font-medium text-content">{user?.name ?? 'User'}</p>
                <p className="truncate text-2xs text-content-tertiary">{user?.email ?? ''}</p>
              </div>

              <button
                onClick={() => {
                  handleNavigate('/settings');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content"
                role="menuitem"
              >
                <User className="h-4 w-4" />
                Profile
              </button>
              <button
                onClick={() => {
                  handleNavigate('/settings');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content"
                role="menuitem"
              >
                <Users className="h-4 w-4" />
                Team
              </button>
              <button
                onClick={() => {
                  handleNavigate('/settings');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content"
                role="menuitem"
              >
                <Settings className="h-4 w-4" />
                Settings
              </button>

              <div className="border-t border-border" />

              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-surface-tertiary"
                role="menuitem"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
