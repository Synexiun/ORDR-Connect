/**
 * Layout — Thin shell composing Sidebar + TopBar + main content area.
 *
 * Sidebar collapsed state is persisted to localStorage for UX continuity.
 * Keyboard shortcuts: Ctrl+B toggles sidebar, Escape closes mobile overlay.
 *
 * SECURITY:
 * - No PHI/PII persisted to localStorage — only UI preference (collapsed boolean) (Rule 6)
 * - Token remains in-memory only (Rule 2 — HIPAA §164.312)
 */

import { type ReactNode, useState, useCallback, useMemo } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '../lib/cn';
import { Sidebar } from './layout/Sidebar';
import { TopBar } from './layout/TopBar';
import { useKeyboardShortcuts, createDefaultShortcuts } from '../hooks/useKeyboardShortcuts';

// ─── LocalStorage Key ────────────────────────────────────────

const SIDEBAR_COLLAPSED_KEY = 'ordr.sidebar.collapsed';

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

// ─── Layout Component ────────────────────────────────────────

export function Layout(): ReactNode {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Non-critical — silent fallback (Rule 7)
      }
      return next;
    });
  }, []);

  const toggleMobile = useCallback(() => {
    setMobileOpen((prev) => !prev);
  }, []);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  // ─── Keyboard Shortcuts ──────────────────────────────────
  const shortcuts = useMemo(
    () =>
      createDefaultShortcuts({
        onSidebarToggle: toggleCollapsed,
        onEscape: closeMobile,
      }),
    [toggleCollapsed, closeMobile],
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <Sidebar
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        mobileOpen={mobileOpen}
        onMobileClose={closeMobile}
      />

      {/* Main area */}
      <div className={cn('flex flex-1 flex-col overflow-hidden')}>
        <TopBar onMenuToggle={toggleMobile} />

        <main className="flex-1 overflow-y-auto bg-canvas p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
