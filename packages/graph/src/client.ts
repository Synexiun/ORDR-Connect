/**
 * Neo4j client wrapper — tenant-isolated graph database access
 *
 * SECURITY:
 * - ALL queries MUST include tenantId in WHERE clause
 * - Query parameters are NEVER logged (may contain PII/PHI)
 * - Parameterized Cypher ONLY — no string concatenation
 * - Connection uses encrypted transport when configured
 * - 10-second query timeout to prevent resource exhaustion
 */

import neo4j, {
  type Driver,
  type Session,
  type Record as Neo4jRecord,
  type QueryResult,
} from 'neo4j-driver';
import {
  type Result,
  ok,
  err,
  InternalError,
  ValidationError,
} from '@ordr/core';
import { QUERY_TIMEOUT_MS } from './types.js';

// ─── Configuration ───────────────────────────────────────────────

export interface GraphClientConfig {
  readonly uri: string;
  readonly username: string;
  readonly password: string;
  readonly database?: string | undefined;
  readonly maxConnectionPoolSize?: number | undefined;
  readonly connectionAcquisitionTimeoutMs?: number | undefined;
  readonly encrypted?: boolean | undefined;
}

// ─── Client ──────────────────────────────────────────────────────

export class GraphClient {
  private driver: Driver | null = null;
  private readonly config: GraphClientConfig;

  constructor(config: GraphClientConfig) {
    this.config = config;
  }

  /**
   * Establish connection to Neo4j and verify with a health check.
   * Throws InternalError if connection fails.
   */
  async connect(): Promise<void> {
    try {
      this.driver = neo4j.driver(
        this.config.uri,
        neo4j.auth.basic(this.config.username, this.config.password),
        {
          maxConnectionPoolSize: this.config.maxConnectionPoolSize ?? 50,
          connectionAcquisitionTimeout:
            this.config.connectionAcquisitionTimeoutMs ?? 30_000,
          encrypted: this.config.encrypted ?? false,
        },
      );

      // Health check — verify connectivity
      const serverInfo = await this.driver.getServerInfo();
      // Log only non-sensitive connection metadata
      // SECURITY: Never log credentials or query parameters
      void serverInfo;
    } catch (cause: unknown) {
      this.driver = null;
      const message =
        cause instanceof Error ? cause.message : 'Unknown connection error';
      throw new InternalError(`Neo4j connection failed: ${message}`);
    }
  }

  /**
   * Gracefully close all connections.
   */
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }

  /**
   * Execute a tenant-scoped Cypher query with parameterized inputs.
   *
   * SECURITY:
   * - tenantId is injected as a parameter, never concatenated
   * - Query parameters are NEVER logged (PII/PHI risk)
   * - 10-second timeout prevents resource exhaustion
   *
   * @param cypher - Parameterized Cypher query string
   * @param params - Query parameters (passed safely to Neo4j driver)
   * @param tenantId - Tenant scope — enforced in every query
   */
  async runQuery<T>(
    cypher: string,
    params: Record<string, unknown>,
    tenantId: string,
  ): Promise<Result<T[], AppError>> {
    if (!this.driver) {
      return err(new InternalError('Neo4j client is not connected'));
    }

    if (!tenantId || tenantId.trim().length === 0) {
      return err(
        new ValidationError('tenantId is required for all graph queries', {
          tenantId: ['tenantId must be a non-empty string'],
        }),
      );
    }

    let session: Session | null = null;

    try {
      session = this.driver.session({
        database: this.config.database ?? 'neo4j',
        defaultAccessMode: neo4j.session.READ,
      });

      const result: QueryResult = await session.run(
        cypher,
        { ...params, tenantId },
        { timeout: QUERY_TIMEOUT_MS },
      );

      const records: T[] = result.records.map(
        (record: Neo4jRecord) => record.toObject() as T,
      );

      return ok(records);
    } catch (cause: unknown) {
      // SECURITY: Log only error type and Cypher template — NEVER parameters
      const message =
        cause instanceof Error ? cause.message : 'Query execution failed';
      return err(new InternalError(`Graph query failed: ${message}`));
    } finally {
      if (session) {
        await session.close();
      }
    }
  }

  /**
   * Execute a write query (CREATE, MERGE, SET, DELETE).
   * Uses WRITE access mode for Neo4j routing.
   */
  async runWriteQuery<T>(
    cypher: string,
    params: Record<string, unknown>,
    tenantId: string,
  ): Promise<Result<T[], AppError>> {
    if (!this.driver) {
      return err(new InternalError('Neo4j client is not connected'));
    }

    if (!tenantId || tenantId.trim().length === 0) {
      return err(
        new ValidationError('tenantId is required for all graph queries', {
          tenantId: ['tenantId must be a non-empty string'],
        }),
      );
    }

    let session: Session | null = null;

    try {
      session = this.driver.session({
        database: this.config.database ?? 'neo4j',
        defaultAccessMode: neo4j.session.WRITE,
      });

      const result: QueryResult = await session.run(
        cypher,
        { ...params, tenantId },
        { timeout: QUERY_TIMEOUT_MS },
      );

      const records: T[] = result.records.map(
        (record: Neo4jRecord) => record.toObject() as T,
      );

      return ok(records);
    } catch (cause: unknown) {
      // SECURITY: Log only error type — NEVER parameters
      const message =
        cause instanceof Error ? cause.message : 'Write query failed';
      return err(new InternalError(`Graph write failed: ${message}`));
    } finally {
      if (session) {
        await session.close();
      }
    }
  }

  /**
   * Check if the client is currently connected.
   */
  isConnected(): boolean {
    return this.driver !== null;
  }
}

// Re-import for the return type used in runQuery
import type { AppError } from '@ordr/core';
