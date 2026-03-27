/**
 * Design System — Phase 3 UI Component Tests
 *
 * Validates:
 * - Select renders options, handles change, shows error/placeholder
 * - Toggle renders switch, toggles checked state, supports disabled
 * - Tabs renders tab buttons, handles activeTab change, pill variant
 * - TabPanel shows/hides content based on activeTab
 * - Textarea renders with label, error, maxLength counter
 * - Avatar renders initials, handles image error fallback, status dot
 * - Breadcrumb renders items with links and current page
 * - EmptyState renders icon, title, description, optional action button
 * - Tooltip renders children, shows tooltip content on hover
 * - Skeleton renders loading placeholders for text, circle, card, table-row
 * - StatusDot renders correct status variant with optional pulse
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Select } from '../components/ui/Select';
import { Toggle } from '../components/ui/Toggle';
import { Tabs, TabPanel } from '../components/ui/Tabs';
import { Textarea } from '../components/ui/Textarea';
import { Avatar } from '../components/ui/Avatar';
import { Breadcrumb } from '../components/ui/Breadcrumb';
import { EmptyState } from '../components/ui/EmptyState';
import { Tooltip } from '../components/ui/Tooltip';
import { Skeleton } from '../components/ui/Skeleton';
import { StatusDot } from '../components/ui/StatusDot';

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Select ──────────────────────────────────────────────────────

describe('Select component', () => {
  const defaultOptions = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
  ];

  it('renders all options', () => {
    const onChange = vi.fn();
    render(
      createElement(Select, {
        options: defaultOptions,
        value: 'a',
        onChange,
      }),
    );

    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.querySelectorAll('option').length).toBe(3);
  });

  it('renders label when provided', () => {
    const onChange = vi.fn();
    render(
      createElement(Select, {
        label: 'Pick one',
        options: defaultOptions,
        value: 'a',
        onChange,
      }),
    );

    expect(screen.getByText('Pick one')).toBeDefined();
    const label = screen.getByText('Pick one');
    expect(label.tagName).toBe('LABEL');
  });

  it('calls onChange when selection changes', () => {
    const onChange = vi.fn();
    render(
      createElement(Select, {
        options: defaultOptions,
        value: 'a',
        onChange,
      }),
    );

    const select = document.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('renders placeholder as disabled option', () => {
    const onChange = vi.fn();
    render(
      createElement(Select, {
        options: defaultOptions,
        value: '',
        onChange,
        placeholder: 'Choose...',
      }),
    );

    const placeholderOpt = screen.getByText('Choose...');
    expect(placeholderOpt.hasAttribute('disabled')).toBe(true);
  });

  it('displays error message with role=alert', () => {
    const onChange = vi.fn();
    render(
      createElement(Select, {
        label: 'Region',
        options: defaultOptions,
        value: 'a',
        onChange,
        error: 'Required field',
      }),
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Required field');
  });

  it('sets aria-invalid when error present', () => {
    const onChange = vi.fn();
    render(
      createElement(Select, {
        options: defaultOptions,
        value: 'a',
        onChange,
        error: 'Bad',
      }),
    );

    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select.getAttribute('aria-invalid')).toBe('true');
  });

  it('disables select when disabled prop is true', () => {
    const onChange = vi.fn();
    render(
      createElement(Select, {
        options: defaultOptions,
        value: 'a',
        onChange,
        disabled: true,
      }),
    );

    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('renders selected value correctly', () => {
    const onChange = vi.fn();
    render(
      createElement(Select, {
        options: defaultOptions,
        value: 'b',
        onChange,
      }),
    );

    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('b');
  });
});

// ─── Toggle ──────────────────────────────────────────────────────

describe('Toggle component', () => {
  it('renders switch role', () => {
    const onChange = vi.fn();
    render(createElement(Toggle, { checked: false, onChange }));

    const switchEl = screen.getByRole('switch');
    expect(switchEl).toBeDefined();
  });

  it('shows aria-checked=false when unchecked', () => {
    const onChange = vi.fn();
    render(createElement(Toggle, { checked: false, onChange }));

    const switchEl = screen.getByRole('switch');
    expect(switchEl.getAttribute('aria-checked')).toBe('false');
  });

  it('shows aria-checked=true when checked', () => {
    const onChange = vi.fn();
    render(createElement(Toggle, { checked: true, onChange }));

    const switchEl = screen.getByRole('switch');
    expect(switchEl.getAttribute('aria-checked')).toBe('true');
  });

  it('calls onChange with toggled value on click', () => {
    const onChange = vi.fn();
    render(createElement(Toggle, { checked: false, onChange }));

    const switchEl = screen.getByRole('switch');
    fireEvent.click(switchEl);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange with false when already checked', () => {
    const onChange = vi.fn();
    render(createElement(Toggle, { checked: true, onChange }));

    const switchEl = screen.getByRole('switch');
    fireEvent.click(switchEl);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('renders label text', () => {
    const onChange = vi.fn();
    render(createElement(Toggle, { checked: false, onChange, label: 'Dark mode' }));

    expect(screen.getByText('Dark mode')).toBeDefined();
  });

  it('sets aria-label from label prop', () => {
    const onChange = vi.fn();
    render(createElement(Toggle, { checked: false, onChange, label: 'Notifications' }));

    const switchEl = screen.getByRole('switch');
    expect(switchEl.getAttribute('aria-label')).toBe('Notifications');
  });

  it('disables the button when disabled', () => {
    const onChange = vi.fn();
    render(createElement(Toggle, { checked: false, onChange, disabled: true }));

    const switchEl = screen.getByRole('switch');
    expect(switchEl.hasAttribute('disabled')).toBe(true);
  });

  it('does not call onChange when disabled and clicked', () => {
    const onChange = vi.fn();
    render(createElement(Toggle, { checked: false, onChange, disabled: true }));

    const switchEl = screen.getByRole('switch');
    fireEvent.click(switchEl);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports sm size', () => {
    const onChange = vi.fn();
    render(createElement(Toggle, { checked: true, onChange, size: 'sm' }));

    const switchEl = screen.getByRole('switch');
    expect(switchEl).toBeDefined();
  });
});

// ─── Tabs ────────────────────────────────────────────────────────

describe('Tabs component', () => {
  const tabDefs = [
    { id: 'overview', label: 'Overview' },
    { id: 'details', label: 'Details' },
    { id: 'history', label: 'History' },
  ];

  it('renders all tab buttons', () => {
    const onChange = vi.fn();
    render(createElement(Tabs, { tabs: tabDefs, activeTab: 'overview', onChange }));

    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(3);
  });

  it('sets aria-selected=true on active tab', () => {
    const onChange = vi.fn();
    render(createElement(Tabs, { tabs: tabDefs, activeTab: 'details', onChange }));

    const tabs = screen.getAllByRole('tab');
    const detailsTab = tabs.find((t) => t.textContent === 'Details');
    expect(detailsTab?.getAttribute('aria-selected')).toBe('true');
  });

  it('sets aria-selected=false on inactive tabs', () => {
    const onChange = vi.fn();
    render(createElement(Tabs, { tabs: tabDefs, activeTab: 'overview', onChange }));

    const tabs = screen.getAllByRole('tab');
    const detailsTab = tabs.find((t) => t.textContent === 'Details');
    expect(detailsTab?.getAttribute('aria-selected')).toBe('false');
  });

  it('calls onChange with tab id on click', () => {
    const onChange = vi.fn();
    render(createElement(Tabs, { tabs: tabDefs, activeTab: 'overview', onChange }));

    const historyTab = screen.getByText('History');
    fireEvent.click(historyTab);
    expect(onChange).toHaveBeenCalledWith('history');
  });

  it('renders tablist role', () => {
    const onChange = vi.fn();
    render(createElement(Tabs, { tabs: tabDefs, activeTab: 'overview', onChange }));

    expect(screen.getByRole('tablist')).toBeDefined();
  });

  it('sets correct aria-controls on each tab', () => {
    const onChange = vi.fn();
    render(createElement(Tabs, { tabs: tabDefs, activeTab: 'overview', onChange }));

    const overviewTab = screen.getByText('Overview');
    expect(overviewTab.getAttribute('aria-controls')).toBe('panel-overview');
  });

  it('sets tabIndex=0 on active, -1 on inactive', () => {
    const onChange = vi.fn();
    render(createElement(Tabs, { tabs: tabDefs, activeTab: 'overview', onChange }));

    const tabs = screen.getAllByRole('tab');
    const overviewTab = tabs.find((t) => t.textContent === 'Overview') as HTMLElement;
    const detailsTab = tabs.find((t) => t.textContent === 'Details') as HTMLElement;
    expect(overviewTab.tabIndex).toBe(0);
    expect(detailsTab.tabIndex).toBe(-1);
  });

  it('supports pill variant', () => {
    const onChange = vi.fn();
    render(
      createElement(Tabs, {
        tabs: tabDefs,
        activeTab: 'overview',
        onChange,
        variant: 'pill',
      }),
    );

    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeDefined();
  });

  it('renders tab icons when provided', () => {
    const tabsWithIcons = [
      { id: 'home', label: 'Home', icon: createElement('span', { 'data-testid': 'icon-home' }) },
    ];
    const onChange = vi.fn();
    render(createElement(Tabs, { tabs: tabsWithIcons, activeTab: 'home', onChange }));

    expect(screen.getByTestId('icon-home')).toBeDefined();
  });
});

describe('TabPanel component', () => {
  it('renders children when id matches activeTab', () => {
    render(
      createElement(
        TabPanel,
        { id: 'overview', activeTab: 'overview' },
        createElement('p', null, 'Panel content'),
      ),
    );

    expect(screen.getByText('Panel content')).toBeDefined();
  });

  it('does not render when id does not match activeTab', () => {
    render(
      createElement(
        TabPanel,
        { id: 'details', activeTab: 'overview' },
        createElement('p', null, 'Hidden content'),
      ),
    );

    expect(screen.queryByText('Hidden content')).toBeNull();
  });

  it('sets tabpanel role', () => {
    render(
      createElement(
        TabPanel,
        { id: 'overview', activeTab: 'overview' },
        createElement('p', null, 'Content'),
      ),
    );

    expect(screen.getByRole('tabpanel')).toBeDefined();
  });

  it('sets aria-labelledby pointing to tab', () => {
    render(
      createElement(
        TabPanel,
        { id: 'overview', activeTab: 'overview' },
        createElement('p', null, 'Content'),
      ),
    );

    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe('tab-overview');
  });
});

// ─── Textarea ────────────────────────────────────────────────────

describe('Textarea component', () => {
  it('renders textarea element', () => {
    render(createElement(Textarea, { value: '', onChange: vi.fn() }));

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
  });

  it('renders label when provided', () => {
    render(createElement(Textarea, { label: 'Notes', value: '', onChange: vi.fn() }));

    expect(screen.getByText('Notes')).toBeDefined();
  });

  it('associates label with textarea via htmlFor', () => {
    render(createElement(Textarea, { label: 'Notes', value: '', onChange: vi.fn() }));

    const label = screen.getByText('Notes');
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(label.getAttribute('for')).toBe(textarea.id);
  });

  it('displays error message with role=alert', () => {
    render(
      createElement(Textarea, {
        label: 'Bio',
        value: '',
        onChange: vi.fn(),
        error: 'Too short',
      }),
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Too short');
  });

  it('sets aria-invalid when error present', () => {
    render(
      createElement(Textarea, {
        value: '',
        onChange: vi.fn(),
        error: 'Bad',
      }),
    );

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows character count when maxLength given', () => {
    render(
      createElement(Textarea, {
        value: 'Hello',
        onChange: vi.fn(),
        maxLength: 100,
      }),
    );

    expect(screen.getByText('5/100')).toBeDefined();
  });

  it('shows 0/maxLength for empty value', () => {
    render(
      createElement(Textarea, {
        value: '',
        onChange: vi.fn(),
        maxLength: 50,
      }),
    );

    expect(screen.getByText('0/50')).toBeDefined();
  });

  it('sets maxLength attribute on textarea', () => {
    render(
      createElement(Textarea, {
        value: '',
        onChange: vi.fn(),
        maxLength: 200,
      }),
    );

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(200);
  });

  it('supports placeholder prop', () => {
    render(
      createElement(Textarea, {
        value: '',
        onChange: vi.fn(),
        placeholder: 'Type here...',
      }),
    );

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe('Type here...');
  });

  it('disables textarea when disabled', () => {
    render(
      createElement(Textarea, {
        value: '',
        onChange: vi.fn(),
        disabled: true,
      }),
    );

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });
});

// ─── Avatar ──────────────────────────────────────────────────────

describe('Avatar component', () => {
  it('renders initials when no src provided', () => {
    render(createElement(Avatar, { name: 'John Doe' }));

    expect(screen.getByText('JD')).toBeDefined();
  });

  it('renders two-letter initials for single name', () => {
    render(createElement(Avatar, { name: 'Alice' }));

    expect(screen.getByText('AL')).toBeDefined();
  });

  it('renders first+last initials for multi-word name', () => {
    render(createElement(Avatar, { name: 'Jane Marie Smith' }));

    // first[0] + second[0] = JM
    expect(screen.getByText('JM')).toBeDefined();
  });

  it('sets aria-label to name', () => {
    render(createElement(Avatar, { name: 'Bob Marley' }));

    expect(screen.getByLabelText('Bob Marley')).toBeDefined();
  });

  it('renders image when src provided', () => {
    render(createElement(Avatar, { name: 'Test', src: 'https://example.com/photo.jpg' }));

    const img = document.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe('https://example.com/photo.jpg');
    expect(img.alt).toBe('Test');
  });

  it('falls back to initials on image error', () => {
    render(createElement(Avatar, { name: 'Test User', src: 'https://broken.url/nope.jpg' }));

    const img = document.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);

    expect(screen.getByText('TU')).toBeDefined();
  });

  it('renders status indicator when status provided', () => {
    render(createElement(Avatar, { name: 'User', status: 'online' }));

    expect(screen.getByLabelText('online')).toBeDefined();
  });

  it('does not render status indicator when status omitted', () => {
    render(createElement(Avatar, { name: 'User' }));

    expect(screen.queryByLabelText('online')).toBeNull();
    expect(screen.queryByLabelText('offline')).toBeNull();
  });

  it('supports all status variants', () => {
    const statuses = ['online', 'offline', 'busy', 'away'] as const;
    statuses.forEach((status) => {
      const { unmount } = render(createElement(Avatar, { name: 'U', status }));
      expect(screen.getByLabelText(status)).toBeDefined();
      unmount();
    });
  });

  it('supports size prop', () => {
    render(createElement(Avatar, { name: 'User', size: 'lg' }));
    expect(screen.getByLabelText('User')).toBeDefined();
  });
});

// ─── Breadcrumb ──────────────────────────────────────────────────

describe('Breadcrumb component', () => {
  it('renders all items', () => {
    const items = [
      { label: 'Home', href: '/' },
      { label: 'Settings', href: '/settings' },
      { label: 'Profile' },
    ];
    render(createElement(Breadcrumb, { items }));

    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.getByText('Profile')).toBeDefined();
  });

  it('renders nav with aria-label Breadcrumb', () => {
    const items = [{ label: 'Home', href: '/' }, { label: 'Page' }];
    render(createElement(Breadcrumb, { items }));

    const nav = screen.getByRole('navigation');
    expect(nav.getAttribute('aria-label')).toBe('Breadcrumb');
  });

  it('renders links for non-last items with href', () => {
    const items = [{ label: 'Home', href: '/' }, { label: 'Current' }];
    render(createElement(Breadcrumb, { items }));

    const link = screen.getByText('Home');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/');
  });

  it('renders last item as span with aria-current=page', () => {
    const items = [{ label: 'Home', href: '/' }, { label: 'Current Page' }];
    render(createElement(Breadcrumb, { items }));

    const current = screen.getByText('Current Page');
    expect(current.tagName).toBe('SPAN');
    expect(current.getAttribute('aria-current')).toBe('page');
  });

  it('renders span (not link) for non-last item without href', () => {
    const items = [{ label: 'Section' }, { label: 'Page' }];
    render(createElement(Breadcrumb, { items }));

    const section = screen.getByText('Section');
    expect(section.tagName).toBe('SPAN');
  });

  it('renders single item as current page', () => {
    const items = [{ label: 'Dashboard' }];
    render(createElement(Breadcrumb, { items }));

    const el = screen.getByText('Dashboard');
    expect(el.getAttribute('aria-current')).toBe('page');
  });
});

// ─── EmptyState ──────────────────────────────────────────────────

describe('EmptyState component', () => {
  it('renders title and description', () => {
    render(
      createElement(EmptyState, {
        icon: createElement('span', null, 'ICON'),
        title: 'No results',
        description: 'Try a different search.',
      }),
    );

    expect(screen.getByText('No results')).toBeDefined();
    expect(screen.getByText('Try a different search.')).toBeDefined();
  });

  it('renders icon', () => {
    render(
      createElement(EmptyState, {
        icon: createElement('span', { 'data-testid': 'empty-icon' }, 'IC'),
        title: 'Empty',
        description: 'Nothing here.',
      }),
    );

    expect(screen.getByTestId('empty-icon')).toBeDefined();
  });

  it('renders action button when action provided', () => {
    const onClick = vi.fn();
    render(
      createElement(EmptyState, {
        icon: createElement('span', null, 'IC'),
        title: 'No data',
        description: 'Create your first item.',
        action: { label: 'Create Item', onClick },
      }),
    );

    const button = screen.getByText('Create Item');
    expect(button).toBeDefined();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render button when action is omitted', () => {
    render(
      createElement(EmptyState, {
        icon: createElement('span', null, 'IC'),
        title: 'Nothing',
        description: 'Empty state.',
      }),
    );

    expect(screen.queryByRole('button')).toBeNull();
  });
});

// ─── Tooltip ─────────────────────────────────────────────────────

describe('Tooltip component', () => {
  it('renders children', () => {
    render(
      createElement(Tooltip, { content: 'Hint text' }, createElement('button', null, 'Hover me')),
    );

    expect(screen.getByText('Hover me')).toBeDefined();
  });

  it('does not show tooltip content initially', () => {
    render(
      createElement(Tooltip, { content: 'Hint text' }, createElement('button', null, 'Hover me')),
    );

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows tooltip on mouse enter after delay', () => {
    vi.useFakeTimers();
    render(
      createElement(Tooltip, { content: 'Tip content' }, createElement('button', null, 'Target')),
    );

    const wrapper = screen.getByText('Target').parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);

    // Advance past the 200ms delay inside act to flush React state
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByRole('tooltip')).toBeDefined();
    expect(screen.getByRole('tooltip').textContent).toContain('Tip content');

    vi.useRealTimers();
  });

  it('hides tooltip on mouse leave', () => {
    vi.useFakeTimers();
    render(createElement(Tooltip, { content: 'Tip' }, createElement('button', null, 'Btn')));

    const wrapper = screen.getByText('Btn').parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByRole('tooltip')).toBeDefined();

    fireEvent.mouseLeave(wrapper);

    expect(screen.queryByRole('tooltip')).toBeNull();

    vi.useRealTimers();
  });

  it('shows tooltip on focus', () => {
    vi.useFakeTimers();
    render(
      createElement(Tooltip, { content: 'Focus tip' }, createElement('button', null, 'Focusable')),
    );

    const wrapper = screen.getByText('Focusable').parentElement as HTMLElement;
    fireEvent.focus(wrapper);
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByRole('tooltip')).toBeDefined();

    vi.useRealTimers();
  });
});

// ─── Skeleton ────────────────────────────────────────────────────

describe('Skeleton component', () => {
  it('renders with status role and Loading label', () => {
    render(createElement(Skeleton));

    const status = screen.getByRole('status');
    expect(status).toBeDefined();
    expect(status.getAttribute('aria-label')).toBe('Loading');
  });

  it('renders sr-only Loading text', () => {
    render(createElement(Skeleton));

    expect(screen.getByText('Loading')).toBeDefined();
  });

  it('renders single item by default', () => {
    render(createElement(Skeleton));

    const items = document.querySelectorAll('[aria-hidden="true"]');
    expect(items.length).toBe(1);
  });

  it('renders multiple items when count > 1', () => {
    render(createElement(Skeleton, { count: 4 }));

    const items = document.querySelectorAll('[aria-hidden="true"]');
    expect(items.length).toBe(4);
  });

  it('renders circle variant', () => {
    render(createElement(Skeleton, { variant: 'circle', width: '48px', height: '48px' }));

    const item = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(item.style.width).toBe('48px');
    expect(item.style.height).toBe('48px');
  });

  it('renders card variant', () => {
    render(createElement(Skeleton, { variant: 'card' }));

    const item = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(item.style.height).toBe('120px');
  });

  it('renders table-row variant with multiple columns', () => {
    render(createElement(Skeleton, { variant: 'table-row' }));

    // table-row has a container div (aria-hidden) with 4 inner divs
    const container = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(container).toBeTruthy();
    expect(container.children.length).toBe(4);
  });

  it('renders text variant by default', () => {
    render(createElement(Skeleton, { width: '200px' }));

    const item = document.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(item.style.width).toBe('200px');
  });
});

// ─── StatusDot ───────────────────────────────────────────────────

describe('StatusDot component', () => {
  it('renders with aria-label matching status', () => {
    render(createElement(StatusDot, { status: 'success' }));

    expect(screen.getByLabelText('success')).toBeDefined();
  });

  it('renders all status variants', () => {
    const statuses = ['success', 'warning', 'danger', 'info', 'neutral'] as const;
    statuses.forEach((status) => {
      const { unmount } = render(createElement(StatusDot, { status }));
      expect(screen.getByLabelText(status)).toBeDefined();
      unmount();
    });
  });

  it('renders pulse animation when pulse=true', () => {
    render(createElement(StatusDot, { status: 'danger', pulse: true }));

    const container = screen.getByLabelText('danger');
    const pulseSpan = container.querySelector('[aria-hidden="true"]');
    expect(pulseSpan).toBeTruthy();
  });

  it('does not render pulse span when pulse=false', () => {
    render(createElement(StatusDot, { status: 'info', pulse: false }));

    const container = screen.getByLabelText('info');
    const pulseSpan = container.querySelector('[aria-hidden="true"]');
    expect(pulseSpan).toBeNull();
  });

  it('supports sm size', () => {
    render(createElement(StatusDot, { status: 'success', size: 'sm' }));

    expect(screen.getByLabelText('success')).toBeDefined();
  });

  it('supports md size (default)', () => {
    render(createElement(StatusDot, { status: 'warning' }));

    expect(screen.getByLabelText('warning')).toBeDefined();
  });
});
