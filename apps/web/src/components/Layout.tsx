import { type ReactNode, useState, useCallback } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { cn } from '../lib/cn';
import { useAuth } from '../lib/auth';
import { useBranding } from './ThemeProvider';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const navigation: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '\u25A0' },
  { to: '/customers', label: 'Customers', icon: '\u25CF' },
  { to: '/interactions', label: 'Interactions', icon: '\u25AC' },
  { to: '/agents', label: 'Agent Activity', icon: '\u25B2' },
  { to: '/analytics', label: 'Analytics', icon: '\u25A3' },
  { to: '/compliance', label: 'Compliance', icon: '\u25C6' },
  { to: '/marketplace', label: 'Marketplace', icon: '\u25E8' },
  { to: '/developer', label: 'Developer', icon: '\u2318' },
  { to: '/healthcare', label: 'Healthcare', icon: '\u2695' },
  { to: '/partner', label: 'Partner', icon: '\u2764' },
  { to: '/notifications', label: 'Notifications', icon: '\u25D4' },
  { to: '/settings', label: 'Settings', icon: '\u2699' },
];

export function Layout(): ReactNode {
  const { user, logout } = useAuth();
  const { brand } = useBranding();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = useCallback(() => {
    logout();
    navigate('/login');
  }, [logout, navigate]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-surface-secondary',
          'transition-transform duration-200 ease-in-out',
          'lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          {brand.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt="Logo"
              className="h-8 w-8 rounded-lg object-contain"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-accent text-sm font-bold text-white">
              O
            </div>
          )}
          <div>
            <h1 className="text-sm font-bold text-content">
              {brand.footerText ? brand.footerText.split('|')[0]?.trim() || 'ORDR-Connect' : 'ORDR-Connect'}
            </h1>
            <p className="text-2xs text-content-tertiary">Customer Operations OS</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" role="navigation">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={closeSidebar}
              className={({ isActive }) => cn('nav-link', isActive && 'nav-link-active')}
            >
              <span className="flex h-5 w-5 items-center justify-center text-xs" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Compliance status */}
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-content-secondary">Compliance: Active</span>
          </div>
          <p className="mt-1 text-2xs text-content-tertiary">SOC2 / ISO27001 / HIPAA</p>
        </div>

        {/* User section */}
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-tertiary text-xs font-medium text-content"
              aria-hidden="true"
            >
              {user?.name
                .split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2) || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-content">{user?.name || 'User'}</p>
              <p className="truncate text-2xs text-content-tertiary">{user?.role || 'Operator'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg p-1.5 text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content"
              aria-label="Sign out"
              title="Sign out"
            >
              <span className="text-sm" aria-hidden="true">{'\u2192'}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 items-center justify-between border-b border-border bg-surface-secondary px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              className="rounded-lg p-2 text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content lg:hidden"
              aria-label="Toggle navigation"
            >
              <span className="text-lg" aria-hidden="true">{'\u2630'}</span>
            </button>
            <div className="hidden lg:block">
              <p className="text-sm text-content-secondary">
                Tenant: <span className="font-medium text-content">{user?.tenantId || 'default'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs font-medium text-emerald-400">Compliant</span>
            </div>
            <button
              onClick={() => { closeSidebar(); navigate('/notifications'); }}
              className="relative rounded-lg p-2 text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content"
              aria-label="Notifications"
              title="Notifications"
            >
              <span className="text-base" aria-hidden="true">{'\u25D4'}</span>
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
                3
              </span>
            </button>
            <button
              onClick={handleLogout}
              className="hidden rounded-lg px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-tertiary hover:text-content lg:block"
            >
              Sign Out
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
