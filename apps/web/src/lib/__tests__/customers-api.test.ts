/**
 * Customers API Tests
 *
 * Validates:
 * - listCustomers with no params → GET /v1/customers
 * - listCustomers with filters → correct query string
 * - getCustomer → GET /v1/customers/:id
 * - createCustomer → POST /v1/customers
 * - updateCustomer → PATCH /v1/customers/:id
 * - deleteCustomer → DELETE /v1/customers/:id
 * - semanticSearchCustomers → GET /v1/customers/search?q=...&limit=...
 * - semanticSearchCustomers default limit
 *
 * COMPLIANCE: No PHI in any test assertion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

import {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  semanticSearchCustomers,
} from '../customers-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_CUSTOMER = {
  id: 'cust-1',
  tenantId: 'tenant-1',
  externalId: null,
  type: 'company' as const,
  name: 'Acme Corp',
  email: null,
  phone: null,
  status: 'active' as const,
  lifecycleStage: 'customer' as const,
  healthScore: 85,
  assignedUserId: null,
  metadata: {},
  createdAt: new Date('2026-01-01').toISOString(),
  updatedAt: new Date('2026-03-01').toISOString(),
};

const LIST_RESPONSE = {
  success: true as const,
  data: [MOCK_CUSTOMER],
  total: 1,
  page: 1,
  pageSize: 25,
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(LIST_RESPONSE);
  mockPost.mockResolvedValue({ success: true, data: MOCK_CUSTOMER });
  mockPatch.mockResolvedValue({ success: true, data: MOCK_CUSTOMER });
  mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('listCustomers', () => {
  it('calls GET /v1/customers with no query string when no params', async () => {
    await listCustomers();
    expect(mockGet).toHaveBeenCalledWith('/v1/customers');
  });

  it('appends status filter to query string', async () => {
    await listCustomers({ status: 'active' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('status=active');
  });

  it('appends type filter to query string', async () => {
    await listCustomers({ type: 'company' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('type=company');
  });

  it('appends page and pageSize to query string', async () => {
    await listCustomers({ page: 2, pageSize: 50 });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
  });

  it('appends search term when provided', async () => {
    await listCustomers({ search: 'acme' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('search=acme');
  });

  it('omits search param when empty string', async () => {
    await listCustomers({ search: '' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).not.toContain('search');
  });

  it('appends lifecycleStage filter', async () => {
    await listCustomers({ lifecycleStage: 'qualified' });
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('lifecycleStage=qualified');
  });

  it('returns the full CustomerListResponse', async () => {
    const result = await listCustomers();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe('getCustomer', () => {
  it('calls GET /v1/customers/:id', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_CUSTOMER });
    await getCustomer('cust-1');
    expect(mockGet).toHaveBeenCalledWith('/v1/customers/cust-1');
  });

  it('returns the customer wrapped in success response', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_CUSTOMER });
    const result = await getCustomer('cust-1');
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('cust-1');
  });
});

describe('createCustomer', () => {
  it('calls POST /v1/customers with the body', async () => {
    const body = { type: 'company' as const, name: 'New Corp' };
    await createCustomer(body);
    expect(mockPost).toHaveBeenCalledWith('/v1/customers', body);
  });

  it('returns the created customer', async () => {
    const result = await createCustomer({ type: 'company', name: 'New Corp' });
    expect(result.data.id).toBe('cust-1');
  });
});

describe('updateCustomer', () => {
  it('calls PATCH /v1/customers/:id with the body', async () => {
    const body = { name: 'Updated Corp', status: 'inactive' as const };
    await updateCustomer('cust-1', body);
    expect(mockPatch).toHaveBeenCalledWith('/v1/customers/cust-1', body);
  });

  it('returns the updated customer', async () => {
    const result = await updateCustomer('cust-1', { name: 'Updated' });
    expect(result.data.id).toBe('cust-1');
  });
});

describe('deleteCustomer', () => {
  it('calls DELETE /v1/customers/:id', async () => {
    await deleteCustomer('cust-1');
    expect(mockDelete).toHaveBeenCalledWith('/v1/customers/cust-1');
  });

  it('returns void (resolves without a value)', async () => {
    await expect(deleteCustomer('cust-1')).resolves.toBeUndefined();
  });
});

describe('semanticSearchCustomers', () => {
  it('calls GET /v1/customers/search with encoded query and default limit 10', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });
    await semanticSearchCustomers('acme');
    expect(mockGet).toHaveBeenCalledWith('/v1/customers/search?q=acme&limit=10');
  });

  it('encodes special characters in the query', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });
    await semanticSearchCustomers('acme corp');
    const url = (mockGet.mock.calls[0] as string[])[0];
    expect(url).toContain('q=acme%20corp');
  });

  it('respects custom limit', async () => {
    mockGet.mockResolvedValue({ success: true, data: [] });
    await semanticSearchCustomers('test', 5);
    expect(mockGet).toHaveBeenCalledWith('/v1/customers/search?q=test&limit=5');
  });
});
