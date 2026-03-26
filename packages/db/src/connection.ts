import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import type * as schema from './schema/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectionConfig {
  /** Full postgres connection URL (must use sslmode=require in production) */
  databaseUrl: string;
  /** Minimum pool connections (default: 1) */
  poolMin?: number;
  /** Maximum pool connections (default: 10) */
  poolMax?: number;
  /** Idle connection timeout in seconds (default: 20) */
  idleTimeout?: number;
  /** Connection timeout in seconds (default: 10) */
  connectTimeout?: number;
}

export type OrdrDatabase = PostgresJsDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// Connection factory
// ---------------------------------------------------------------------------

/**
 * Creates a postgres.js client with TLS enforcement for production.
 * Never use unencrypted connections when NODE_ENV=production.
 */
export function createConnection(config: ConnectionConfig): postgres.Sql {
  const isProduction = process.env['NODE_ENV'] === 'production';

  const poolMin = config.poolMin ?? Number(process.env['DB_POOL_MIN'] ?? '1');
  const poolMax = config.poolMax ?? Number(process.env['DB_POOL_MAX'] ?? '10');
  const idleTimeout = config.idleTimeout ?? Number(process.env['DB_IDLE_TIMEOUT'] ?? '20');
  const connectTimeout = config.connectTimeout ?? Number(process.env['DB_CONNECT_TIMEOUT'] ?? '10');

  // Enforce TLS in production — refuse to proceed without it
  if (isProduction && !config.databaseUrl.includes('sslmode=')) {
    throw new Error(
      '[ORDR:DB] Production connections MUST use TLS. ' +
      'Add ?sslmode=require (or sslmode=verify-full) to DATABASE_URL.',
    );
  }

  const baseOptions: postgres.Options<Record<string, never>> = {
    max: poolMax,
    idle_timeout: idleTimeout,
    connect_timeout: connectTimeout,
    // Connection lifecycle hooks
    onnotice: () => {
      /* suppress NOTICE messages in application logs */
    },
    connection: {
      // Set a short statement_timeout for safety (30 s default; override per-query)
      statement_timeout: 30_000,
    },
  };

  // postgres.js ssl config: 'require' enforces TLS, omit entirely for local dev
  if (isProduction) {
    baseOptions.ssl = 'require';
  }

  const client = postgres(config.databaseUrl, baseOptions);

  // Validate pool floor
  if (poolMin < 0 || poolMax < 1 || poolMin > poolMax) {
    throw new Error(
      `[ORDR:DB] Invalid pool config: min=${String(poolMin)} max=${String(poolMax)}`,
    );
  }

  return client;
}

/**
 * Wraps a postgres.js client in the Drizzle ORM query builder.
 */
export function createDrizzle(
  connection: postgres.Sql,
  schemaImport: typeof schema,
): OrdrDatabase {
  return drizzle(connection, { schema: schemaImport });
}

// ---------------------------------------------------------------------------
// Tenant context (RLS)
// ---------------------------------------------------------------------------

/** UUID v4 format validation */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Sets the current tenant context for Row-Level Security.
 *
 * MUST be called at the start of every tenant-scoped request
 * inside a transaction boundary. The RLS policies read
 * `current_setting('app.current_tenant')` to filter rows.
 *
 * @throws if tenantId is not a valid UUID (prevents SQL injection via GUC)
 */
export async function setTenantContext(
  db: OrdrDatabase,
  tenantId: string,
): Promise<void> {
  // Strict UUID validation — the GUC value is interpolated by the policy
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`[ORDR:DB] Invalid tenant ID format: ${tenantId}`);
  }

  // Use parameterised set_config() — not string concatenation
  await db.execute(
    sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`,
  );
}

/**
 * Clears the tenant context (for super-admin / system operations).
 */
export async function clearTenantContext(db: OrdrDatabase): Promise<void> {
  await db.execute(
    sql`SELECT set_config('app.current_tenant', '', true)`,
  );
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Drains the connection pool and closes all connections.
 * Call during application shutdown (SIGTERM handler).
 */
export async function closeConnection(connection: postgres.Sql): Promise<void> {
  await connection.end({ timeout: 5 });
}
