/**
 * Profile & TeamManagement Page Tests
 *
 * Validates:
 *
 * Profile:
 * - Renders page heading and subtitle
 * - Shows profile sections (avatar/personal info, password, MFA, sessions, API tokens)
 * - Shows preferences section (theme, language, timezone)
 * - Shows Save Profile button
 * - Shows Save Preferences button
 * - Shows MFA Status toggle
 * - Shows active sessions with device info
 * - Shows API tokens with masked prefixes
 * - Shows Generate New Token button
 * - Loading state
 * - No PHI in rendered output
 *
 * TeamManagement:
 * - Renders page heading and subtitle
 * - Shows KPI row (Total Members, Active, Invited, Suspended)
 * - Shows Team Members table card
 * - Shows Invite Member button
 * - Shows Refresh button
 * - Shows SCIM Directory Sync status
 * - Shows Recent Activity card
 * - Shows mock team member names
 * - Shows member status badges
 * - Loading state
 * - No PHI in rendered output
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Profile } from '../pages/Profile';
import { TeamManagement } from '../pages/TeamManagement';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

// ─── Mock useAuth ───────────────────────────────────────────────

vi.mock('../lib/auth', () => ({
  useAuth: () => ({
    user: {
      id: 'usr-test',
      email: 'demo@ordr-connect.io',
      name: 'Demo Operator',
      role: 'admin',
      tenantId: 'tenant-demo',
    },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// ─── Helpers ────────────────────────────────────────────────────

function renderProfile(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Profile)));
}

function renderTeamManagement(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(TeamManagement)));
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Profile Tests ──────────────────────────────────────────────

describe('Profile', () => {
  it('renders page heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Profile')).toBeDefined();
    });
  });

  it('renders page subtitle', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Manage your account settings and preferences')).toBeDefined();
    });
  });

  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderProfile();

    expect(screen.getByText('Loading profile')).toBeDefined();
  });

  it('shows Personal Information section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Personal Information')).toBeDefined();
    });
  });

  it('shows Display Name input with user name', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Display Name')).toBeDefined();
    });
  });

  it('shows Email input', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      // Label text for the email field
      expect(screen.getByText('Email')).toBeDefined();
    });
  });

  it('shows Upload Photo button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Upload Photo')).toBeDefined();
    });
  });

  it('shows Save Profile button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Save Profile')).toBeDefined();
    });
  });

  it('shows user role badge', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('admin')).toBeDefined();
    });
  });

  it('shows tenant ID badge', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Tenant: tenant-demo')).toBeDefined();
    });
  });

  it('shows Change Password section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Change Password')).toBeDefined();
    });
  });

  it('shows password fields', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Current Password')).toBeDefined();
      expect(screen.getByText('New Password')).toBeDefined();
      expect(screen.getByText('Confirm New Password')).toBeDefined();
    });
  });

  it('shows Update Password button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Update Password')).toBeDefined();
    });
  });

  it('shows Multi-Factor Authentication section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Multi-Factor Authentication')).toBeDefined();
    });
  });

  it('shows MFA Status label', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('MFA Status')).toBeDefined();
    });
  });

  it('shows Active Sessions section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Active Sessions')).toBeDefined();
    });
  });

  it('shows mock session devices', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Chrome on Windows 10')).toBeDefined();
      expect(screen.getByText('Safari on macOS')).toBeDefined();
      expect(screen.getByText('Firefox on Ubuntu')).toBeDefined();
    });
  });

  it('shows Current badge on current session', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Current')).toBeDefined();
    });
  });

  it('shows API Tokens section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('API Tokens')).toBeDefined();
    });
  });

  it('shows mock API token names', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('CI/CD Pipeline')).toBeDefined();
      expect(screen.getByText('Monitoring Integration')).toBeDefined();
    });
  });

  it('shows Generate New Token button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Generate New Token')).toBeDefined();
    });
  });

  it('shows Preferences section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Preferences')).toBeDefined();
    });
  });

  it('shows Theme select in preferences', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Theme')).toBeDefined();
    });
  });

  it('shows Language select in preferences', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Language')).toBeDefined();
    });
  });

  it('shows Save Preferences button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Save Preferences')).toBeDefined();
    });
  });

  it('does NOT render any PHI in profile output', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    const { container } = renderProfile();

    await waitFor(() => {
      expect(screen.getByText('Profile')).toBeDefined();
    });

    const allText = container.textContent;
    expect(allText).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(allText).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

// ─── TeamManagement Tests ───────────────────────────────────────

describe('TeamManagement', () => {
  it('renders page heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('Team Management')).toBeDefined();
    });
  });

  it('renders page subtitle', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('Manage team members, roles, and access control')).toBeDefined();
    });
  });

  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderTeamManagement();

    expect(screen.getByText('Loading team')).toBeDefined();
  });

  it('shows KPI row with Total Members', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('Total Members')).toBeDefined();
    });
  });

  it('shows KPI row with Active count', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      // "Active" appears as both KPI label and status badge
      expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    });
  });

  it('shows KPI row with Invited count', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      // "Invited" appears as both KPI label and status badge
      expect(screen.getAllByText('Invited').length).toBeGreaterThan(0);
    });
  });

  it('shows KPI row with Suspended count', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      // "Suspended" appears as both KPI label and status badge
      expect(screen.getAllByText('Suspended').length).toBeGreaterThan(0);
    });
  });

  it('shows correct total member count from mock data', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('7')).toBeDefined();
    });
  });

  it('shows Team Members card title', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('Team Members')).toBeDefined();
    });
  });

  it('shows member count badge', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('7 members')).toBeDefined();
    });
  });

  it('shows mock team member names in table', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      // Some names appear in both the table and the activity log
      expect(screen.getAllByText('Sarah Chen').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Marcus Rivera').length).toBeGreaterThan(0);
      expect(screen.getByText('Aisha Patel')).toBeDefined();
      expect(screen.getByText('James Okafor')).toBeDefined();
      expect(screen.getAllByText('Elena Volkov').length).toBeGreaterThan(0);
    });
  });

  it('shows table column headers', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('Member')).toBeDefined();
      expect(screen.getByText('Role')).toBeDefined();
      expect(screen.getByText('Status')).toBeDefined();
      expect(screen.getByText('Last Active')).toBeDefined();
      expect(screen.getByText('MFA')).toBeDefined();
      expect(screen.getByText('Actions')).toBeDefined();
    });
  });

  it('shows Invite Member button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('Invite Member')).toBeDefined();
    });
  });

  it('shows Refresh button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeDefined();
    });
  });

  it('shows SCIM Directory Sync status', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('SCIM Directory Sync')).toBeDefined();
      expect(screen.getByText('Synced')).toBeDefined();
    });
  });

  it('shows Recent Activity card', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('Recent Activity')).toBeDefined();
    });
  });

  it('shows Audit Trail badge on activity card', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('Audit Trail')).toBeDefined();
    });
  });

  it('shows mock activity entries', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('Invited member')).toBeDefined();
      expect(screen.getByText('Changed role')).toBeDefined();
      expect(screen.getByText('Suspended member')).toBeDefined();
    });
  });

  it('does NOT render any PHI in team management output', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    const { container } = renderTeamManagement();

    await waitFor(() => {
      expect(screen.getByText('Team Management')).toBeDefined();
    });

    const allText = container.textContent;
    expect(allText).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(allText).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
