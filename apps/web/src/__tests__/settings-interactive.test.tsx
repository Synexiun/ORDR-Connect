/**
 * Settings Interactive Page Tests
 *
 * Validates:
 * - Renders page heading and subtitle
 * - Shows all 8 tabs (General, SSO, Roles, Agents, Channels, Notifications, Security, Branding)
 * - Tab switching changes visible panel
 * - General tab shows form elements (Organization Name, Timezone, Data Retention, Language)
 * - Save Changes button present in General tab
 * - Loading state while data fetches
 * - SSO tab content after switch
 * - Roles tab content after switch
 * - Agents tab content after switch
 * - Channels tab content after switch
 * - Notifications tab content after switch
 * - Security tab content after switch
 * - Branding tab content after switch
 * - No PHI in rendered output
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Settings } from '../pages/Settings';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
  },
}));

// ─── Helpers ────────────────────────────────────────────────────

function renderComponent(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Settings)));
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

// ─── Tests ───────────────────────────────────────────────────────

describe('Settings', () => {
  it('renders page heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeDefined();
    });
  });

  it('renders page subtitle', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Tenant configuration and system preferences')).toBeDefined();
    });
  });

  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderComponent();

    expect(screen.getByText('Loading settings')).toBeDefined();
  });

  it('shows all 8 tabs', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
      expect(screen.getByText('SSO')).toBeDefined();
      expect(screen.getByText('Roles')).toBeDefined();
      expect(screen.getByText('Agents')).toBeDefined();
      expect(screen.getByText('Channels')).toBeDefined();
      expect(screen.getByText('Notifications')).toBeDefined();
      expect(screen.getByText('Security')).toBeDefined();
      expect(screen.getByText('Branding')).toBeDefined();
    });
  });

  it('tabs have correct ARIA role', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      const tabs = screen.getAllByRole('tab');
      expect(tabs.length).toBe(8);
    });
  });

  it('General tab is active by default', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      const generalTab = screen.getByRole('tab', { name: /General/i });
      expect(generalTab.getAttribute('aria-selected')).toBe('true');
    });
  });

  it('General tab shows Tenant Settings card', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Tenant Settings')).toBeDefined();
    });
  });

  it('General tab shows Organization Name input', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Organization Name')).toBeDefined();
    });
  });

  it('General tab shows Timezone select', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Timezone')).toBeDefined();
    });
  });

  it('General tab shows Data Retention select', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Data Retention')).toBeDefined();
    });
  });

  it('General tab shows Default Language select', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Default Language')).toBeDefined();
    });
  });

  it('General tab shows Save Changes button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeDefined();
    });
  });

  it('General tab shows Managed badge', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Managed')).toBeDefined();
    });
  });

  it('switching to SSO tab shows SSO Connections card', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /SSO/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('SSO Connections')).toBeDefined();
    });
  });

  it('SSO tab shows mock connections', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /SSO/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Okta')).toBeDefined();
      expect(screen.getByText('Google Workspace')).toBeDefined();
      expect(screen.getByText('Azure AD')).toBeDefined();
    });
  });

  it('SSO tab shows Add SSO Connection button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /SSO/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Add SSO Connection')).toBeDefined();
    });
  });

  it('switching to Roles tab shows Custom Roles card', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Roles/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Custom Roles')).toBeDefined();
    });
  });

  it('Roles tab shows mock roles', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Roles/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Admin')).toBeDefined();
      expect(screen.getByText('Operator')).toBeDefined();
      expect(screen.getByText('Analyst')).toBeDefined();
      expect(screen.getByText('Auditor')).toBeDefined();
      expect(screen.getByText('Collection Lead')).toBeDefined();
    });
  });

  it('Roles tab shows Create Custom Role button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Roles/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Create Custom Role')).toBeDefined();
    });
  });

  it('switching to Agents tab shows Agent Configuration card', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Agents/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Agent Configuration')).toBeDefined();
    });
  });

  it('Agents tab shows Global Kill Switch', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Agents/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Global Kill Switch')).toBeDefined();
    });
  });

  it('Agents tab shows Autonomy Levels section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Agents/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Autonomy Levels')).toBeDefined();
    });
  });

  it('Agents tab shows Save Agent Config button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Agents/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Save Agent Config')).toBeDefined();
    });
  });

  it('switching to Channels tab shows Channel Preferences Defaults card', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Channels/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Channel Preferences Defaults')).toBeDefined();
    });
  });

  it('Channels tab shows mock channel list', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Channels/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Email')).toBeDefined();
      expect(screen.getByText('SMS')).toBeDefined();
      expect(screen.getByText('Voice')).toBeDefined();
      expect(screen.getByText('WhatsApp')).toBeDefined();
      expect(screen.getByText('Chat')).toBeDefined();
    });
  });

  it('switching to Notifications tab shows Notification Preferences card', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Notifications/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Notification Preferences')).toBeDefined();
    });
  });

  it('Notifications tab shows mock notification prefs', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Notifications/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Compliance Violations')).toBeDefined();
      expect(screen.getByText('Agent HITL Requests')).toBeDefined();
      expect(screen.getByText('Audit Chain Alerts')).toBeDefined();
    });
  });

  it('switching to Security tab shows Security card', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Security/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Encryption')).toBeDefined();
      expect(screen.getByText('Key Rotation')).toBeDefined();
    });
  });

  it('Security tab shows AES-256-GCM / TLS 1.3 encryption', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Security/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('AES-256-GCM / TLS 1.3')).toBeDefined();
    });
  });

  it('Security tab shows IP Allowlist section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Security/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('IP Allowlist')).toBeDefined();
    });
  });

  it('Security tab shows Save Security Config button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Security/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Save Security Config')).toBeDefined();
    });
  });

  it('switching to Branding tab shows Brand Customization card', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Branding/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Brand Customization')).toBeDefined();
    });
  });

  it('Branding tab shows Brand Color label', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Branding/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Brand Color')).toBeDefined();
    });
  });

  it('Branding tab shows Logo section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Branding/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Logo')).toBeDefined();
    });
  });

  it('Branding tab shows Save Branding button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('General')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /Branding/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Save Branding')).toBeDefined();
    });
  });

  it('tab switching hides the previous panel', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Tenant Settings')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /SSO/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('SSO Connections')).toBeDefined();
      expect(screen.queryByText('Tenant Settings')).toBeNull();
    });
  });

  it('does NOT render any PHI in settings output', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    const { container } = renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeDefined();
    });

    const allText = container.textContent;
    expect(allText).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(allText).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});
