/**
 * Developer API Tests
 *
 * Validates:
 * - getDeveloperProfile → GET /v1/developers/me
 * - createApiKey → POST /v1/developers/keys (with/without expiresInDays)
 * - listApiKeys → GET /v1/developers/keys
 * - revokeApiKey → DELETE /v1/developers/keys/:keyId (void)
 * - createSandbox → POST /v1/developers/sandbox (with/without seedProfile)
 * - listSandboxes → GET /v1/developers/sandbox
 * - destroySandbox → DELETE /v1/developers/sandbox/:sandboxId (void)
 * - getDeveloperUsage → GET /v1/developers/usage?days=:n (default 7)
 *
 * COMPLIANCE: No PHI. API keys are test fixtures only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('../api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: vi.fn(),
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

import {
  getDeveloperProfile,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  createSandbox,
  listSandboxes,
  destroySandbox,
  getDeveloperUsage,
} from '../developer-api';

// ─── Fixtures ────────────────────────────────────────────────────

const MOCK_DEVELOPER = {
  id: 'dev-test-1',
  email: 'dev@test.com',
  name: 'Test Dev',
  organization: 'Test Org',
  tier: 'pro' as const,
  createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
};

const MOCK_API_KEY = {
  id: 'key-test-1',
  developerId: 'dev-test-1',
  name: 'Test Key',
  keyPrefix: 'ordr_test_abc1',
  createdAt: new Date('2026-03-01T00:00:00Z').toISOString(),
  expiresAt: new Date('2026-06-01T00:00:00Z').toISOString(),
  lastUsedAt: null,
  isActive: true,
};

const MOCK_API_KEY_CREATED = {
  ...MOCK_API_KEY,
  rawKey: 'ordr_test_abc1_XXXXXXXXXXXX',
};

const MOCK_SANDBOX = {
  id: 'sandbox-test-1',
  developerId: 'dev-test-1',
  tenantId: 'tenant-sandbox-1',
  name: 'Test Sandbox',
  seedDataProfile: 'standard',
  status: 'active' as const,
  createdAt: new Date('2026-03-28T00:00:00Z').toISOString(),
  expiresAt: new Date('2026-04-28T00:00:00Z').toISOString(),
};

const MOCK_USAGE = {
  stats: { totalCalls: 1000, totalErrors: 5, callsToday: 42, errorsToday: 1 },
  daily: [{ label: '2026-03-28', calls: 42, errors: 1 }],
  endpoints: [{ endpoint: '/v1/customers', calls: 300 }],
};

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ success: true, data: MOCK_DEVELOPER });
  mockPost.mockResolvedValue({ success: true, data: MOCK_API_KEY_CREATED });
  mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('getDeveloperProfile', () => {
  it('calls GET /v1/developers/me', async () => {
    await getDeveloperProfile();
    expect(mockGet).toHaveBeenCalledWith('/v1/developers/me');
  });

  it('returns wrapped developer profile on success', async () => {
    const result = await getDeveloperProfile();
    expect(result.data.id).toBe('dev-test-1');
    expect(result.data.tier).toBe('pro');
  });
});

describe('createApiKey', () => {
  it('calls POST /v1/developers/keys with name', async () => {
    await createApiKey({ name: 'My Key' });
    expect(mockPost).toHaveBeenCalledWith('/v1/developers/keys', { name: 'My Key' });
  });

  it('includes expiresInDays when provided', async () => {
    await createApiKey({ name: 'Expiring Key', expiresInDays: 30 });
    expect(mockPost).toHaveBeenCalledWith(
      '/v1/developers/keys',
      expect.objectContaining({ expiresInDays: 30 }),
    );
  });

  it('returns ApiKeyCreated with rawKey on success', async () => {
    const result = await createApiKey({ name: 'Test Key' });
    expect(result.data.id).toBe('key-test-1');
    expect(result.data.rawKey).toBeTruthy();
    expect(result.data.isActive).toBe(true);
  });
});

describe('listApiKeys', () => {
  it('calls GET /v1/developers/keys', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_API_KEY] });
    await listApiKeys();
    expect(mockGet).toHaveBeenCalledWith('/v1/developers/keys');
  });

  it('returns array of API keys on success', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_API_KEY] });
    const result = await listApiKeys();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.keyPrefix).toBe('ordr_test_abc1');
  });
});

describe('revokeApiKey', () => {
  it('calls DELETE /v1/developers/keys/:keyId', async () => {
    await revokeApiKey('key-test-1');
    expect(mockDelete).toHaveBeenCalledWith('/v1/developers/keys/key-test-1');
  });

  it('returns void on success', async () => {
    await expect(revokeApiKey('key-test-1')).resolves.toBeUndefined();
  });
});

describe('createSandbox', () => {
  it('calls POST /v1/developers/sandbox with name', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_SANDBOX });
    await createSandbox({ name: 'Test Sandbox' });
    expect(mockPost).toHaveBeenCalledWith('/v1/developers/sandbox', { name: 'Test Sandbox' });
  });

  it('includes seedProfile when provided', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_SANDBOX });
    await createSandbox({ name: 'Test Sandbox', seedProfile: 'healthcare' });
    expect(mockPost).toHaveBeenCalledWith(
      '/v1/developers/sandbox',
      expect.objectContaining({ seedProfile: 'healthcare' }),
    );
  });

  it('returns wrapped SandboxTenant with active status', async () => {
    mockPost.mockResolvedValue({ success: true, data: MOCK_SANDBOX });
    const result = await createSandbox({ name: 'Test Sandbox' });
    expect(result.data.status).toBe('active');
    expect(result.data.id).toBe('sandbox-test-1');
  });
});

describe('listSandboxes', () => {
  it('calls GET /v1/developers/sandbox', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_SANDBOX] });
    await listSandboxes();
    expect(mockGet).toHaveBeenCalledWith('/v1/developers/sandbox');
  });

  it('returns array of sandboxes on success', async () => {
    mockGet.mockResolvedValue({ success: true, data: [MOCK_SANDBOX] });
    const result = await listSandboxes();
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.name).toBe('Test Sandbox');
  });
});

describe('destroySandbox', () => {
  it('calls DELETE /v1/developers/sandbox/:sandboxId', async () => {
    await destroySandbox('sandbox-test-1');
    expect(mockDelete).toHaveBeenCalledWith('/v1/developers/sandbox/sandbox-test-1');
  });

  it('returns void on success', async () => {
    await expect(destroySandbox('sandbox-test-1')).resolves.toBeUndefined();
  });
});

describe('getDeveloperUsage', () => {
  it('calls GET /v1/developers/usage?days=7 by default', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_USAGE });
    await getDeveloperUsage();
    expect(mockGet).toHaveBeenCalledWith('/v1/developers/usage?days=7');
  });

  it('uses custom days parameter when provided', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_USAGE });
    await getDeveloperUsage(30);
    expect(mockGet).toHaveBeenCalledWith('/v1/developers/usage?days=30');
  });

  it('returns usage stats with daily breakdown', async () => {
    mockGet.mockResolvedValue({ success: true, data: MOCK_USAGE });
    const result = await getDeveloperUsage();
    expect(result.data.stats.totalCalls).toBe(1000);
    expect(result.data.daily).toHaveLength(1);
    expect(result.data.endpoints).toHaveLength(1);
  });
});
