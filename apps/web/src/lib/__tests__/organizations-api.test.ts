/**
 * Organizations API Tests
 *
 * Validates:
 * - listOrganizations → GET /v1/organizations
 * - getOrganization → GET /v1/organizations/:id
 * - createOrganization → POST /v1/organizations
 * - updateOrganization → PATCH /v1/organizations/:id
 * - deleteOrganization → DELETE /v1/organizations/:id (void)
 * - getOrganizationHierarchy → GET /v1/organizations/:id/hierarchy
 *
 * COMPLIANCE: No PHI. SOC2 CC6.1.
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
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  deleteOrganization,
  getOrganizationHierarchy,
} from '../organizations-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_ORG = {
  id: 'org-test-1',
  tenantId: 'tenant-1',
  name: 'Test Organization',
  slug: 'test-org',
  parentId: null,
  metadata: {},
  createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  updatedAt: new Date('2026-03-28T00:00:00Z').toISOString(),
};

const MOCK_ORG_NODE = {
  ...MOCK_ORG,
  children: [
    {
      ...MOCK_ORG,
      id: 'org-test-2',
      name: 'Child Organization',
      slug: 'child-org',
      parentId: 'org-test-1',
      children: [],
    },
  ],
};

const MOCK_LIST_RESPONSE = {
  success: true as const,
  data: [MOCK_ORG],
  total: 1,
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(MOCK_LIST_RESPONSE);
  mockPost.mockResolvedValue({ success: true, data: MOCK_ORG });
  mockPatch.mockResolvedValue({ success: true, data: MOCK_ORG });
  mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('listOrganizations', () => {
  it('calls GET /v1/organizations', async () => {
    await listOrganizations();
    expect(mockGet).toHaveBeenCalledWith('/v1/organizations');
  });

  it('returns OrganizationListResponse with data array', async () => {
    const result = await listOrganizations();
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('org-test-1');
  });
});

describe('getOrganization', () => {
  it('calls GET /v1/organizations/:id', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_ORG });
    await getOrganization('org-test-1');
    expect(mockGet).toHaveBeenCalledWith('/v1/organizations/org-test-1');
  });

  it('returns wrapped organization on success', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_ORG });
    const result = await getOrganization('org-test-1');
    expect(result.data.name).toBe('Test Organization');
    expect(result.data.slug).toBe('test-org');
  });
});

describe('createOrganization', () => {
  it('calls POST /v1/organizations with body', async () => {
    await createOrganization({ name: 'New Org', slug: 'new-org' });
    expect(mockPost).toHaveBeenCalledWith('/v1/organizations', {
      name: 'New Org',
      slug: 'new-org',
    });
  });

  it('includes parentId when provided', async () => {
    await createOrganization({ name: 'Child Org', slug: 'child-org', parentId: 'org-test-1' });
    expect(mockPost).toHaveBeenCalledWith(
      '/v1/organizations',
      expect.objectContaining({ parentId: 'org-test-1' }),
    );
  });

  it('returns wrapped created organization on success', async () => {
    const result = await createOrganization({ name: 'New Org', slug: 'new-org' });
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('org-test-1');
  });
});

describe('updateOrganization', () => {
  it('calls PATCH /v1/organizations/:id with partial body', async () => {
    await updateOrganization('org-test-1', { name: 'Updated Name' });
    expect(mockPatch).toHaveBeenCalledWith('/v1/organizations/org-test-1', {
      name: 'Updated Name',
    });
  });

  it('returns updated organization on success', async () => {
    const result = await updateOrganization('org-test-1', { slug: 'updated-slug' });
    expect(result.success).toBe(true);
    expect(result.data.id).toBe('org-test-1');
  });
});

describe('deleteOrganization', () => {
  it('calls DELETE /v1/organizations/:id', async () => {
    await deleteOrganization('org-test-1');
    expect(mockDelete).toHaveBeenCalledWith('/v1/organizations/org-test-1');
  });

  it('returns void on success', async () => {
    await expect(deleteOrganization('org-test-1')).resolves.toBeUndefined();
  });
});

describe('getOrganizationHierarchy', () => {
  it('calls GET /v1/organizations/:id/hierarchy', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_ORG_NODE });
    await getOrganizationHierarchy('org-test-1');
    expect(mockGet).toHaveBeenCalledWith('/v1/organizations/org-test-1/hierarchy');
  });

  it('returns organization tree with nested children', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_ORG_NODE });
    const result = await getOrganizationHierarchy('org-test-1');
    expect(result.data.id).toBe('org-test-1');
    expect(result.data.children).toHaveLength(1);
    expect(result.data.children[0].id).toBe('org-test-2');
  });
});
