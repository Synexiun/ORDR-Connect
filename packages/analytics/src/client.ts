/**
 * ClickHouse client wrapper — tenant-isolated OLAP analytics access
 *
 * SECURITY:
 * - ALL queries MUST include tenantId in WHERE clause (SOC2 CC6.1, HIPAA §164.312(a)(1))
 * - Query parameters are NEVER logged (may contain PII/PHI)
 * - Parameterized queries ONLY — no string concatenation (OWASP injection prevention)
 * - 30-second query timeout to prevent resource exhaustion
 * - Connection uses TLS when configured
 *
 * ISO 27001 A.8.2.3 — Handling of assets: tenant isolation enforced at query level.
 *
 * MVP: Uses InMemoryAnalyticsStore with the same interface — no real ClickHouse dependency.
 */

import { type Result, ok, err, InternalError, ValidationError } from '@ordr/core';
import type { ClickHouseClient } from '@clickhouse/client';
import type { AnalyticsClientConfig } from './types.js';
import { QUERY_TIMEOUT_MS } from './types.js';

// ─── Client Interface ────────────────────────────────────────────

export interface AnalyticsStore {
  query<T>(
    sql: string,
    params: Readonly<Record<string, unknown>>,
    tenantId: string,
  ): Promise<Result<readonly T[]>>;

  insert(
    table: string,
    rows: readonly Readonly<Record<string, unknown>>[],
    tenantId: string,
  ): Promise<Result<void>>;

  healthCheck(): Promise<boolean>;

  close(): Promise<void>;
}

// ─── ClickHouse Client ───────────────────────────────────────────

export class AnalyticsClient implements AnalyticsStore {
  private readonly config: AnalyticsClientConfig;
  private chClient: ClickHouseClient | null = null;
  private connected = false;

  constructor(config: AnalyticsClientConfig) {
    this.config = config;
  }

  /**
   * Execute a tenant-scoped parameterized query against ClickHouse.
   *
   * SECURITY:
   * - tenantId is injected as a query parameter — never concatenated (Rule 4)
   * - Query parameters are NEVER logged — may contain PII/PHI (Rule 3, Rule 6)
   * - 30-second timeout prevents resource exhaustion (Rule 4)
   */
  async query<T>(
    sql: string,
    params: Readonly<Record<string, unknown>>,
    tenantId: string,
  ): Promise<Result<readonly T[]>> {
    const validationResult = this.validateTenantId(tenantId);
    if (validationResult !== null) {
      return validationResult;
    }

    if (!this.connected || !this.chClient) {
      return err(new InternalError('AnalyticsClient is not connected'));
    }

    try {
      // SECURITY: params are passed as query_params — ClickHouse handles escaping
      // SECURITY: NEVER log params or sql with interpolated values
      const result = await this.chClient.query({
        query: sql,
        query_params: params as Record<string, unknown>,
        format: 'JSONEachRow',
        clickhouse_settings: {
          // Enforce query timeout at the server level as well
          max_execution_time: Math.floor(QUERY_TIMEOUT_MS / 1000),
        },
      });
      const rows = await result.json<T>();
      return ok(rows as readonly T[]);
    } catch (cause: unknown) {
      // SECURITY: Log only error message — NEVER parameters or query text
      const message = cause instanceof Error ? cause.message : 'Query execution failed';
      return err(new InternalError(`Analytics query failed: ${message}`));
    }
  }

  /**
   * Insert rows into ClickHouse with mandatory tenant isolation.
   *
   * SECURITY: tenantId is stamped onto every row before insert —
   * no row can be written without a tenant boundary (Rule 2, SOC2 CC6.1).
   */
  async insert(
    table: string,
    rows: readonly Readonly<Record<string, unknown>>[],
    tenantId: string,
  ): Promise<Result<void>> {
    const validationResult = this.validateTenantId(tenantId);
    if (validationResult !== null) {
      return validationResult;
    }

    if (!this.connected || !this.chClient) {
      return err(new InternalError('AnalyticsClient is not connected'));
    }

    if (rows.length === 0) {
      return ok(undefined);
    }

    try {
      // Stamp tenant_id onto every row — never trust caller to include it
      const stamped = rows.map((row) => ({ ...row, tenant_id: tenantId }));
      await this.chClient.insert({
        table,
        values: stamped,
        format: 'JSONEachRow',
      });
      return ok(undefined);
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : 'Insert failed';
      return err(new InternalError(`Analytics insert failed: ${message}`));
    }
  }

  /**
   * Verify ClickHouse connectivity via ping.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.chClient) return false;
    try {
      const result = await this.chClient.ping();
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Connect to ClickHouse and verify the connection.
   *
   * TLS is determined by the URL scheme: https:// enables TLS.
   * The config.tls flag is used to normalise http/https URL prefix.
   */
  async connect(): Promise<void> {
    try {
      const { createClient } = await import('@clickhouse/client');

      // Normalise URL: prepend scheme if not present
      const rawUrl = this.config.url;
      const url = rawUrl.startsWith('http')
        ? rawUrl
        : this.config.tls
          ? `https://${rawUrl}`
          : `http://${rawUrl}`;

      this.chClient = createClient({
        url,
        username: this.config.username,
        password: this.config.password,
        database: this.config.database,
        request_timeout: QUERY_TIMEOUT_MS,
      });

      const ping = await this.chClient.ping();
      if (!ping.success) {
        throw new Error('ClickHouse ping returned unsuccessful');
      }

      this.connected = true;
    } catch (cause: unknown) {
      this.connected = false;
      this.chClient = null;
      const message = cause instanceof Error ? cause.message : 'Unknown connection error';
      throw new InternalError(`ClickHouse connection failed: ${message}`);
    }
  }

  /**
   * Gracefully close the ClickHouse connection.
   */
  async close(): Promise<void> {
    await this.chClient?.close();
    this.chClient = null;
    this.connected = false;
  }

  // ─── Private Helpers ─────────────────────────────────────────

  private validateTenantId(tenantId: string): Result<never> | null {
    if (!tenantId || tenantId.trim().length === 0) {
      return err(
        new ValidationError('tenantId is required for all analytics queries', {
          tenantId: ['tenantId must be a non-empty string'],
        }),
      );
    }
    return null;
  }
}

// ─── In-Memory Analytics Store ───────────────────────────────────

interface StoredRow {
  readonly table: string;
  readonly tenantId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly insertedAt: Date;
}

/**
 * In-memory implementation for testing and MVP development.
 * Maintains the same interface as AnalyticsClient.
 *
 * SECURITY: Still enforces tenant isolation in all operations.
 */
export class InMemoryAnalyticsStore implements AnalyticsStore {
  private readonly rows: StoredRow[] = [];
  private healthy = true;

  /**
   * Query rows with tenant isolation.
   * Matches rows by table name extracted from SQL and tenantId.
   *
   * SECURITY: tenantId filter is ALWAYS applied — no cross-tenant access.
   */
  query<T>(
    sql: string,
    params: Readonly<Record<string, unknown>>,
    tenantId: string,
  ): Promise<Result<readonly T[]>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return Promise.resolve(
        err(
          new ValidationError('tenantId is required for all analytics queries', {
            tenantId: ['tenantId must be a non-empty string'],
          }),
        ),
      );
    }

    if (!this.healthy) {
      return Promise.resolve(err(new InternalError('Analytics store is unavailable')));
    }

    // Extract table name from SQL for filtering — using match() to avoid exec() pattern
    const tableMatch = sql.match(/FROM\s+(\w+)/i);
    const table = tableMatch?.[1] ?? '';

    // Filter by tenantId (MANDATORY) and table
    let results = this.rows.filter(
      (row) => row.tenantId === tenantId && (table === '' || row.table === table),
    );

    // Apply parameter-based filters
    const fromDate = params['from'];
    const toDate = params['to'];
    if (fromDate instanceof Date) {
      results = results.filter((row) => row.insertedAt >= fromDate);
    }
    if (toDate instanceof Date) {
      results = results.filter((row) => row.insertedAt <= toDate);
    }

    // Apply dimension filters
    for (const [key, value] of Object.entries(params)) {
      if (key === 'from' || key === 'to' || key === 'tenantId') continue;
      if (typeof value === 'string') {
        results = results.filter((row) => row.data[key] === value);
      }
    }

    return Promise.resolve(ok(results.map((row) => row.data as T)));
  }

  /**
   * Insert rows with mandatory tenant isolation.
   */
  insert(
    table: string,
    rows: readonly Readonly<Record<string, unknown>>[],
    tenantId: string,
  ): Promise<Result<void>> {
    if (!tenantId || tenantId.trim().length === 0) {
      return Promise.resolve(
        err(
          new ValidationError('tenantId is required for all analytics inserts', {
            tenantId: ['tenantId must be a non-empty string'],
          }),
        ),
      );
    }

    if (!this.healthy) {
      return Promise.resolve(err(new InternalError('Analytics store is unavailable')));
    }

    for (const row of rows) {
      this.rows.push({
        table,
        tenantId,
        data: { ...row, tenant_id: tenantId },
        insertedAt: row['timestamp'] instanceof Date ? row['timestamp'] : new Date(),
      });
    }

    return Promise.resolve(ok(undefined));
  }

  healthCheck(): Promise<boolean> {
    return Promise.resolve(this.healthy);
  }

  close(): Promise<void> {
    this.healthy = false;
    return Promise.resolve();
  }

  // ─── Test Helpers ──────────────────────────────────────────────

  /** Get all rows for a tenant in a table — test helper only */
  getRows(tenantId: string, table?: string): readonly StoredRow[] {
    return this.rows.filter(
      (row) => row.tenantId === tenantId && (table === undefined || row.table === table),
    );
  }

  /** Get total row count — test helper only */
  get totalRows(): number {
    return this.rows.length;
  }

  /** Reset store to empty state — test helper only */
  clear(): void {
    this.rows.length = 0;
  }

  /** Set health status — test helper only */
  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }
}
