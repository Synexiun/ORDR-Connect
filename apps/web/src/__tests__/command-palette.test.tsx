/**
 * CommandPalette + useCommandPalette Tests
 *
 * Validates:
 * - Static navigation commands are built from NAV_ENTRIES
 * - onQueryChange debounces and calls searchApi.suggest
 * - Short queries (<2 chars) clear async results without API call
 * - Search results are mapped to Commands with correct navigate targets
 * - Search errors are silently swallowed (Rule 7)
 * - CommandPalette renders null when closed
 * - CommandPalette opens on Ctrl+K and closes on Escape
 * - Keyboard navigation (ArrowDown/ArrowUp/Enter) works correctly
 * - Backdrop click closes the palette
 *
 * SECURITY:
 * - No PHI in test fixtures (Rule 6)
 * - Search queries are opaque strings — no sensitive data (HIPAA §164.312)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// jsdom does not implement scrollIntoView — stub it globally
Element.prototype.scrollIntoView = vi.fn();

// ─── Mocks ────────────────────────────────────────────────────────

const { mockNavigate, mockSuggest } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockSuggest: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../lib/search-api', () => ({
  searchApi: {
    suggest: mockSuggest,
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────

import { useCommandPalette } from '../hooks/useCommandPalette';
import { CommandPalette } from '../components/ui/CommandPalette';

// ─── Helpers ──────────────────────────────────────────────────────

function renderPaletteInRouter(
  props: React.ComponentProps<typeof CommandPalette>,
): ReturnType<typeof render> {
  return render(createElement(MemoryRouter, {}, createElement(CommandPalette, props)));
}

// ─── Setup / Teardown ─────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════
// useCommandPalette — Static commands
// ═══════════════════════════════════════════════════════════════════

describe('useCommandPalette — static commands', () => {
  function renderCmd(): ReturnType<
    typeof renderHook<ReturnType<typeof useCommandPalette>, unknown>
  > {
    return renderHook(() => useCommandPalette(), {
      wrapper: ({ children }) => createElement(MemoryRouter, {}, children),
    });
  }

  it('returns a non-empty commands array', () => {
    const { result } = renderCmd();
    expect(result.current.commands.length).toBeGreaterThan(0);
  });

  it('includes a Dashboard command', () => {
    const { result } = renderCmd();
    const cmd = result.current.commands.find((c) => c.label === 'Dashboard');
    expect(cmd).toBeDefined();
  });

  it('includes a Customers command', () => {
    const { result } = renderCmd();
    const cmd = result.current.commands.find((c) => c.label === 'Customers');
    expect(cmd).toBeDefined();
  });

  it('includes a Tickets command', () => {
    const { result } = renderCmd();
    const cmd = result.current.commands.find((c) => c.label === 'Tickets');
    expect(cmd).toBeDefined();
  });

  it('all commands have group "Navigate"', () => {
    const { result } = renderCmd();
    const nonNav = result.current.commands.filter((c) => c.group !== 'Navigate');
    expect(nonNav).toHaveLength(0);
  });

  it('all commands have unique ids', () => {
    const { result } = renderCmd();
    const ids = result.current.commands.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('executing a Dashboard command calls navigate("/dashboard")', () => {
    const { result } = renderCmd();
    const cmd = result.current.commands.find((c) => c.label === 'Dashboard');
    act(() => {
      cmd?.action();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('executing a Customers command calls navigate("/customers")', () => {
    const { result } = renderCmd();
    const cmd = result.current.commands.find((c) => c.label === 'Customers');
    act(() => {
      cmd?.action();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/customers');
  });

  it('asyncResults starts empty', () => {
    const { result } = renderCmd();
    expect(result.current.asyncResults).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// useCommandPalette — onQueryChange / debounce
// ═══════════════════════════════════════════════════════════════════

describe('useCommandPalette — onQueryChange', () => {
  function renderCmd(): ReturnType<
    typeof renderHook<ReturnType<typeof useCommandPalette>, unknown>
  > {
    return renderHook(() => useCommandPalette(), {
      wrapper: ({ children }) => createElement(MemoryRouter, {}, children),
    });
  }

  it('does not call suggest for query shorter than 2 chars', () => {
    const { result } = renderCmd();
    act(() => {
      result.current.onQueryChange('a');
    });
    vi.runAllTimers();
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it('does not call suggest for empty query', () => {
    const { result } = renderCmd();
    act(() => {
      result.current.onQueryChange('');
    });
    vi.runAllTimers();
    expect(mockSuggest).not.toHaveBeenCalled();
  });

  it('clears asyncResults for short queries', () => {
    mockSuggest.mockResolvedValue([{ id: 's1', label: 'Acme', entityType: 'contact' }]);
    const { result } = renderCmd();

    // First trigger a successful search
    act(() => {
      result.current.onQueryChange('ac');
    });
    vi.runAllTimers();

    // Now type a single char — results should clear
    act(() => {
      result.current.onQueryChange('a');
    });
    expect(result.current.asyncResults).toHaveLength(0);
  });

  it('calls suggest after debounce (200ms) for query >= 2 chars', async () => {
    mockSuggest.mockResolvedValue([]);
    const { result } = renderCmd();

    act(() => {
      result.current.onQueryChange('ac');
    });
    // Not called yet
    expect(mockSuggest).not.toHaveBeenCalled();

    // Advance timers past debounce
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mockSuggest).toHaveBeenCalledWith('ac');
  });

  it('maps suggestions to async commands with group "Search Results"', async () => {
    mockSuggest.mockResolvedValue([
      { id: 'r1', label: 'Acme Corp', entityType: 'contact', entityId: 'cust-1' },
    ]);
    const { result } = renderCmd();

    await act(async () => {
      result.current.onQueryChange('acme');
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(result.current.asyncResults).toHaveLength(1);
    expect(result.current.asyncResults[0]?.label).toBe('Acme Corp');
    expect(result.current.asyncResults[0]?.group).toBe('Search Results');
  });

  it('navigates to /customers/:id when a contact result is executed', async () => {
    mockSuggest.mockResolvedValue([
      { id: 'r1', label: 'Acme Corp', entityType: 'contact', entityId: 'cust-abc' },
    ]);
    const { result } = renderCmd();

    await act(async () => {
      result.current.onQueryChange('acme');
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    act(() => {
      result.current.asyncResults[0]?.action();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/customers/cust-abc');
  });

  it('navigates to /tickets/:id when a ticket result is executed', async () => {
    mockSuggest.mockResolvedValue([
      { id: 'r2', label: 'Login broken', entityType: 'ticket', entityId: 'tkt-99' },
    ]);
    const { result } = renderCmd();

    await act(async () => {
      result.current.onQueryChange('logi');
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    act(() => {
      result.current.asyncResults[0]?.action();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/tickets/tkt-99');
  });

  it('navigates to /search for unknown entity types', async () => {
    mockSuggest.mockResolvedValue([
      { id: 'r3', label: 'Something', entityType: 'deal', entityId: 'deal-1' },
    ]);
    const { result } = renderCmd();

    await act(async () => {
      result.current.onQueryChange('some');
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    act(() => {
      result.current.asyncResults[0]?.action();
    });
    expect(mockNavigate).toHaveBeenCalledWith('/search');
  });

  it('silently clears asyncResults on search error (Rule 7)', async () => {
    mockSuggest.mockRejectedValue(new Error('network'));
    const { result } = renderCmd();

    await act(async () => {
      result.current.onQueryChange('fail');
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(result.current.asyncResults).toHaveLength(0);
  });

  it('debounces rapid input — only final query triggers suggest', async () => {
    mockSuggest.mockResolvedValue([]);
    const { result } = renderCmd();

    act(() => {
      result.current.onQueryChange('ac');
    });
    act(() => {
      result.current.onQueryChange('acm');
    });
    act(() => {
      result.current.onQueryChange('acme');
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    // Only called once — with the final value
    expect(mockSuggest).toHaveBeenCalledOnce();
    expect(mockSuggest).toHaveBeenCalledWith('acme');
  });
});

// ═══════════════════════════════════════════════════════════════════
// CommandPalette component
// ═══════════════════════════════════════════════════════════════════

describe('CommandPalette — closed state', () => {
  it('renders null when closed', () => {
    const { container } = renderPaletteInRouter({ commands: [] });
    expect(container.firstChild).toBeNull();
  });
});

describe('CommandPalette — open via Ctrl+K', () => {
  it('opens on Ctrl+K', () => {
    renderPaletteInRouter({ commands: [] });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeDefined();
  });

  it('opens on Meta+K', () => {
    renderPaletteInRouter({ commands: [] });
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeDefined();
  });

  it('closes on Escape', () => {
    renderPaletteInRouter({ commands: [] });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeDefined();
    fireEvent.keyDown(screen.getByLabelText('Search commands'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('shows search input when open', () => {
    renderPaletteInRouter({ commands: [] });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByLabelText('Search commands')).toBeDefined();
  });

  it('shows "No results found" when commands list is empty', () => {
    renderPaletteInRouter({ commands: [] });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByText('No results found')).toBeDefined();
  });
});

describe('CommandPalette — command rendering', () => {
  const commands = [
    { id: 'nav-/dashboard', label: 'Dashboard', group: 'Navigate', action: vi.fn() },
    { id: 'nav-/customers', label: 'Customers', group: 'Navigate', action: vi.fn() },
  ];

  it('renders command labels', () => {
    renderPaletteInRouter({ commands });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Customers')).toBeDefined();
  });

  it('renders group header', () => {
    renderPaletteInRouter({ commands });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.getByText('Navigate')).toBeDefined();
  });

  it('filters commands by label', () => {
    renderPaletteInRouter({ commands });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByLabelText('Search commands'), {
      target: { value: 'cust' },
    });
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.getByText('Customers')).toBeDefined();
  });

  it('calls command action and closes on click', () => {
    const action = vi.fn();
    renderPaletteInRouter({
      commands: [{ id: 'nav-/test', label: 'Test Page', group: 'Navigate', action }],
    });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.click(screen.getByText('Test Page'));
    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });

  it('closes on backdrop click', () => {
    renderPaletteInRouter({ commands });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  });
});

describe('CommandPalette — async results', () => {
  it('renders async result commands below static commands', () => {
    const commands = [
      { id: 'nav-/dashboard', label: 'Dashboard', group: 'Navigate', action: vi.fn() },
    ];
    const asyncResults = [
      { id: 'search-r1', label: 'Acme Corp', group: 'Search Results', action: vi.fn() },
    ];
    renderPaletteInRouter({ commands, asyncResults });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    // Type something so filter passes asyncResults through
    fireEvent.change(screen.getByLabelText('Search commands'), {
      target: { value: 'ac' },
    });
    expect(screen.getByText('Acme Corp')).toBeDefined();
    expect(screen.getByText('Search Results')).toBeDefined();
  });

  it('calls onQueryChange when user types', () => {
    const onQueryChange = vi.fn();
    renderPaletteInRouter({ commands: [], onQueryChange });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByLabelText('Search commands'), {
      target: { value: 'hello' },
    });
    expect(onQueryChange).toHaveBeenCalledWith('hello');
  });
});

describe('CommandPalette — keyboard navigation', () => {
  const action1 = vi.fn();
  const action2 = vi.fn();
  const commands = [
    { id: 'nav-/a', label: 'Alpha', group: 'Navigate', action: action1 },
    { id: 'nav-/b', label: 'Beta', group: 'Navigate', action: action2 },
  ];

  beforeEach(() => {
    action1.mockClear();
    action2.mockClear();
  });

  it('pressing Enter executes the focused command', () => {
    renderPaletteInRouter({ commands });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = screen.getByLabelText('Search commands');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(action1).toHaveBeenCalledOnce();
  });

  it('ArrowDown moves focus to next item, Enter executes it', () => {
    renderPaletteInRouter({ commands });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = screen.getByLabelText('Search commands');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(action2).toHaveBeenCalledOnce();
    expect(action1).not.toHaveBeenCalled();
  });
});
