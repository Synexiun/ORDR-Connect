/**
 * useKeyboardShortcuts — Global keyboard shortcut handler.
 *
 * Built-in shortcuts:
 * - Ctrl+K / Cmd+K: Command palette toggle
 * - Ctrl+B / Cmd+B: Sidebar toggle
 * - Escape: Close modals / dismiss
 *
 * SECURITY:
 * - No secrets or PHI in shortcut handlers (Rule 5, Rule 6)
 * - Shortcuts are disabled when user is typing in input/textarea (prevents interference)
 */

import { useEffect, useCallback, useRef } from 'react';

// ─── Types ───────────────────────────────────────────────────

interface ShortcutConfig {
  /** Key combination, e.g. "ctrl+k", "escape", "ctrl+shift+p" */
  key: string;
  /** Handler to invoke when shortcut is triggered */
  handler: () => void;
  /** Whether the shortcut should work inside input/textarea. Default: false */
  allowInInput?: boolean;
  /** Description for accessibility / command palette listing */
  description?: string;
}

type ShortcutMap = Record<string, ShortcutConfig>;

// ─── Helpers ─────────────────────────────────────────────────

function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable
  );
}

function normalizeKey(event: KeyboardEvent): string {
  const parts: string[] = [];

  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');

  const key = event.key.toLowerCase();
  if (!['control', 'meta', 'shift', 'alt'].includes(key)) {
    parts.push(key === ' ' ? 'space' : key);
  }

  return parts.join('+');
}

// ─── Hook ────────────────────────────────────────────────────

export function useKeyboardShortcuts(shortcuts: ShortcutMap): void {
  // Keep a ref to avoid re-attaching listener on every shortcuts change
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const normalized = normalizeKey(event);
    const config = shortcutsRef.current[normalized];

    if (!config) return;

    // Skip if user is typing and shortcut doesn't allow input context
    if (config.allowInInput !== true && isInputElement(event.target)) return;

    event.preventDefault();
    event.stopPropagation();
    config.handler();
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}

// ─── Preset Shortcut Builders ────────────────────────────────

/**
 * Create the standard ORDR-Connect shortcut map.
 * Caller provides the actual toggle/close handlers.
 */
export function createDefaultShortcuts(handlers: {
  onCommandPalette?: () => void;
  onSidebarToggle?: () => void;
  onEscape?: () => void;
}): ShortcutMap {
  const map: ShortcutMap = {};

  if (handlers.onCommandPalette) {
    map['ctrl+k'] = {
      key: 'ctrl+k',
      handler: handlers.onCommandPalette,
      description: 'Toggle command palette',
    };
  }

  if (handlers.onSidebarToggle) {
    map['ctrl+b'] = {
      key: 'ctrl+b',
      handler: handlers.onSidebarToggle,
      description: 'Toggle sidebar',
    };
  }

  if (handlers.onEscape) {
    map['escape'] = {
      key: 'escape',
      handler: handlers.onEscape,
      allowInInput: true,
      description: 'Close modal / dismiss',
    };
  }

  return map;
}
