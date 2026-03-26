/**
 * Graph traversals — relationship exploration for customer intelligence
 *
 * SECURITY:
 * - All traversals include tenantId in MATCH/WHERE clauses
 * - Max depth is capped at 5 to prevent expensive queries
 * - Parameterized Cypher — no string concatenation
 * - Query timeout enforced by GraphClient (10s)
 */

import {
  type Result,
  ok,
  err,
  ValidationError,
  type AppError,
} from '@ordr/core';
import type { GraphClient } from './client.js';
import {
  type GraphNode,
  type GraphEdge,
  type TraversalResult,
  type NodeType,
  type EdgeType,
  MAX_TRAVERSAL_DEPTH,
  DEFAULT_QUERY_LIMIT,
} from './types.js';

// ─── Neo4j Result Shapes ─────────────────────────────────────────

interface NeighborRecord {
  readonly neighbor: { readonly properties: Record<string, unknown> };
  readonly neighborLabels: readonly string[];
  readonly r: { readonly properties: Record<string, unknown>; readonly type: string };
  readonly originId: string;
  readonly neighborId: string;
}

interface PathRecord {
  readonly nodes: ReadonlyArray<{
    readonly properties: Record<string, unknown>;
    readonly labels: readonly string[];
  }>;
  readonly rels: ReadonlyArray<{
    readonly properties: Record<string, unknown>;
    readonly type: string;
  }>;
  readonly nodeIds: readonly string[];
}

interface InfluencerRecord {
  readonly n: { readonly properties: Record<string, unknown> };
  readonly labels: readonly string[];
  readonly degree: number;
}

// ─── Traversals ──────────────────────────────────────────────────

export class GraphTraversals {
  private readonly client: GraphClient;

  constructor(client: GraphClient) {
    this.client = client;
  }

  /**
   * Get all neighbors of a node within a given depth.
   * Depth is capped at MAX_TRAVERSAL_DEPTH (5).
   */
  async getNeighbors(
    nodeId: string,
    tenantId: string,
    depth?: number,
  ): Promise<Result<TraversalResult, AppError>> {
    if (!nodeId || nodeId.trim().length === 0) {
      return err(
        new ValidationError('Node ID is required', {
          nodeId: ['nodeId must be a non-empty string'],
        }),
      );
    }

    const safeDepth = clampDepth(depth ?? 1);

    const cypher = `
      MATCH (origin {id: $nodeId, tenantId: $tenantId})
            -[r*1..${safeDepth}]-(neighbor)
      WHERE neighbor.tenantId = $tenantId
      WITH DISTINCT neighbor, r[0] as r, $nodeId as originId
      RETURN neighbor,
             labels(neighbor) as neighborLabels,
             r,
             originId,
             neighbor.id as neighborId
      LIMIT ${DEFAULT_QUERY_LIMIT}
    `;

    const result = await this.client.runQuery<NeighborRecord>(
      cypher,
      { nodeId },
      tenantId,
    );

    if (!result.success) {
      return result;
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const seenNodes = new Set<string>();
    const seenEdges = new Set<string>();

    for (const record of result.data) {
      const nProps = record.neighbor.properties;
      const nId = String(nProps['id'] ?? record.neighborId);

      if (!seenNodes.has(nId)) {
        seenNodes.add(nId);
        nodes.push({
          id: nId,
          type: parseNodeTypeFromLabels(record.neighborLabels),
          tenantId: String(nProps['tenantId'] ?? tenantId),
          properties: filterSystemProps(nProps),
          createdAt: parseDate(nProps['createdAt']),
          updatedAt: parseDate(nProps['updatedAt']),
        });
      }

      const rProps = record.r.properties;
      const rId = String(rProps['id'] ?? '');

      if (rId && !seenEdges.has(rId)) {
        seenEdges.add(rId);
        edges.push({
          id: rId,
          type: record.r.type as EdgeType,
          sourceId: record.originId,
          targetId: nId,
          tenantId: String(rProps['tenantId'] ?? tenantId),
          properties: filterSystemProps(rProps),
          weight: Number(rProps['weight'] ?? 1),
          createdAt: parseDate(rProps['createdAt']),
        });
      }
    }

    return ok({ nodes, edges, paths: [] });
  }

  /**
   * Find the shortest path between two nodes within tenant scope.
   * Max depth is capped at MAX_TRAVERSAL_DEPTH (5).
   */
  async findPath(
    fromId: string,
    toId: string,
    tenantId: string,
    maxDepth?: number,
  ): Promise<Result<TraversalResult, AppError>> {
    if (!fromId || fromId.trim().length === 0) {
      return err(
        new ValidationError('Source node ID is required', {
          fromId: ['fromId must be a non-empty string'],
        }),
      );
    }

    if (!toId || toId.trim().length === 0) {
      return err(
        new ValidationError('Target node ID is required', {
          toId: ['toId must be a non-empty string'],
        }),
      );
    }

    const safeDepth = clampDepth(maxDepth ?? MAX_TRAVERSAL_DEPTH);

    const cypher = `
      MATCH path = shortestPath(
        (from {id: $fromId, tenantId: $tenantId})
        -[*1..${safeDepth}]-
        (to {id: $toId, tenantId: $tenantId})
      )
      WHERE ALL(n IN nodes(path) WHERE n.tenantId = $tenantId)
      WITH path
      RETURN [n IN nodes(path) | n] as nodes,
             [r IN relationships(path) | r] as rels,
             [n IN nodes(path) | n.id] as nodeIds
      LIMIT 1
    `;

    const result = await this.client.runQuery<PathRecord>(
      cypher,
      { fromId, toId },
      tenantId,
    );

    if (!result.success) {
      return result;
    }

    if (result.data.length === 0) {
      return ok({ nodes: [], edges: [], paths: [] });
    }

    const record = result.data[0]!;
    const nodes: GraphNode[] = record.nodes.map((n) => ({
      id: String(n.properties['id'] ?? ''),
      type: parseNodeTypeFromLabels(n.labels),
      tenantId: String(n.properties['tenantId'] ?? tenantId),
      properties: filterSystemProps(n.properties),
      createdAt: parseDate(n.properties['createdAt']),
      updatedAt: parseDate(n.properties['updatedAt']),
    }));

    const edges: GraphEdge[] = record.rels.map((r) => ({
      id: String(r.properties['id'] ?? ''),
      type: r.type as EdgeType,
      sourceId: '',
      targetId: '',
      tenantId: String(r.properties['tenantId'] ?? tenantId),
      properties: filterSystemProps(r.properties),
      weight: Number(r.properties['weight'] ?? 1),
      createdAt: parseDate(r.properties['createdAt']),
    }));

    const paths: ReadonlyArray<string>[] = [
      record.nodeIds.map((id) => String(id)),
    ];

    return ok({ nodes, edges, paths });
  }

  /**
   * Get the full customer network — all entities connected to a customer.
   * Traverses up to depth 3 to capture the immediate business context.
   */
  async getCustomerNetwork(
    customerId: string,
    tenantId: string,
  ): Promise<Result<TraversalResult, AppError>> {
    if (!customerId || customerId.trim().length === 0) {
      return err(
        new ValidationError('Customer ID is required', {
          customerId: ['customerId must be a non-empty string'],
        }),
      );
    }

    const cypher = `
      MATCH (customer {id: $customerId, tenantId: $tenantId})
            -[r*1..3]-(connected)
      WHERE connected.tenantId = $tenantId
      WITH DISTINCT connected, r[0] as firstRel, $customerId as customerId
      RETURN connected as neighbor,
             labels(connected) as neighborLabels,
             firstRel as r,
             customerId as originId,
             connected.id as neighborId
      LIMIT ${DEFAULT_QUERY_LIMIT}
    `;

    const result = await this.client.runQuery<NeighborRecord>(
      cypher,
      { customerId },
      tenantId,
    );

    if (!result.success) {
      return result;
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const seenNodes = new Set<string>();
    const seenEdges = new Set<string>();

    for (const record of result.data) {
      const nProps = record.neighbor.properties;
      const nId = String(nProps['id'] ?? record.neighborId);

      if (!seenNodes.has(nId)) {
        seenNodes.add(nId);
        nodes.push({
          id: nId,
          type: parseNodeTypeFromLabels(record.neighborLabels),
          tenantId: String(nProps['tenantId'] ?? tenantId),
          properties: filterSystemProps(nProps),
          createdAt: parseDate(nProps['createdAt']),
          updatedAt: parseDate(nProps['updatedAt']),
        });
      }

      const rProps = record.r.properties;
      const rId = String(rProps['id'] ?? '');

      if (rId && !seenEdges.has(rId)) {
        seenEdges.add(rId);
        edges.push({
          id: rId,
          type: record.r.type as EdgeType,
          sourceId: record.originId,
          targetId: nId,
          tenantId: String(rProps['tenantId'] ?? tenantId),
          properties: filterSystemProps(rProps),
          weight: Number(rProps['weight'] ?? 1),
          createdAt: parseDate(rProps['createdAt']),
        });
      }
    }

    return ok({ nodes, edges, paths: [] });
  }

  /**
   * Find the most influential nodes by degree centrality.
   * Returns nodes with the highest number of connections.
   */
  async findInfluencers(
    tenantId: string,
    limit?: number,
  ): Promise<Result<GraphNode[], AppError>> {
    const safeLimit = Math.min(Math.max(limit ?? 10, 1), DEFAULT_QUERY_LIMIT);

    const cypher = `
      MATCH (n {tenantId: $tenantId})-[r]-(m)
      WHERE m.tenantId = $tenantId
      WITH n, count(r) as degree, labels(n) as labels
      ORDER BY degree DESC
      LIMIT $limit
      RETURN n, labels, degree
    `;

    const result = await this.client.runQuery<InfluencerRecord>(
      cypher,
      { limit: safeLimit },
      tenantId,
    );

    if (!result.success) {
      return result;
    }

    const nodes: GraphNode[] = result.data.map((record) => {
      const props = record.n.properties;
      return {
        id: String(props['id'] ?? ''),
        type: parseNodeTypeFromLabels(record.labels),
        tenantId: String(props['tenantId'] ?? tenantId),
        properties: {
          ...filterSystemProps(props),
          _degreeCentrality: record.degree,
        },
        createdAt: parseDate(props['createdAt']),
        updatedAt: parseDate(props['updatedAt']),
      };
    });

    return ok(nodes);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

const SYSTEM_PROPS = new Set([
  'id',
  'tenantId',
  'createdAt',
  'updatedAt',
  'weight',
]);

function filterSystemProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!SYSTEM_PROPS.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

function parseDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  if (value && typeof value === 'object' && 'toString' in value) {
    return new Date(String(value));
  }
  return new Date();
}

const KNOWN_TYPES: readonly NodeType[] = [
  'Person',
  'Company',
  'Deal',
  'Interaction',
  'Agent',
  'Campaign',
];

function parseNodeTypeFromLabels(labels: readonly string[]): NodeType {
  for (const label of labels) {
    if ((KNOWN_TYPES as readonly string[]).includes(label)) {
      return label as NodeType;
    }
  }
  return 'Person';
}

/**
 * Clamp traversal depth between 1 and MAX_TRAVERSAL_DEPTH.
 * Prevents excessively deep queries that could exhaust resources.
 */
function clampDepth(depth: number): number {
  return Math.min(Math.max(Math.round(depth), 1), MAX_TRAVERSAL_DEPTH);
}
