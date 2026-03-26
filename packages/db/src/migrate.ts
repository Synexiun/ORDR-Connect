// ---------------------------------------------------------------------------
// @ordr/db — Migration Runner
//
// Reads SQL migration files from packages/db/migrations/, applies them
// in lexicographic order, and tracks state in the _migrations table.
//
// SOC2 CC8.1 — Change management: checksummed, idempotent, auditable.
// ISO 27001 A.12.1.2 — Change management controls.
// HIPAA §164.312(c)(1) — Integrity controls: SHA-256 verification.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationRecord {
  id: number;
  name: string;
  checksum: string;
  applied_at: Date;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  errors: Array<{ name: string; error: string }>;
}

export interface MigrationStatus {
  pending: string[];
  applied: MigrationRecord[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(
  fileURLToPath(import.meta.url),
  '../../migrations',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 checksum of migration file content */
function computeChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Discover migration files sorted by name (0001_, 0002_, ...) */
async function discoverMigrations(): Promise<Array<{ name: string; path: string }>> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, path: join(MIGRATIONS_DIR, f) }));
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Ensures the _migrations tracking table exists.
 * Idempotent — safe to call on every run.
 */
async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

/**
 * Returns all previously applied migrations from the tracking table.
 */
async function getAppliedMigrations(sql: postgres.Sql): Promise<MigrationRecord[]> {
  const rows = await sql<MigrationRecord[]>`
    SELECT id, name, checksum, applied_at
    FROM _migrations
    ORDER BY id ASC
  `;
  return rows;
}

/**
 * Runs all pending migrations in order.
 *
 * - Idempotent: skips already-applied migrations.
 * - Checksum verification: if a previously applied migration's file has
 *   changed, an error is raised (tamper detection).
 * - Each migration runs inside its own transaction.
 */
export async function runMigrations(
  connectionUrl: string,
): Promise<MigrationResult> {
  const sql = postgres(connectionUrl, { max: 1 });
  const result: MigrationResult = { applied: [], skipped: [], errors: [] };

  try {
    await ensureMigrationsTable(sql);
    const applied = await getAppliedMigrations(sql);
    const appliedMap = new Map(applied.map((m) => [m.name, m.checksum]));
    const migrations = await discoverMigrations();

    for (const migration of migrations) {
      const content = await readFile(migration.path, 'utf8');
      const checksum = computeChecksum(content);

      // Already applied — verify checksum integrity
      if (appliedMap.has(migration.name)) {
        const storedChecksum = appliedMap.get(migration.name);
        if (storedChecksum !== checksum) {
          result.errors.push({
            name: migration.name,
            error: `Checksum mismatch: stored=${storedChecksum ?? 'null'}, file=${checksum}. Migration file has been tampered with.`,
          });
          break; // Stop on tamper detection
        }
        result.skipped.push(migration.name);
        continue;
      }

      // Apply migration in a transaction
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(content);
          await tx`
            INSERT INTO _migrations (name, checksum)
            VALUES (${migration.name}, ${checksum})
          `;
        });
        result.applied.push(migration.name);
      } catch (err) {
        result.errors.push({
          name: migration.name,
          error: err instanceof Error ? err.message : String(err),
        });
        break; // Stop on first error
      }
    }
  } finally {
    await sql.end();
  }

  return result;
}

/**
 * Returns the status of all migrations (applied vs pending).
 */
export async function getMigrationStatus(
  connectionUrl: string,
): Promise<MigrationStatus> {
  const sql = postgres(connectionUrl, { max: 1 });

  try {
    await ensureMigrationsTable(sql);
    const applied = await getAppliedMigrations(sql);
    const appliedNames = new Set(applied.map((m) => m.name));
    const all = await discoverMigrations();
    const pending = all
      .filter((m) => !appliedNames.has(m.name))
      .map((m) => m.name);

    return { pending, applied };
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('migrate.ts') ||
    process.argv[1].endsWith('migrate.js'));

if (isDirectRun) {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('[ORDR:DB] DATABASE_URL is required');
    process.exit(1);
  }

  const command = process.argv[2] ?? 'up';

  if (command === 'status') {
    const status = await getMigrationStatus(url);
    console.log('\n=== Migration Status ===');
    console.log(`Applied: ${String(status.applied.length)}`);
    for (const m of status.applied) {
      console.log(`  [x] ${m.name} (${m.checksum.slice(0, 8)}...) @ ${m.applied_at.toISOString()}`);
    }
    console.log(`Pending: ${String(status.pending.length)}`);
    for (const name of status.pending) {
      console.log(`  [ ] ${name}`);
    }
  } else {
    console.log('[ORDR:DB] Running migrations...');
    const result = await runMigrations(url);
    console.log(`Applied: ${String(result.applied.length)}`);
    for (const name of result.applied) {
      console.log(`  [+] ${name}`);
    }
    if (result.skipped.length > 0) {
      console.log(`Skipped: ${String(result.skipped.length)}`);
    }
    if (result.errors.length > 0) {
      console.error(`Errors: ${String(result.errors.length)}`);
      for (const e of result.errors) {
        console.error(`  [!] ${e.name}: ${e.error}`);
      }
      process.exit(1);
    }
    console.log('[ORDR:DB] Migrations complete.');
  }
}
