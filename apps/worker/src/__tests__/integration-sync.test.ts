/**
 * Integration Sync Handler tests
 *
 * Verifies:
 * - customer.created: pushes to all connected providers, inserts entity mapping + sync_events
 * - customer.created: logs sync_failed when adapter.pushContact throws
 * - customer.updated: enqueues in Redis (does not call adapter), audit log emitted
 * - webhook_received (new record): creates customer + entity mapping
 * - webhook_received (known, CRM newer): applies delta, inserts success sync_event
 * - webhook_received (conflict, within 5 min): applies delta, inserts conflict sync_event, notifies admin
 * - webhook_received (ORDR newer, > 5 min): skips, inserts skipped sync_event
 * - webhook_received (non-contact entity): no-ops
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIntegrationSyncHandler } from '../handlers/integration-sync.js';
import type { IntegrationSyncDeps } from '../handlers/integration-sync.js';
import type { EventEnvelope } from '@ordr/events';

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
    IntegrationNotConnectedError: actual.IntegrationNotConnectedError,
  };
});

const TENANT_ID = 'tenant-1';
const CUSTOMER_ID = 'cust-1';
const PROVIDER = 'salesforce';
const INTEGRATION_ID = 'int-1';
const EXTERNAL_ID = 'sf-001';

function makeCustomer(updatedMsAgo = 60_000) {
  return {
    id: CUSTOMER_ID,
    tenantId: TENANT_ID,
    name: 'Alice Tester',
    email: 'alice@test.com',
    updatedAt: new Date(Date.now() - updatedMsAgo),
  };
}

const mockPushContact = vi.fn().mockResolvedValue(EXTERNAL_ID);
const mockInsertSyncEvent = vi.fn().mockResolvedValue(undefined);
const mockInsertEntityMapping = vi.fn().mockResolvedValue(undefined);
const mockEnqueueOutbound = vi.fn().mockResolvedValue(undefined);
const mockFindEntityMapping = vi.fn();
const mockCreateCustomerFromCrm = vi.fn().mockResolvedValue('new-cust-1');
const mockApplyCustomerDelta = vi.fn().mockResolvedValue(undefined);
const mockGetIntegrationId = vi.fn().mockResolvedValue(INTEGRATION_ID);
const mockNotifyAdmin = vi.fn().mockResolvedValue(undefined);
const mockAuditLog = vi.fn().mockResolvedValue(undefined);

function buildDeps(): IntegrationSyncDeps {
  return {
    listConnectedProviders: vi.fn().mockResolvedValue([
      {
        tenantId: TENANT_ID,
        provider: PROVIDER,
        integrationId: INTEGRATION_ID,
      },
    ]),
    getCustomer: vi.fn().mockResolvedValue(makeCustomer()),
    enqueueOutbound: mockEnqueueOutbound,
    insertSyncEvent: mockInsertSyncEvent,
    findEntityMapping: mockFindEntityMapping,
    insertEntityMapping: mockInsertEntityMapping,
    createCustomerFromCrm: mockCreateCustomerFromCrm,
    applyCustomerDelta: mockApplyCustomerDelta,
    getIntegrationId: mockGetIntegrationId,
    notifyTenantAdmin: mockNotifyAdmin,
    adapters: new Map([[PROVIDER, { pushContact: mockPushContact } as never]]),
    credManagerDeps: {} as never,
    oauthConfigs: new Map([[PROVIDER, {} as never]]),
    fieldEncryptor: {} as never,
    auditLogger: { log: mockAuditLog },
  };
}

function makeEnvelope<T>(type: string, payload: T, timestampOverride?: string): EventEnvelope<T> {
  return {
    id: 'evt-1',
    type,
    tenantId: TENANT_ID,
    payload,
    metadata: { correlationId: 'corr-1', causationId: 'ca-1', source: 'api', version: 1 },
    timestamp: timestampOverride ?? new Date().toISOString(),
  };
}

describe('createIntegrationSyncHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('customer.created', () => {
    it('pushes to connected providers and inserts entity mapping + sync_events', async () => {
      mockFindEntityMapping.mockResolvedValue(null);
      const handler = createIntegrationSyncHandler(buildDeps());
      await handler(makeEnvelope('customer.created', { customerId: CUSTOMER_ID }) as never);

      expect(mockPushContact).toHaveBeenCalledOnce();
      expect(mockInsertEntityMapping).toHaveBeenCalledWith(
        expect.objectContaining({ ordrId: CUSTOMER_ID, externalId: EXTERNAL_ID }),
      );
      expect(mockInsertSyncEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', direction: 'outbound' }),
      );
    });

    it('logs sync_failed when pushContact throws', async () => {
      mockPushContact.mockRejectedValueOnce(new Error('API error'));
      const handler = createIntegrationSyncHandler(buildDeps());
      await handler(makeEnvelope('customer.created', { customerId: CUSTOMER_ID }) as never);

      expect(mockInsertSyncEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      );
      const auditCalls = mockAuditLog.mock.calls as Array<[{ eventType: string }]>;
      expect(auditCalls.some(([e]) => e.eventType === 'integration.sync_failed')).toBe(true);
    });
  });

  describe('customer.updated', () => {
    it('enqueues customerId in Redis sorted set, does not call adapter, emits audit', async () => {
      const handler = createIntegrationSyncHandler(buildDeps());
      await handler(makeEnvelope('customer.updated', { customerId: CUSTOMER_ID }) as never);

      expect(mockEnqueueOutbound).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: CUSTOMER_ID, provider: PROVIDER }),
      );
      expect(mockPushContact).not.toHaveBeenCalled();
      const auditCalls = mockAuditLog.mock.calls as Array<[{ eventType: string }]>;
      expect(auditCalls.some(([e]) => e.eventType === 'integration.outbound_enqueued')).toBe(true);
    });
  });

  describe('integration.webhook_received', () => {
    const basePayload = {
      tenantId: TENANT_ID,
      provider: PROVIDER,
      entityType: 'contact' as const,
      externalId: EXTERNAL_ID,
      eventType: 'contact.created',
      webhookLogId: 'wh-1',
    };

    it('creates customer + entity mapping when external_id is unknown', async () => {
      mockFindEntityMapping.mockResolvedValue(null);
      const handler = createIntegrationSyncHandler(buildDeps());
      await handler(makeEnvelope('integration.webhook_received', basePayload) as never);

      expect(mockCreateCustomerFromCrm).toHaveBeenCalled();
      expect(mockInsertEntityMapping).toHaveBeenCalled();
      expect(mockInsertSyncEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', direction: 'inbound' }),
      );
    });

    it('applies delta and inserts success sync_event when CRM event is newer than customer', async () => {
      mockFindEntityMapping.mockResolvedValue({ ordrId: CUSTOMER_ID });
      const deps = buildDeps();
      // Customer updated 10 minutes ago → CRM event timestamp (now) is newer
      (deps.getCustomer as ReturnType<typeof vi.fn>).mockResolvedValue(
        makeCustomer(10 * 60 * 1000),
      );

      const handler = createIntegrationSyncHandler(deps);
      // Event timestamp = now → newer than customer.updatedAt (10 min ago)
      await handler(
        makeEnvelope(
          'integration.webhook_received',
          basePayload,
          new Date().toISOString(),
        ) as never,
      );

      expect(mockApplyCustomerDelta).toHaveBeenCalled();
      expect(mockInsertSyncEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', direction: 'inbound' }),
      );
    });

    it('detects conflict (within 5-min window): applies delta, inserts conflict event, notifies admin', async () => {
      mockFindEntityMapping.mockResolvedValue({ ordrId: CUSTOMER_ID });
      const deps = buildDeps();
      // Customer updated 2 min in the future → ORDR is newer, delta < 5 min → conflict
      const futureCustomer = {
        ...makeCustomer(0),
        updatedAt: new Date(Date.now() + 2 * 60 * 1000),
      };
      (deps.getCustomer as ReturnType<typeof vi.fn>).mockResolvedValue(futureCustomer);

      const handler = createIntegrationSyncHandler(deps);
      await handler(
        makeEnvelope(
          'integration.webhook_received',
          basePayload,
          new Date().toISOString(),
        ) as never,
      );

      expect(mockApplyCustomerDelta).toHaveBeenCalled();
      expect(mockInsertSyncEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'conflict', conflictResolution: 'crm_wins' }),
      );
      expect(mockNotifyAdmin).toHaveBeenCalled();
    });

    it('skips when ORDR is newer by more than 5 minutes', async () => {
      mockFindEntityMapping.mockResolvedValue({ ordrId: CUSTOMER_ID });
      const deps = buildDeps();
      // Customer updated 10 min in the future → ORDR is newer by 10 min → skip
      (deps.getCustomer as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...makeCustomer(0),
        updatedAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      const handler = createIntegrationSyncHandler(deps);
      await handler(
        makeEnvelope(
          'integration.webhook_received',
          basePayload,
          new Date().toISOString(),
        ) as never,
      );

      expect(mockApplyCustomerDelta).not.toHaveBeenCalled();
      expect(mockInsertSyncEvent).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'skipped' }),
      );
    });

    it('no-ops for non-contact entity type', async () => {
      const handler = createIntegrationSyncHandler(buildDeps());
      await handler(
        makeEnvelope('integration.webhook_received', {
          ...basePayload,
          entityType: 'deal' as never,
        }) as never,
      );

      expect(mockFindEntityMapping).not.toHaveBeenCalled();
      expect(mockInsertSyncEvent).not.toHaveBeenCalled();
    });
  });
});
