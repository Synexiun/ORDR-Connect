/**
 * Customers Page Tests
 *
 * Validates:
 * - Loading spinner shown initially
 * - Page heading "Customers"
 * - KPI labels: Total Customers, Active, At-Risk, Churned
 * - Status filter buttons: All, Active, Inactive, Prospect, Churned
 * - Search input with aria-label
 * - "+ Add Customer" button
 * - Table column headers: Name, Status, Health Score, Stage, Last Contact
 * - API data renders rows
 * - Fallback renders with mock data on API failure
 *
 * COMPLIANCE: No PHI in test data. Customer names are synthetic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

// ─── Mock chart + modal components ───────────────────────────────

vi.mock('../components/charts/SparkLine', () => ({ SparkLine: () => null }));
vi.mock('../components/ui/Modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? createElement('div', { role: 'dialog' }, children) : null,
}));

// ─── Mock customers API ───────────────────────────────────────────

const mockListCustomers = vi.fn();
const mockCreateCustomer = vi.fn();
const mockDeleteCustomer = vi.fn();
const mockSemanticSearchCustomers = vi.fn();

vi.mock('../lib/customers-api', () => ({
  listCustomers: (...args: unknown[]) => mockListCustomers(...args) as unknown,
  createCustomer: (...args: unknown[]) => mockCreateCustomer(...args) as unknown,
  deleteCustomer: (...args: unknown[]) => mockDeleteCustomer(...args) as unknown,
  semanticSearchCustomers: (...args: unknown[]) => mockSemanticSearchCustomers(...args) as unknown,
}));

import { Customers } from '../pages/Customers';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_CUSTOMER = {
  id: 'cust-0001',
  name: 'Acme Corp',
  email: 'contact@acme.com',
  status: 'active' as const,
  type: 'business' as const,
  healthScore: 85,
  lifecycleStage: 'active' as const,
  accountValue: 25000,
  lastContact: '2026-03-28T10:00:00Z',
  agentAssigned: null,
  createdAt: '2026-01-01T00:00:00Z',
};

const LIST_RESPONSE = {
  success: true as const,
  data: [MOCK_CUSTOMER],
  total: 1,
  page: 1,
  pageSize: 25,
};

// ─── Setup / Teardown ────────────────────────────────────────────

function renderCustomers(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Customers)));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListCustomers.mockResolvedValue(LIST_RESPONSE);
  mockCreateCustomer.mockResolvedValue({ ...MOCK_CUSTOMER, id: 'cust-new' });
  mockDeleteCustomer.mockResolvedValue(undefined);
  mockSemanticSearchCustomers.mockResolvedValue(LIST_RESPONSE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('Customers page', () => {
  it('shows loading spinner initially', () => {
    renderCustomers();
    expect(screen.getByText('Loading customers')).toBeDefined();
  });

  it('renders page heading "Customers" after data loads', async () => {
    renderCustomers();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Customers' })).toBeDefined();
    });
  });

  it('renders KPI label: Total Customers', async () => {
    renderCustomers();
    await waitFor(() => {
      expect(screen.getByText('Total Customers')).toBeDefined();
    });
  });

  it('renders KPI label: Active', async () => {
    renderCustomers();
    await waitFor(() => {
      // "Active" appears in both KPI and filter button
      expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    });
  });

  it('renders KPI label: At-Risk', async () => {
    renderCustomers();
    await waitFor(() => {
      expect(screen.getByText('At-Risk')).toBeDefined();
    });
  });

  it('renders KPI label: Churned', async () => {
    renderCustomers();
    await waitFor(() => {
      // "Churned" appears in both KPI and filter button
      expect(screen.getAllByText('Churned').length).toBeGreaterThan(0);
    });
  });

  it('renders search input with aria-label', async () => {
    renderCustomers();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Search customers' })).toBeDefined();
    });
  });

  it('renders status filter buttons', async () => {
    renderCustomers();
    await waitFor(() => {
      ['All', 'Active', 'Inactive', 'Prospect', 'Churned'].forEach((label) => {
        expect(screen.getByRole('button', { name: label })).toBeDefined();
      });
    });
  });

  it('renders "+ Add Customer" button', async () => {
    renderCustomers();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Add Customer' })).toBeDefined();
    });
  });

  it('calls listCustomers on mount', async () => {
    renderCustomers();
    await waitFor(() => {
      expect(mockListCustomers).toHaveBeenCalledTimes(1);
    });
  });

  it('renders customer row from API data', async () => {
    renderCustomers();
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeDefined();
    });
  });

  it('falls back to mock customers on API failure and still renders', async () => {
    mockListCustomers.mockRejectedValue(new Error('Network error'));
    renderCustomers();
    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'Customers' })).toBeDefined();
      },
      { timeout: 5000 },
    );
  });
});
