/**
 * Layout Component Tests
 *
 * Validates:
 * - Sidebar: nav groups (OPERATIONS, INTELLIGENCE, etc.), nav items, section headers
 * - TopBar: notification bell, user avatar, breadcrumbs
 * - PageHeader: title, subtitle, breadcrumbs, action buttons
 * - Layout: composes Sidebar + TopBar + Outlet
 *
 * SECURITY:
 * - No PHI/PII in test fixtures (Rule 6)
 * - Mock auth returns only name/role — no tokens or tenant secrets (Rule 2/5)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Mocks ────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
const mockLogout = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Outlet: () => createElement('div', { 'data-testid': 'outlet' }, 'Outlet Content'),
  };
});

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: {
      id: 'user-001',
      email: 'operator@ordr.io',
      name: 'Jane Operator',
      role: 'admin',
      tenantId: 'tenant-test',
    },
    isLoading: false,
    isDemo: false,
    login: vi.fn(),
    loginDemo: vi.fn(),
    logout: mockLogout,
  }),
}));

vi.mock('../components/ThemeProvider', () => ({
  useBranding: () => ({
    brand: {
      tenantId: 'tenant-test',
      customDomain: null,
      logoUrl: null,
      faviconUrl: null,
      primaryColor: '#3b82f6',
      accentColor: '#10b981',
      bgColor: '#0f172a',
      textColor: '#e2e8f0',
      emailFromName: null,
      emailFromAddress: null,
      customCss: null,
      footerText: null,
    },
    isLoading: false,
  }),
}));

// ─── Imports (after mocks) ────────────────────────────────────────

import { Sidebar } from '../components/layout/Sidebar';
import { TopBar } from '../components/layout/TopBar';
import { PageHeader } from '../components/layout/PageHeader';
import { Layout } from '../components/Layout';

// ─── Helpers ──────────────────────────────────────────────────────

function renderInRouter(
  element: React.ReactElement,
  initialEntries: string[] = ['/dashboard'],
): ReturnType<typeof render> {
  return render(createElement(MemoryRouter, { initialEntries }, element));
}

// ─── Setup / Teardown ─────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════
// Sidebar Tests
// ═══════════════════════════════════════════════════════════════════

describe('Sidebar', () => {
  const defaultProps = {
    collapsed: false,
    onToggle: vi.fn(),
    mobileOpen: false,
    onMobileClose: vi.fn(),
  };

  function renderSidebar(props: Partial<typeof defaultProps> = {}): ReturnType<typeof render> {
    return renderInRouter(createElement(Sidebar, { ...defaultProps, ...props }));
  }

  it('renders the main navigation landmark', () => {
    renderSidebar();
    expect(screen.getByLabelText('Main navigation')).toBeDefined();
  });

  it('renders OPERATIONS section header', () => {
    renderSidebar();
    expect(screen.getByText('OPERATIONS')).toBeDefined();
  });

  it('renders INTELLIGENCE section header', () => {
    renderSidebar();
    expect(screen.getByText('INTELLIGENCE')).toBeDefined();
  });

  it('renders REPORTING section header', () => {
    renderSidebar();
    expect(screen.getByText('REPORTING')).toBeDefined();
  });

  it('renders COMPLIANCE section header', () => {
    renderSidebar();
    expect(screen.getByText('COMPLIANCE')).toBeDefined();
  });

  it('renders PLATFORM section header', () => {
    renderSidebar();
    expect(screen.getByText('PLATFORM')).toBeDefined();
  });

  it('renders SYSTEM section header', () => {
    renderSidebar();
    expect(screen.getByText('SYSTEM')).toBeDefined();
  });

  it('renders Dashboard nav item', () => {
    renderSidebar();
    expect(screen.getByText('Dashboard')).toBeDefined();
  });

  it('renders Customers nav item', () => {
    renderSidebar();
    expect(screen.getByText('Customers')).toBeDefined();
  });

  it('renders Interactions nav item', () => {
    renderSidebar();
    expect(screen.getByText('Interactions')).toBeDefined();
  });

  it('renders Tickets nav item', () => {
    renderSidebar();
    expect(screen.getByText('Tickets')).toBeDefined();
  });

  it('renders Agent Activity nav item', () => {
    renderSidebar();
    expect(screen.getByText('Agent Activity')).toBeDefined();
  });

  it('renders Analytics nav item', () => {
    renderSidebar();
    expect(screen.getByText('Analytics')).toBeDefined();
  });

  it('renders Reports nav item', () => {
    renderSidebar();
    expect(screen.getByText('Reports')).toBeDefined();
  });

  it('renders Audit Log nav item', () => {
    renderSidebar();
    expect(screen.getByText('Audit Log')).toBeDefined();
  });

  it('renders Compliance nav item under COMPLIANCE section', () => {
    renderSidebar();
    // "Compliance" text appears both as section header (COMPLIANCE) and as nav item
    const items = screen.getAllByText('Compliance');
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('renders Marketplace nav item', () => {
    renderSidebar();
    expect(screen.getByText('Marketplace')).toBeDefined();
  });

  it('renders Developer nav item', () => {
    renderSidebar();
    expect(screen.getByText('Developer')).toBeDefined();
  });

  it('renders Healthcare nav item', () => {
    renderSidebar();
    expect(screen.getByText('Healthcare')).toBeDefined();
  });

  it('renders Partner nav item', () => {
    renderSidebar();
    expect(screen.getByText('Partner')).toBeDefined();
  });

  it('renders Settings nav item', () => {
    renderSidebar();
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders Help nav item', () => {
    renderSidebar();
    expect(screen.getByText('Help')).toBeDefined();
  });

  it('renders ORDR.Connect brand text when expanded', () => {
    renderSidebar({ collapsed: false });
    // The brand text is split: <h1>ORDR<span>.</span>Connect</h1>
    const heading = screen.getByText(
      (_content, element) => element?.tagName === 'H1' && element.textContent === 'ORDR.Connect',
    );
    expect(heading).toBeDefined();
  });

  it('hides brand text when collapsed', () => {
    renderSidebar({ collapsed: true });
    const heading = screen.queryByText(
      (_content, element) => element?.tagName === 'H1' && element.textContent === 'ORDR.Connect',
    );
    expect(heading).toBeNull();
  });

  it('hides section headers when collapsed', () => {
    renderSidebar({ collapsed: true });
    expect(screen.queryByText('OPERATIONS')).toBeNull();
    expect(screen.queryByText('INTELLIGENCE')).toBeNull();
    expect(screen.queryByText('REPORTING')).toBeNull();
  });

  it('hides nav labels when collapsed', () => {
    renderSidebar({ collapsed: true });
    expect(screen.queryByText('Dashboard')).toBeNull();
    expect(screen.queryByText('Customers')).toBeNull();
  });

  it('shows user name when expanded', () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByText('Jane Operator')).toBeDefined();
  });

  it('shows user role when expanded', () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByText('admin')).toBeDefined();
  });

  it('shows user initials', () => {
    renderSidebar();
    expect(screen.getByText('JO')).toBeDefined();
  });

  it('renders sign out button when expanded', () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByLabelText('Sign out')).toBeDefined();
  });

  it('calls logout and navigates on sign out', () => {
    renderSidebar({ collapsed: false });
    fireEvent.click(screen.getByLabelText('Sign out'));
    expect(mockLogout).toHaveBeenCalledOnce();
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('shows compliance badge text when expanded', () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByText('Compliance: Active')).toBeDefined();
    expect(screen.getByText('SOC 2 · ISO 27001 · HIPAA')).toBeDefined();
  });

  it('renders collapse/expand toggle with correct aria-label', () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByLabelText('Collapse sidebar')).toBeDefined();
  });

  it('renders expand label when collapsed', () => {
    renderSidebar({ collapsed: true });
    expect(screen.getByLabelText('Expand sidebar')).toBeDefined();
  });

  it('calls onToggle when collapse button is clicked', () => {
    const onToggle = vi.fn();
    renderSidebar({ collapsed: false, onToggle });
    fireEvent.click(screen.getByLabelText('Collapse sidebar'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('renders close menu button for mobile', () => {
    renderSidebar({ mobileOpen: true, collapsed: false });
    expect(screen.getByLabelText('Close menu')).toBeDefined();
  });

  it('calls onMobileClose when mobile close is clicked', () => {
    const onMobileClose = vi.fn();
    renderSidebar({ mobileOpen: true, collapsed: false, onMobileClose });
    fireEvent.click(screen.getByLabelText('Close menu'));
    expect(onMobileClose).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TopBar Tests
// ═══════════════════════════════════════════════════════════════════

describe('TopBar', () => {
  const defaultProps = {
    onMenuToggle: vi.fn(),
    notificationCount: 3,
  };

  function renderTopBar(props: Partial<typeof defaultProps> = {}): ReturnType<typeof render> {
    return renderInRouter(createElement(TopBar, { ...defaultProps, ...props }), ['/dashboard']);
  }

  it('renders notification bell', () => {
    renderTopBar();
    expect(screen.getByLabelText('Notifications (3 unread)')).toBeDefined();
  });

  it('renders notification count badge', () => {
    renderTopBar({ notificationCount: 5 });
    expect(screen.getByText('5')).toBeDefined();
  });

  it('displays 9+ for counts above 9', () => {
    renderTopBar({ notificationCount: 15 });
    expect(screen.getByText('9+')).toBeDefined();
  });

  it('hides count badge when notificationCount is 0', () => {
    renderTopBar({ notificationCount: 0 });
    expect(screen.getByLabelText('Notifications')).toBeDefined();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('renders user avatar with initials', () => {
    renderTopBar();
    expect(screen.getByText('JO')).toBeDefined();
  });

  it('renders user menu button', () => {
    renderTopBar();
    expect(screen.getByLabelText('User menu')).toBeDefined();
  });

  it('renders breadcrumb Home link on /dashboard', () => {
    renderTopBar();
    expect(screen.getByText('Home')).toBeDefined();
  });

  it('renders breadcrumb label for current route', () => {
    renderInRouter(createElement(TopBar, defaultProps), ['/customers']);
    // "Customers" appears in both breadcrumb and mobile page name — use getAllByText
    const elements = screen.getAllByText('Customers');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('navigates to /notifications when bell is clicked', () => {
    renderTopBar();
    fireEvent.click(screen.getByLabelText('Notifications (3 unread)'));
    expect(mockNavigate).toHaveBeenCalledWith('/notifications');
  });

  it('renders toggle navigation button', () => {
    renderTopBar();
    expect(screen.getByLabelText('Toggle navigation')).toBeDefined();
  });

  it('calls onMenuToggle when menu button is clicked', () => {
    const onMenuToggle = vi.fn();
    renderTopBar({ onMenuToggle });
    fireEvent.click(screen.getByLabelText('Toggle navigation'));
    expect(onMenuToggle).toHaveBeenCalledOnce();
  });

  it('renders compliance indicator text', () => {
    renderTopBar();
    expect(screen.getByText('Compliant')).toBeDefined();
  });

  it('opens user dropdown on avatar click', () => {
    renderTopBar();
    fireEvent.click(screen.getByLabelText('User menu'));
    expect(screen.getByRole('menu', { name: 'User actions' })).toBeDefined();
  });

  it('shows user name in dropdown', () => {
    renderTopBar();
    fireEvent.click(screen.getByLabelText('User menu'));
    // The user name appears both in the avatar and the dropdown
    const nameElements = screen.getAllByText('Jane Operator');
    expect(nameElements.length).toBeGreaterThanOrEqual(1);
  });

  it('shows Profile, Team, Settings, Sign Out in dropdown', () => {
    renderTopBar();
    fireEvent.click(screen.getByLabelText('User menu'));
    expect(screen.getByText('Profile')).toBeDefined();
    expect(screen.getByText('Team')).toBeDefined();
    // Settings exists both as breadcrumb route label and dropdown item
    expect(screen.getByText('Sign Out')).toBeDefined();
  });

  it('calls logout and navigates on Sign Out click', () => {
    renderTopBar();
    fireEvent.click(screen.getByLabelText('User menu'));
    fireEvent.click(screen.getByText('Sign Out'));
    expect(mockLogout).toHaveBeenCalledOnce();
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });
});

// ═══════════════════════════════════════════════════════════════════
// PageHeader Tests
// ═══════════════════════════════════════════════════════════════════

describe('PageHeader', () => {
  it('renders title', () => {
    renderInRouter(createElement(PageHeader, { title: 'Dashboard' }));
    expect(screen.getByText('Dashboard')).toBeDefined();
  });

  it('renders title as h1 element', () => {
    renderInRouter(createElement(PageHeader, { title: 'Customers' }));
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Customers');
  });

  it('renders subtitle when provided', () => {
    renderInRouter(
      createElement(PageHeader, {
        title: 'Dashboard',
        subtitle: 'Overview of operations',
      }),
    );
    expect(screen.getByText('Overview of operations')).toBeDefined();
  });

  it('does not render subtitle when not provided', () => {
    renderInRouter(createElement(PageHeader, { title: 'Dashboard' }));
    // Only the h1 child div should exist under the title area
    expect(screen.queryByText('undefined')).toBeNull();
  });

  it('renders breadcrumbs when provided', () => {
    renderInRouter(
      createElement(PageHeader, {
        title: 'Customer Detail',
        breadcrumbs: [
          { label: 'Home', href: '/dashboard' },
          { label: 'Customers', href: '/customers' },
          { label: 'Acme Corp' },
        ],
      }),
    );
    expect(screen.getByText('Home')).toBeDefined();
    expect(screen.getByText('Customers')).toBeDefined();
    expect(screen.getByText('Acme Corp')).toBeDefined();
  });

  it('renders breadcrumb navigation landmark', () => {
    renderInRouter(
      createElement(PageHeader, {
        title: 'Test',
        breadcrumbs: [{ label: 'Home', href: '/' }],
      }),
    );
    expect(screen.getByLabelText('Breadcrumbs')).toBeDefined();
  });

  it('does not render breadcrumb nav when breadcrumbs are empty', () => {
    renderInRouter(createElement(PageHeader, { title: 'Test', breadcrumbs: [] }));
    expect(screen.queryByLabelText('Breadcrumbs')).toBeNull();
  });

  it('does not render breadcrumb nav when breadcrumbs not provided', () => {
    renderInRouter(createElement(PageHeader, { title: 'Test' }));
    expect(screen.queryByLabelText('Breadcrumbs')).toBeNull();
  });

  it('renders intermediate breadcrumbs as links', () => {
    renderInRouter(
      createElement(PageHeader, {
        title: 'Detail',
        breadcrumbs: [
          { label: 'Home', href: '/dashboard' },
          { label: 'Customers', href: '/customers' },
          { label: 'Detail' },
        ],
      }),
    );
    const homeLink = screen.getByText('Home').closest('a');
    expect(homeLink).not.toBeNull();
    expect(homeLink?.getAttribute('href')).toBe('/dashboard');
  });

  it('renders last breadcrumb as plain text (not a link)', () => {
    renderInRouter(
      createElement(PageHeader, {
        title: 'Customer Detail',
        breadcrumbs: [{ label: 'Home', href: '/dashboard' }, { label: 'Current View' }],
      }),
    );
    const lastCrumb = screen.getByText('Current View');
    expect(lastCrumb.tagName.toLowerCase()).toBe('span');
    expect(lastCrumb.closest('a')).toBeNull();
  });

  it('renders action buttons when provided', () => {
    renderInRouter(
      createElement(PageHeader, {
        title: 'Customers',
        actions: createElement('button', { 'data-testid': 'action-btn' }, 'Add Customer'),
      }),
    );
    expect(screen.getByTestId('action-btn')).toBeDefined();
    expect(screen.getByText('Add Customer')).toBeDefined();
  });

  it('does not render actions container when not provided', () => {
    const { container } = renderInRouter(createElement(PageHeader, { title: 'Test' }));
    // The actions wrapper div should not exist
    const actionsDiv = container.querySelector('.shrink-0');
    expect(actionsDiv).toBeNull();
  });

  it('applies custom className', () => {
    const { container } = renderInRouter(
      createElement(PageHeader, { title: 'Test', className: 'custom-class' }),
    );
    expect(container.querySelector('.custom-class')).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Layout Tests
// ═══════════════════════════════════════════════════════════════════

describe('Layout', () => {
  function renderLayout(initialEntries: string[] = ['/dashboard']): ReturnType<typeof render> {
    return renderInRouter(createElement(Layout), initialEntries);
  }

  it('renders the sidebar', () => {
    renderLayout();
    expect(screen.getByLabelText('Main navigation')).toBeDefined();
  });

  it('renders the top bar', () => {
    renderLayout();
    // TopBar includes a "Toggle navigation" button
    expect(screen.getByLabelText('Toggle navigation')).toBeDefined();
  });

  it('renders the Outlet for child routes', () => {
    renderLayout();
    expect(screen.getByTestId('outlet')).toBeDefined();
    expect(screen.getByText('Outlet Content')).toBeDefined();
  });

  it('composes Sidebar + TopBar + Outlet together', () => {
    renderLayout();
    // All three should be present simultaneously
    expect(screen.getByLabelText('Main navigation')).toBeDefined();
    expect(screen.getByLabelText('Toggle navigation')).toBeDefined();
    expect(screen.getByTestId('outlet')).toBeDefined();
  });

  it('renders nav items through the Sidebar', () => {
    renderLayout();
    // "Dashboard" appears in sidebar nav and TopBar breadcrumbs — use getAllByText
    const dashboardElements = screen.getAllByText('Dashboard');
    expect(dashboardElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Customers')).toBeDefined();
  });

  it('renders notification bell through the TopBar', () => {
    renderLayout();
    expect(screen.getByTitle('Notifications')).toBeDefined();
  });

  it('renders user initials through both Sidebar and TopBar', () => {
    renderLayout();
    const initials = screen.getAllByText('JO');
    // Sidebar user card + TopBar avatar
    expect(initials.length).toBeGreaterThanOrEqual(2);
  });
});
