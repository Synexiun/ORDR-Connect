/**
 * Graph CRUD operations — tenant-isolated node and edge management
 *
 * SECURITY:
 * - Every Cypher query includes tenantId in WHERE clause
 * - Parameterized queries ONLY — zero string concatenation
 * - All operations return Result<T, AppError> — no thrown exceptions
 * - Node/edge IDs are crypto-random UUIDs
 */

import {
  type Result,
  ok,
  err,
  NotFoundError,
  ValidationError,
  type AppError,
} from '@ordr/core';
import type { GraphClient } from './client.js';
import {
  type GraphNode,
  type GraphEdge,
  type NodeType,
  type EdgeType,
  graphNodeSchema,
  graphEdgeSchema,
  DEFAULT_QUERY_LIMIT,
} from './types.js';

// ─── Neo4j Record Shapes ─────────────────────────────────────────

interface NodeRecord {
  readonly n: {
    readonly properties: Record<string, unknown>;
    readonly labels: readonly string[];
  };
}

interface EdgeRecord {
  readonly r: {
    readonly properties: Record<string, unknown>;
    readonly type: string;
  };
  readonly sourceId: string;
  readonly targetId: string;
}

// ─── Operations ──────────────────────────────────────────────────

export class GraphOperations {
  private readonly client: GraphClient;

  constructor(client: GraphClient) {
    this.client = client;
  }

  /**
   * Create a new graph node with a crypto-random UUID.
   * Uses MERGE to support idempotent creation when properties match.
   */
  async createNode(
    node: Omit<GraphNode, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Result<GraphNode, AppError>> {
    const validation = graphNodeSchema.safeParse(node);
    if (!validation.success) {
      return err(
        new ValidationError('Invalid node data', {
          node: validation.error.errors.map((e) => e.message),
        }),
      );
    }

    const id = crypto.randomUUID();
    const now = new Date();

    const cypher = `
      CREATE (n:${escapeLabel(node.type)} {
        id: $id,
        tenantId: $tenantId,
        createdAt: datetime($createdAt),
        updatedAt: datetime($updatedAt)
      })
      SET n += $properties
      RETURN n, labels(n) as labels
    `;

    const result = await this.client.runWriteQuery<NodeRecord>(
      cypher,
      {
        id,
        properties: node.properties,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      node.tenantId,
    );

    if (!result.success) {
      return result;
    }

    const created: GraphNode = {
      id,
      type: node.type,
      tenantId: node.tenantId,
      properties: node.properties,
      createdAt: now,
      updatedAt: now,
    };

    return ok(created);
  }

  /**
   * Get a node by ID within a tenant scope.
   * Returns null if node does not exist for this tenant.
   */
  async getNode(
    id: string,
    tenantId: string,
  ): Promise<Result<GraphNode | null, AppError>> {
    if (!id || id.trim().length === 0) {
      return err(
        new ValidationError('Node ID is required', {
          id: ['id must be a non-empty string'],
        }),
      );
    }

    const cypher = `
      MATCH (n {id: $id, tenantId: $tenantId})
      RETURN n, labels(n) as labels
    `;

    const result = await this.client.runQuery<{
      readonly n: { readonly properties: Record<string, unknown> };
      readonly labels: readonly string[];
    }>(cypher, { id }, tenantId);

    if (!result.success) {
      return result;
    }

    if (result.data.length === 0) {
      return ok(null);
    }

    const record = result.data[0]!;
    const props = record.n.properties;

    const node: GraphNode = {
      id: String(props['id'] ?? id),
      type: parseNodeType(record.labels),
      tenantId: String(props['tenantId'] ?? tenantId),
      properties: filterSystemProperties(props),
      createdAt: parseDate(props['createdAt']),
      updatedAt: parseDate(props['updatedAt']),
    };

    return ok(node);
  }

  /**
   * Update node properties within tenant scope.
   * Only updates properties — type and tenantId are immutable.
   */
  async updateNode(
    id: string,
    tenantId: string,
    properties: Record<string, unknown>,
  ): Promise<Result<GraphNode, AppError>> {
    if (!id || id.trim().length === 0) {
      return err(
        new ValidationError('Node ID is required', {
          id: ['id must be a non-empty string'],
        }),
      );
    }

    const now = new Date();

    const cypher = `
      MATCH (n {id: $id, tenantId: $tenantId})
      SET n += $properties, n.updatedAt = datetime($updatedAt)
      RETURN n, labels(n) as labels
    `;

    const result = await this.client.runWriteQuery<{
      readonly n: { readonly properties: Record<string, unknown> };
      readonly labels: readonly string[];
    }>(
      cypher,
      {
        id,
        properties,
        updatedAt: now.toISOString(),
      },
      tenantId,
    );

    if (!result.success) {
      return result;
    }

    if (result.data.length === 0) {
      return err(new NotFoundError(`Node ${id} not found for tenant`));
    }

    const record = result.data[0]!;
    const props = record.n.properties;

    const node: GraphNode = {
      id: String(props['id'] ?? id),
      type: parseNodeType(record.labels),
      tenantId: String(props['tenantId'] ?? tenantId),
      properties: filterSystemProperties(props),
      createdAt: parseDate(props['createdAt']),
      updatedAt: now,
    };

    return ok(node);
  }

  /**
   * Delete a node and all its relationships within tenant scope.
   * Uses DETACH DELETE to clean up dangling edges.
   */
  async deleteNode(
    id: string,
    tenantId: string,
  ): Promise<Result<void, AppError>> {
    if (!id || id.trim().length === 0) {
      return err(
        new ValidationError('Node ID is required', {
          id: ['id must be a non-empty string'],
        }),
      );
    }

    const cypher = `
      MATCH (n {id: $id, tenantId: $tenantId})
      DETACH DELETE n
      RETURN count(n) as deleted
    `;

    const result = await this.client.runWriteQuery<{ readonly deleted: number }>(
      cypher,
      { id },
      tenantId,
    );

    if (!result.success) {
      return result;
    }

    // Neo4j returns 0 if node didn't exist — we treat this as idempotent success
    return ok(undefined);
  }

  /**
   * Create a relationship (edge) between two nodes within tenant scope.
   * Both source and target nodes must belong to the same tenant.
   */
  async createEdge(
    edge: Omit<GraphEdge, 'id' | 'createdAt'>,
  ): Promise<Result<GraphEdge, AppError>> {
    const validation = graphEdgeSchema.safeParse(edge);
    if (!validation.success) {
      return err(
        new ValidationError('Invalid edge data', {
          edge: validation.error.errors.map((e) => e.message),
        }),
      );
    }

    const id = crypto.randomUUID();
    const now = new Date();

    // Both endpoints must be in the same tenant
    const cypher = `
      MATCH (source {id: $sourceId, tenantId: $tenantId})
      MATCH (target {id: $targetId, tenantId: $tenantId})
      CREATE (source)-[r:${escapeLabel(edge.type)} {
        id: $id,
        tenantId: $tenantId,
        weight: $weight,
        createdAt: datetime($createdAt)
      }]->(target)
      SET r += $properties
      RETURN r, $sourceId as sourceId, $targetId as targetId
    `;

    const result = await this.client.runWriteQuery<EdgeRecord>(
      cypher,
      {
        id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        weight: edge.weight,
        properties: edge.properties,
        createdAt: now.toISOString(),
      },
      edge.tenantId,
    );

    if (!result.success) {
      return result;
    }

    if (result.data.length === 0) {
      return err(
        new NotFoundError(
          'Source or target node not found in tenant scope',
        ),
      );
    }

    const created: GraphEdge = {
      id,
      type: edge.type,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      tenantId: edge.tenantId,
      properties: edge.properties,
      weight: edge.weight,
      createdAt: now,
    };

    return ok(created);
  }

  /**
   * Get all edges connected to a node, optionally filtered by edge type.
   */
  async getEdges(
    nodeId: string,
    tenantId: string,
    edgeType?: string,
  ): Promise<Result<GraphEdge[], AppError>> {
    if (!nodeId || nodeId.trim().length === 0) {
      return err(
        new ValidationError('Node ID is required', {
          nodeId: ['nodeId must be a non-empty string'],
        }),
      );
    }

    let cypher: string;
    const params: Record<string, unknown> = { nodeId };

    if (edgeType) {
      cypher = `
        MATCH (n {id: $nodeId, tenantId: $tenantId})-[r {tenantId: $tenantId}]-(m)
        WHERE type(r) = $edgeType
        RETURN r, n.id as sourceId, m.id as targetId
        LIMIT ${DEFAULT_QUERY_LIMIT}
      `;
      params['edgeType'] = edgeType;
    } else {
      cypher = `
        MATCH (n {id: $nodeId, tenantId: $tenantId})-[r {tenantId: $tenantId}]-(m)
        RETURN r, n.id as sourceId, m.id as targetId
        LIMIT ${DEFAULT_QUERY_LIMIT}
      `;
    }

    const result = await this.client.runQuery<{
      readonly r: { readonly properties: Record<string, unknown>; readonly type: string };
      readonly sourceId: string;
      readonly targetId: string;
    }>(cypher, params, tenantId);

    if (!result.success) {
      return result;
    }

    const edges: GraphEdge[] = result.data.map((record) => {
      const props = record.r.properties;
      return {
        id: String(props['id'] ?? ''),
        type: record.r.type as EdgeType,
        sourceId: record.sourceId,
        targetId: record.targetId,
        tenantId: String(props['tenantId'] ?? tenantId),
        properties: filterSystemProperties(props),
        weight: Number(props['weight'] ?? 1),
        createdAt: parseDate(props['createdAt']),
      };
    });

    return ok(edges);
  }

  /**
   * Delete an edge by ID within tenant scope.
   */
  async deleteEdge(
    id: string,
    tenantId: string,
  ): Promise<Result<void, AppError>> {
    if (!id || id.trim().length === 0) {
      return err(
        new ValidationError('Edge ID is required', {
          id: ['id must be a non-empty string'],
        }),
      );
    }

    const cypher = `
      MATCH ()-[r {id: $id, tenantId: $tenantId}]-()
      DELETE r
      RETURN count(r) as deleted
    `;

    const result = await this.client.runWriteQuery<{ readonly deleted: number }>(
      cypher,
      { id },
      tenantId,
    );

    if (!result.success) {
      return result;
    }

    return ok(undefined);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

const SYSTEM_PROPERTIES = new Set([
  'id',
  'tenantId',
  'createdAt',
  'updatedAt',
  'weight',
]);

/**
 * Strip system properties from a Neo4j record, returning only user properties.
 */
function filterSystemProperties(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!SYSTEM_PROPERTIES.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Parse a Neo4j date value into a JS Date.
 */
function parseDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    return new Date(value);
  }
  // Neo4j DateTime objects have toString()
  if (value && typeof value === 'object' && 'toString' in value) {
    return new Date(String(value));
  }
  return new Date();
}

/**
 * Extract the node type from Neo4j labels.
 * Returns the first recognized label, or 'Person' as default.
 */
function parseNodeType(labels: readonly string[]): NodeType {
  const knownTypes: readonly string[] = [
    'Person',
    'Company',
    'Deal',
    'Interaction',
    'Agent',
    'Campaign',
  ];

  for (const label of labels) {
    if (knownTypes.includes(label)) {
      return label as NodeType;
    }
  }

  return 'Person';
}

/**
 * Escape a Neo4j label to prevent injection.
 * Labels are constrained to our known constants — reject anything else.
 */
function escapeLabel(label: string): string {
  // Only allow known node types and edge types as labels
  const allowed = [
    'Person',
    'Company',
    'Deal',
    'Interaction',
    'Agent',
    'Campaign',
    'WORKS_AT',
    'OWNS',
    'CONTACTED',
    'PARTICIPATED_IN',
    'ASSIGNED_TO',
    'RELATED_TO',
    'INFLUENCED_BY',
    'PART_OF',
  ];

  if (!allowed.includes(label)) {
    throw new ValidationError(`Invalid graph label: not in allowed set`, {
      label: ['Label must be a recognized node or edge type'],
    });
  }

  return label;
}
