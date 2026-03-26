import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphClient } from '../client.js';
import type { GraphClientConfig } from '../client.js';

// ─── Mock Neo4j Driver ───────────────────────────────────────────
// vi.mock is hoisted — the factory must be self-contained.
// We use vi.hoisted() to declare mocks that can be referenced in both
// the vi.mock factory and the test body.

const { mockSession, mockDriver } = vi.hoisted(() => {
  const mockSession = {
    run: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const mockDriver = {
    getServerInfo: vi.fn().mockResolvedValue({ address: 'localhost:7687' }),
    session: vi.fn().mockReturnValue(mockSession),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { mockSession, mockDriver };
});

vi.mock('neo4j-driver', () => ({
  default: {
    driver: vi.fn().mockReturnValue(mockDriver),
    auth: {
      basic: vi.fn().mockReturnValue({ scheme: 'basic' }),
    },
    session: {
      READ: 'READ',
      WRITE: 'WRITE',
    },
  },
}));

// ─── Test Config ─────────────────────────────────────────────────

const testConfig: GraphClientConfig = {
  uri: 'bolt://localhost:7687',
  username: 'neo4j',
  password: 'test-password',
  database: 'testdb',
};

// ─── Tests ───────────────────────────────────────────────────────

describe('GraphClient', () => {
  let client: GraphClient;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set defaults that clearAllMocks removed
    mockSession.close.mockResolvedValue(undefined);
    mockDriver.getServerInfo.mockResolvedValue({ address: 'localhost:7687' });
    mockDriver.session.mockReturnValue(mockSession);
    mockDriver.close.mockResolvedValue(undefined);

    client = new GraphClient(testConfig);
  });

  describe('connect()', () => {
    it('establishes connection and performs health check', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it('throws InternalError on connection failure', async () => {
      mockDriver.getServerInfo.mockRejectedValueOnce(
        new Error('Connection refused'),
      );

      const freshClient = new GraphClient(testConfig);
      await expect(freshClient.connect()).rejects.toThrow(
        'Neo4j connection failed',
      );
      expect(freshClient.isConnected()).toBe(false);
    });
  });

  describe('close()', () => {
    it('closes driver and marks client as disconnected', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);

      await client.close();
      expect(client.isConnected()).toBe(false);
    });

    it('is safe to call when not connected', async () => {
      await expect(client.close()).resolves.not.toThrow();
    });
  });

  describe('runQuery()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('returns error when client is not connected', async () => {
      await client.close();

      const result = await client.runQuery(
        'MATCH (n) RETURN n',
        {},
        'tenant-001',
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not connected');
      }
    });

    it('rejects empty tenantId', async () => {
      const result = await client.runQuery('MATCH (n) RETURN n', {}, '');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('tenantId');
      }
    });

    it('rejects whitespace-only tenantId', async () => {
      const result = await client.runQuery('MATCH (n) RETURN n', {}, '   ');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('tenantId');
      }
    });

    it('injects tenantId into query parameters', async () => {
      mockSession.run.mockResolvedValueOnce({
        records: [],
      });

      await client.runQuery(
        'MATCH (n {tenantId: $tenantId}) RETURN n',
        { extra: 'param' },
        'tenant-001',
      );

      expect(mockSession.run).toHaveBeenCalledWith(
        'MATCH (n {tenantId: $tenantId}) RETURN n',
        { extra: 'param', tenantId: 'tenant-001' },
        { timeout: 10_000 },
      );
    });

    it('returns mapped records on success', async () => {
      const mockRecord = {
        toObject: () => ({ id: 'node-1', name: 'Test' }),
      };
      mockSession.run.mockResolvedValueOnce({
        records: [mockRecord],
      });

      const result = await client.runQuery(
        'MATCH (n) RETURN n',
        {},
        'tenant-001',
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toEqual({ id: 'node-1', name: 'Test' });
      }
    });

    it('returns InternalError on query failure', async () => {
      mockSession.run.mockRejectedValueOnce(new Error('Timeout'));

      const result = await client.runQuery(
        'MATCH (n) RETURN n',
        {},
        'tenant-001',
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('Graph query failed');
      }
    });

    it('always closes the session after query', async () => {
      mockSession.run.mockRejectedValueOnce(new Error('Fail'));

      await client.runQuery('MATCH (n) RETURN n', {}, 'tenant-001');

      expect(mockSession.close).toHaveBeenCalled();
    });
  });

  describe('runWriteQuery()', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('returns error when client is not connected', async () => {
      await client.close();

      const result = await client.runWriteQuery(
        'CREATE (n) RETURN n',
        {},
        'tenant-001',
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('not connected');
      }
    });

    it('executes write query with tenant isolation', async () => {
      mockSession.run.mockResolvedValueOnce({
        records: [],
      });

      await client.runWriteQuery(
        'CREATE (n {tenantId: $tenantId}) RETURN n',
        { name: 'Test' },
        'tenant-002',
      );

      expect(mockSession.run).toHaveBeenCalledWith(
        'CREATE (n {tenantId: $tenantId}) RETURN n',
        { name: 'Test', tenantId: 'tenant-002' },
        { timeout: 10_000 },
      );
    });
  });

  describe('isConnected()', () => {
    it('returns false before connect', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('returns true after connect', async () => {
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it('returns false after close', async () => {
      await client.connect();
      await client.close();
      expect(client.isConnected()).toBe(false);
    });
  });
});
