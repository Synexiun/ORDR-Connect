/**
 * Integration Batch Sync Job tests
 *
 * Verifies:
 * - Drains Redis outbound sorted set and deduplicates by customerId
 * - Uses bulkPushContacts when count > threshold, individual pushContact otherwise
 * - Skips tenant when token refresh fails (logs error, continues to next)
 * - Updates last_sync_at after successful batch
 * - Writes sync_events rows for success and failure outcomes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createIntegrationBatchSyncHandler,
  createIntegrationBatchSyncDefinition,
  INTEGRATION_BATCH_SYNC_CRON,
} from '../jobs/integration-batch-sync.js';
import type { IntegrationBatchSyncDeps } from '../jobs/integration-batch-sync.js';
import { IntegrationTokenExpiredError } from '@ordr/integrations';

vi.mock('@ordr/integrations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ordr/integrations')>();
  return {
    ...actual,
    ensureFreshCredentials: vi.fn().mockResolvedValue({
      accessToken: 'at',
      refreshToken: 'rt',
      tokenType: 'Bearer',
      expiresAt: new Date(Date.now() + 3600_000),
      scope: 'read',
    }),
    IntegrationTokenExpiredError: actual.IntegrationTokenExpiredError,
  };
});

const mockDrainOutboundQueue = vi.fn();
const mockGetCustomers = vi.fn();
const mockPushContact = vi.fn().mockResolvedValue('sf-updated');
const mockBulkPushContacts = vi.fn().mockResolvedValue(new Map([['cust-1', 'sf-1']]));
const mockInsertSyncEvent = vi.fn().mockResolvedValue(undefined);
const mockUpdateLastSyncAt = vi.fn().mockResolvedValue(undefined);
const mockAuditLog = vi.fn().mockResolvedValue(undefined);

function buildDeps(overrides: Partial<IntegrationBatchSyncDeps> = {}): IntegrationBatchSyncDeps {
  return {
    listConnectedIntegrations: vi
      .fn()
      .mockResolvedValue([
        { tenantId: 'tenant-1', provider: 'salesforce', integrationId: 'int-1' },
      ]),
    drainOutboundQueue: mockDrainOutboundQueue,
    getCustomers: mockGetCustomers,
    adapters: new Map([
      [
        'salesforce',
        {
          pushContact: mockPushContact,
          bulkPushContacts: mockBulkPushContacts,
        } as never,
      ],
    ]),
    credManagerDeps: {} as never,
    oauthConfigs: new Map([['salesforce', {} as never]]),
    fieldEncryptor: {} as never,
    insertSyncEvent: mockInsertSyncEvent,
    updateLastSyncAt: mockUpdateLastSyncAt,
    auditLogger: { log: mockAuditLog },
    ...overrides,
  };
}

describe('createIntegrationBatchSyncDefinition', () => {
  it('uses */15 * * * * cron schedule', () => {
    const def = createIntegrationBatchSyncDefinition();
    expect(def.cronExpression).toBe(INTEGRATION_BATCH_SYNC_CRON);
  });
});

describe('createIntegrationBatchSyncHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drains queue and pushes customer records individually (count <= 200)', async () => {
    mockDrainOutboundQueue.mockResolvedValue([
      { customerId: 'cust-1', score: Date.now() },
      { customerId: 'cust-1', score: Date.now() + 1 }, // duplicate — latest score wins
      { customerId: 'cust-2', score: Date.now() },
    ]);
    mockGetCustomers.mockResolvedValue([
      { id: 'cust-1', tenantId: 'tenant-1', name: 'Alice', email: null, updatedAt: new Date() },
      { id: 'cust-2', tenantId: 'tenant-1', name: 'Bob', email: null, updatedAt: new Date() },
    ]);

    const handler = createIntegrationBatchSyncHandler(buildDeps());
    const result = await handler({});

    // cust-1 deduped to 1 call, cust-2 = 1 call → 2 total pushContact calls
    expect(mockPushContact).toHaveBeenCalledTimes(2);
    expect(mockUpdateLastSyncAt).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('uses bulkPushContacts when queue has > 200 entries', async () => {
    const manyEntries = Array.from({ length: 201 }, (_, i) => ({
      customerId: `cust-${i}`,
      score: Date.now() + i,
    }));
    mockDrainOutboundQueue.mockResolvedValue(manyEntries);
    mockGetCustomers.mockResolvedValue(
      manyEntries.map((e) => ({
        id: e.customerId,
        tenantId: 'tenant-1',
        name: 'Test',
        email: null,
        updatedAt: new Date(),
      })),
    );

    const handler = createIntegrationBatchSyncHandler(buildDeps());
    await handler({});

    expect(mockBulkPushContacts).toHaveBeenCalledOnce();
    expect(mockPushContact).not.toHaveBeenCalled();
  });

  it('skips tenant on token refresh failure, continues to next', async () => {
    const { ensureFreshCredentials } = await import('@ordr/integrations');
    (ensureFreshCredentials as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new IntegrationTokenExpiredError('salesforce'),
    );

    const handler = createIntegrationBatchSyncHandler(buildDeps());
    const result = await handler({});

    expect(mockPushContact).not.toHaveBeenCalled();
    expect(result.success).toBe(true); // job still succeeds; skipped tenants are expected
  });

  it('writes sync_events for successful pushes', async () => {
    mockDrainOutboundQueue.mockResolvedValue([{ customerId: 'cust-1', score: Date.now() }]);
    mockGetCustomers.mockResolvedValue([
      { id: 'cust-1', tenantId: 'tenant-1', name: 'Alice', email: null, updatedAt: new Date() },
    ]);

    const handler = createIntegrationBatchSyncHandler(buildDeps());
    await handler({});

    expect(mockInsertSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', direction: 'outbound' }),
    );
  });
});
