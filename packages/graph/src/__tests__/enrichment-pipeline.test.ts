import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EnrichmentPipeline,
  ClearbitProvider,
  ApolloProvider,
  InternalProvider,
} from '../enrichment-pipeline.js';
import { ok, err, InternalError, NotFoundError } from '@ordr/core';
import type { GraphOperations } from '../operations.js';
import type { GraphNode, EnrichmentProvider, EnrichmentData } from '../types.js';

// ─── Mock Operations ────────────────────────────────────────────

function createMockOperations(): GraphOperations {
  return {
    createNode: vi.fn(),
    getNode: vi.fn(),
    updateNode: vi.fn(),
    deleteNode: vi.fn(),
    createEdge: vi.fn(),
    getEdges: vi.fn(),
    deleteEdge: vi.fn(),
  } as unknown as GraphOperations;
}

// ─── Helpers ────────────────────────────────────────────────────

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'node-1',
    type: 'Person',
    tenantId: 'tenant-001',
    properties: { name: 'Test User', email: 'test@example.com' },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createPipeline(
  ops: GraphOperations,
  providers?: ReadonlyMap<string, EnrichmentProvider>,
): EnrichmentPipeline {
  const defaultProviders = new Map<string, EnrichmentProvider>([
    ['clearbit', new ClearbitProvider()],
    ['apollo', new ApolloProvider()],
    ['internal', new InternalProvider()],
  ]);

  return new EnrichmentPipeline({
    operations: ops,
    providers: providers ?? defaultProviders,
  });
}

// ─── Tests ──────────────────────────────────────────────────────

describe('EnrichmentPipeline', () => {
  let mockOps: GraphOperations;
  let pipeline: EnrichmentPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOps = createMockOperations();
    pipeline = createPipeline(mockOps);
  });

  // ─── enrichNode ─────────────────────────────────────────────

  describe('enrichNode()', () => {
    it('enriches a Person node using Apollo provider', async () => {
      const node = makeNode({ type: 'Person' });
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));

      const result = await pipeline.enrichNode('node-1', 'tenant-001', 'apollo');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('apollo');
        expect(result.data.confidence).toBeGreaterThan(0);
        expect(result.data.enrichedAt).toBeInstanceOf(Date);
      }
      expect(mockOps.updateNode).toHaveBeenCalledOnce();
    });

    it('enriches a Company node using Clearbit provider', async () => {
      const node = makeNode({ type: 'Company', properties: { domain: 'acme.com' } });
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));

      const result = await pipeline.enrichNode('node-1', 'tenant-001', 'clearbit');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('clearbit');
        expect(result.data.fields['industry']).toBe('Technology');
      }
    });

    it('auto-selects provider when source is not specified', async () => {
      const node = makeNode({ type: 'Person' });
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));

      const result = await pipeline.enrichNode('node-1', 'tenant-001');

      expect(result.success).toBe(true);
      // Apollo is the first provider that supports Person
      if (result.success) {
        expect(result.data.source).toBe('apollo');
      }
    });

    it('returns NotFoundError when node does not exist', async () => {
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(null));

      const result = await pipeline.enrichNode('missing-node', 'tenant-001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeInstanceOf(NotFoundError);
      }
    });

    it('rejects empty nodeId', async () => {
      const result = await pipeline.enrichNode('', 'tenant-001');

      expect(result.success).toBe(false);
    });

    it('rejects empty tenantId', async () => {
      const result = await pipeline.enrichNode('node-1', '');

      expect(result.success).toBe(false);
    });

    it('returns error when no provider supports the node type', async () => {
      const node = makeNode({ type: 'Campaign' });
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));

      // Use a provider map with only Clearbit (supports Company only)
      const limited = new Map<string, EnrichmentProvider>([
        ['clearbit', new ClearbitProvider()],
      ]);
      const limitedPipeline = createPipeline(mockOps, limited);

      const result = await limitedPipeline.enrichNode('node-1', 'tenant-001');

      expect(result.success).toBe(false);
    });

    it('writes enrichment metadata to node properties', async () => {
      const node = makeNode({ type: 'Person' });
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));

      await pipeline.enrichNode('node-1', 'tenant-001', 'apollo');

      const updateArgs = (mockOps.updateNode as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const properties = updateArgs[2] as Record<string, unknown>;
      expect(properties['_lastEnrichedBy']).toBe('apollo');
      expect(properties['_lastEnrichedAt']).toBeDefined();
      expect(properties['_enrichmentConfidence']).toBeGreaterThan(0);
    });

    it('propagates getNode errors', async () => {
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('DB down')),
      );

      const result = await pipeline.enrichNode('node-1', 'tenant-001');

      expect(result.success).toBe(false);
    });

    it('propagates updateNode errors', async () => {
      const node = makeNode({ type: 'Person' });
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('Write failed')),
      );

      const result = await pipeline.enrichNode('node-1', 'tenant-001', 'apollo');

      expect(result.success).toBe(false);
    });
  });

  // ─── enrichBatch ──────────────────────────────────────────

  describe('enrichBatch()', () => {
    it('enriches multiple nodes and returns success count', async () => {
      const node = makeNode({ type: 'Person' });
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(ok(node));
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValue(ok(node));

      const result = await pipeline.enrichBatch(
        ['node-1', 'node-2', 'node-3'],
        'tenant-001',
        'apollo',
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(3);
      }
    });

    it('returns 0 for empty batch', async () => {
      const result = await pipeline.enrichBatch([], 'tenant-001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(0);
      }
    });

    it('continues on individual node failure', async () => {
      const node = makeNode({ type: 'Person' });
      (mockOps.getNode as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(ok(node)) // node-1 succeeds
        .mockResolvedValueOnce(ok(null)) // node-2 not found
        .mockResolvedValueOnce(ok(node)); // node-3 succeeds
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValue(ok(node));

      const result = await pipeline.enrichBatch(
        ['node-1', 'node-2', 'node-3'],
        'tenant-001',
        'apollo',
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(2); // 2 of 3 succeeded
      }
    });

    it('rejects empty tenantId', async () => {
      const result = await pipeline.enrichBatch(['node-1'], '');

      expect(result.success).toBe(false);
    });
  });

  // ─── handleNewNode ────────────────────────────────────────

  describe('handleNewNode()', () => {
    it('enriches Person nodes on creation', async () => {
      const node = makeNode({ type: 'Person' });
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));

      await pipeline.handleNewNode({
        nodeId: 'node-1',
        nodeType: 'Person',
        tenantId: 'tenant-001',
      });

      expect(mockOps.getNode).toHaveBeenCalledOnce();
      expect(mockOps.updateNode).toHaveBeenCalledOnce();
    });

    it('enriches Company nodes on creation', async () => {
      const node = makeNode({ type: 'Company' });
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(node));

      await pipeline.handleNewNode({
        nodeId: 'node-2',
        nodeType: 'Company',
        tenantId: 'tenant-001',
      });

      expect(mockOps.getNode).toHaveBeenCalledOnce();
    });

    it('skips non-Person/Company node types', async () => {
      await pipeline.handleNewNode({
        nodeId: 'node-3',
        nodeType: 'Deal',
        tenantId: 'tenant-001',
      });

      expect(mockOps.getNode).not.toHaveBeenCalled();
    });

    it('skips when tenantId is empty', async () => {
      await pipeline.handleNewNode({
        nodeId: 'node-1',
        nodeType: 'Person',
        tenantId: '',
      });

      expect(mockOps.getNode).not.toHaveBeenCalled();
    });

    it('skips when nodeId is empty', async () => {
      await pipeline.handleNewNode({
        nodeId: '',
        nodeType: 'Person',
        tenantId: 'tenant-001',
      });

      expect(mockOps.getNode).not.toHaveBeenCalled();
    });

    it('does not throw on enrichment failure (best-effort)', async () => {
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        err(new InternalError('DB down')),
      );

      // Should not throw
      await expect(
        pipeline.handleNewNode({
          nodeId: 'node-1',
          nodeType: 'Person',
          tenantId: 'tenant-001',
        }),
      ).resolves.not.toThrow();
    });
  });

  // ─── Stub Providers ───────────────────────────────────────

  describe('ClearbitProvider', () => {
    it('returns company enrichment data', async () => {
      const provider = new ClearbitProvider();
      const node = makeNode({ type: 'Company', properties: { domain: 'test.com' } });

      const result = await provider.enrich(node);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('clearbit');
        expect(result.data.fields['industry']).toBeDefined();
        expect(result.data.fields['employeeCount']).toBeDefined();
        expect(result.data.confidence).toBeGreaterThan(0);
      }
    });

    it('supports Company node type only', () => {
      const provider = new ClearbitProvider();
      expect(provider.supportedNodeTypes).toContain('Company');
      expect(provider.supportedNodeTypes).not.toContain('Person');
    });
  });

  describe('ApolloProvider', () => {
    it('returns person enrichment data', async () => {
      const provider = new ApolloProvider();
      const node = makeNode({ type: 'Person' });

      const result = await provider.enrich(node);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('apollo');
        expect(result.data.fields['title']).toBeDefined();
        expect(result.data.fields['seniority']).toBeDefined();
      }
    });

    it('supports Person node type only', () => {
      const provider = new ApolloProvider();
      expect(provider.supportedNodeTypes).toContain('Person');
      expect(provider.supportedNodeTypes).not.toContain('Company');
    });
  });

  describe('InternalProvider', () => {
    it('returns internal graph enrichment data', async () => {
      const provider = new InternalProvider();
      const node = makeNode({
        type: 'Person',
        properties: { influence_score: 0.8, community_id: 3 },
      });

      const result = await provider.enrich(node);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.source).toBe('internal');
        expect(result.data.confidence).toBe(1.0);
        expect(result.data.fields['_graphEnriched']).toBe(true);
      }
    });

    it('supports multiple node types', () => {
      const provider = new InternalProvider();
      expect(provider.supportedNodeTypes).toContain('Person');
      expect(provider.supportedNodeTypes).toContain('Company');
      expect(provider.supportedNodeTypes).toContain('Deal');
    });
  });

  // ─── Idempotency ──────────────────────────────────────────

  describe('idempotency', () => {
    it('enriching the same node twice produces consistent results', async () => {
      const node = makeNode({ type: 'Person' });
      (mockOps.getNode as ReturnType<typeof vi.fn>).mockResolvedValue(ok(node));
      (mockOps.updateNode as ReturnType<typeof vi.fn>).mockResolvedValue(ok(node));

      const result1 = await pipeline.enrichNode('node-1', 'tenant-001', 'apollo');
      const result2 = await pipeline.enrichNode('node-1', 'tenant-001', 'apollo');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      if (result1.success && result2.success) {
        expect(result1.data.source).toBe(result2.data.source);
        expect(result1.data.fields).toEqual(result2.data.fields);
      }
    });
  });
});
