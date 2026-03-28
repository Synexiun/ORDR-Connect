// ---------------------------------------------------------------------------
// @ordr/db — Public API
//
// Database connection, Drizzle ORM schemas, and RLS/WORM policies
// for the ORDR-Connect Customer Operations OS.
//
// SOC2 / ISO27001 / HIPAA compliant by design:
//   - Row-Level Security on all tenant-scoped tables
//   - WORM enforcement on audit_logs via database triggers
//   - Field-level encryption markers on PII columns
//   - SHA-256 hash chains for audit trail integrity
//   - Merkle tree roots for batch verification
// ---------------------------------------------------------------------------

// Connection & tenant context
export {
  createConnection,
  createDrizzle,
  setTenantContext,
  clearTenantContext,
  closeConnection,
  type ConnectionConfig,
  type OrdrDatabase,
} from './connection.js';

// All schemas (tables + enums)
export * from './schema/index.js';

// RLS policies & WORM triggers (SQL strings for migrations)
export { RLS_POLICIES, WORM_TRIGGERS } from './rls.js';

// Migration runner
export { runMigrations, getMigrationStatus } from './migrate.js';
export type { MigrationRecord, MigrationResult, MigrationStatus } from './migrate.js';

// Database seeder
export { seedDatabase } from './seed.js';

// DrizzleAuditStore — PostgreSQL-backed WORM audit log store
export { DrizzleAuditStore } from './drizzle-audit-store.js';
