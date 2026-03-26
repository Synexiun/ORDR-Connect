/**
 * Migration System Tests — validates migration files, WORM triggers,
 * RLS policies, seed idempotency, and backup infrastructure.
 *
 * SOC2 CC8.1 — Change management verification.
 * ISO 27001 A.12.1.2 — Change management controls.
 * HIPAA §164.312(c)(1) — Integrity controls.
 *
 * These tests verify compliance with:
 * - Rule 3: WORM enforcement on audit tables
 * - Rule 2: RLS on every tenant-scoped table
 * - Migrations are checksummed and sequential
 * - Seeds are idempotent
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(
  fileURLToPath(import.meta.url),
  '../../../migrations',
);

// All tenant-scoped tables that MUST have RLS (from rls.ts)
const RLS_TABLES = [
  'users',
  'sessions',
  'api_keys',
  'customers',
  'interactions',
  'audit_logs',
  'merkle_roots',
  'agent_actions',
  'compliance_records',
  'contacts',
  'consent_records',
  'agent_sessions',
  'messages',
  'payment_records',
  'decision_rules',
  'decision_audit',
  'channel_preferences',
  'organizations',
  'sso_connections',
  'custom_roles',
  'user_custom_roles',
  'scim_tokens',
  'marketplace_installs',
  'agent_memories',
  'sentiment_history',
];

// WORM-protected tables
const WORM_TABLES = [
  'audit_logs',
  'merkle_roots',
  'consent_records',
  'decision_audit',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

async function readMigration(name: string): Promise<string> {
  return readFile(join(MIGRATIONS_DIR, name), 'utf8');
}

function computeChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ============================================================================
// 1. Migration Files Existence and Validity
// ============================================================================

describe('migration files — existence and validity', () => {
  it('migrations directory exists and contains SQL files', async () => {
    const files = await getMigrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('has 0001_initial_schema.sql', async () => {
    const files = await getMigrationFiles();
    expect(files).toContain('0001_initial_schema.sql');
  });

  it('has 0002_audit_worm_triggers.sql', async () => {
    const files = await getMigrationFiles();
    expect(files).toContain('0002_audit_worm_triggers.sql');
  });

  it('has 0003_rls_policies.sql', async () => {
    const files = await getMigrationFiles();
    expect(files).toContain('0003_rls_policies.sql');
  });

  it('all migration files are valid SQL (non-empty)', async () => {
    const files = await getMigrationFiles();
    for (const file of files) {
      const content = await readMigration(file);
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });

  it('all migration files contain SQL statements', async () => {
    const files = await getMigrationFiles();
    for (const file of files) {
      const content = await readMigration(file);
      // Every SQL file should have at least one statement-ending semicolon
      expect(content).toContain(';');
    }
  });
});

// ============================================================================
// 2. Migration Checksums Are Stable
// ============================================================================

describe('migration checksums — stability', () => {
  it('checksums are deterministic (same content = same hash)', async () => {
    const files = await getMigrationFiles();
    for (const file of files) {
      const content = await readMigration(file);
      const checksum1 = computeChecksum(content);
      const checksum2 = computeChecksum(content);
      expect(checksum1).toBe(checksum2);
    }
  });

  it('checksums are 64-character hex strings (SHA-256)', async () => {
    const files = await getMigrationFiles();
    for (const file of files) {
      const content = await readMigration(file);
      const checksum = computeChecksum(content);
      expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('different migration files have different checksums', async () => {
    const files = await getMigrationFiles();
    const checksums = new Set<string>();
    for (const file of files) {
      const content = await readMigration(file);
      checksums.add(computeChecksum(content));
    }
    expect(checksums.size).toBe(files.length);
  });
});

// ============================================================================
// 3. WORM Triggers — audit_logs
// ============================================================================

describe('WORM triggers — audit_logs', () => {
  it('0002 contains prevent_audit_modification function', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toContain('prevent_audit_modification');
    expect(content).toContain('RETURNS trigger');
  });

  it('blocks UPDATE on audit_logs', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+UPDATE\s+ON\s+audit_logs/i);
  });

  it('blocks DELETE on audit_logs', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+DELETE\s+ON\s+audit_logs/i);
  });

  it('blocks TRUNCATE on audit_logs', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+TRUNCATE\s+ON\s+audit_logs/i);
  });

  it('trigger function raises exception with WORM violation message', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/RAISE\s+EXCEPTION/i);
    expect(content).toContain('WORM violation');
  });
});

// ============================================================================
// 4. WORM Triggers — merkle_roots
// ============================================================================

describe('WORM triggers — merkle_roots', () => {
  it('blocks UPDATE on merkle_roots', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+UPDATE\s+ON\s+merkle_roots/i);
  });

  it('blocks DELETE on merkle_roots', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+DELETE\s+ON\s+merkle_roots/i);
  });

  it('blocks TRUNCATE on merkle_roots', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+TRUNCATE\s+ON\s+merkle_roots/i);
  });
});

// ============================================================================
// 5. WORM Triggers — consent_records
// ============================================================================

describe('WORM triggers — consent_records', () => {
  it('blocks UPDATE on consent_records', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+UPDATE\s+ON\s+consent_records/i);
  });

  it('blocks DELETE on consent_records', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+DELETE\s+ON\s+consent_records/i);
  });

  it('blocks TRUNCATE on consent_records', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+TRUNCATE\s+ON\s+consent_records/i);
  });
});

// ============================================================================
// 6. WORM Triggers — decision_audit
// ============================================================================

describe('WORM triggers — decision_audit', () => {
  it('blocks UPDATE on decision_audit', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+UPDATE\s+ON\s+decision_audit/i);
  });

  it('blocks DELETE on decision_audit', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+DELETE\s+ON\s+decision_audit/i);
  });

  it('blocks TRUNCATE on decision_audit', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    expect(content).toMatch(/BEFORE\s+TRUNCATE\s+ON\s+decision_audit/i);
  });
});

// ============================================================================
// 7. WORM — All protected tables covered
// ============================================================================

describe('WORM triggers — coverage', () => {
  it('all WORM-protected tables have UPDATE triggers', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    for (const table of WORM_TABLES) {
      const pattern = new RegExp(`BEFORE\\s+UPDATE\\s+ON\\s+${table}`, 'i');
      expect(content).toMatch(pattern);
    }
  });

  it('all WORM-protected tables have DELETE triggers', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    for (const table of WORM_TABLES) {
      const pattern = new RegExp(`BEFORE\\s+DELETE\\s+ON\\s+${table}`, 'i');
      expect(content).toMatch(pattern);
    }
  });

  it('all WORM-protected tables have TRUNCATE triggers', async () => {
    const content = await readMigration('0002_audit_worm_triggers.sql');
    for (const table of WORM_TABLES) {
      const pattern = new RegExp(`BEFORE\\s+TRUNCATE\\s+ON\\s+${table}`, 'i');
      expect(content).toMatch(pattern);
    }
  });
});

// ============================================================================
// 8. RLS Policies — all tenant-scoped tables
// ============================================================================

describe('RLS policies — tenant isolation', () => {
  it('all tenant-scoped tables have ENABLE ROW LEVEL SECURITY', async () => {
    const content = await readMigration('0003_rls_policies.sql');
    for (const table of RLS_TABLES) {
      const pattern = new RegExp(
        `ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        'i',
      );
      expect(content, `Missing ENABLE RLS for ${table}`).toMatch(pattern);
    }
  });

  it('all tenant-scoped tables have FORCE ROW LEVEL SECURITY', async () => {
    const content = await readMigration('0003_rls_policies.sql');
    for (const table of RLS_TABLES) {
      const pattern = new RegExp(
        `ALTER\\s+TABLE\\s+${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        'i',
      );
      expect(content, `Missing FORCE RLS for ${table}`).toMatch(pattern);
    }
  });

  it('all tenant-scoped tables have a tenant_isolation policy', async () => {
    const content = await readMigration('0003_rls_policies.sql');
    for (const table of RLS_TABLES) {
      const pattern = new RegExp(
        `CREATE\\s+POLICY\\s+${table}_tenant_isolation\\s+ON\\s+${table}`,
        'i',
      );
      expect(content, `Missing tenant_isolation policy for ${table}`).toMatch(pattern);
    }
  });

  it('RLS policies use current_setting for tenant_id', async () => {
    const content = await readMigration('0003_rls_policies.sql');
    expect(content).toContain("current_setting('app.current_tenant')");
  });

  it('RLS policies use USING clause (read filter)', async () => {
    const content = await readMigration('0003_rls_policies.sql');
    // Should have USING clause for each policy
    const usingCount = (content.match(/USING\s*\(/gi) ?? []).length;
    expect(usingCount).toBeGreaterThanOrEqual(RLS_TABLES.length);
  });

  it('RLS policies use WITH CHECK clause (write filter)', async () => {
    const content = await readMigration('0003_rls_policies.sql');
    const checkCount = (content.match(/WITH\s+CHECK\s*\(/gi) ?? []).length;
    expect(checkCount).toBeGreaterThanOrEqual(RLS_TABLES.length);
  });
});

// ============================================================================
// 9. Initial Schema — Table Completeness
// ============================================================================

describe('initial schema — table completeness', () => {
  const EXPECTED_TABLES = [
    'tenants',
    'users',
    'sessions',
    'api_keys',
    'customers',
    'interactions',
    'audit_logs',
    'merkle_roots',
    'agent_actions',
    'compliance_records',
    'contacts',
    'consent_records',
    'agent_sessions',
    'messages',
    'payment_records',
    'decision_rules',
    'decision_audit',
    'channel_preferences',
    'organizations',
    'sso_connections',
    'custom_roles',
    'user_custom_roles',
    'scim_tokens',
    'white_label_configs',
    'developer_accounts',
    'developer_usage',
    'sandbox_tenants',
    'marketplace_agents',
    'marketplace_reviews',
    'marketplace_installs',
    'agent_memories',
    'sentiment_history',
    'partners',
    'partner_payouts',
    '_migrations',
  ];

  it('creates all required tables', async () => {
    const content = await readMigration('0001_initial_schema.sql');
    for (const table of EXPECTED_TABLES) {
      const pattern = new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${table}\\s*\\(`, 'i');
      expect(content, `Missing CREATE TABLE for ${table}`).toMatch(pattern);
    }
  });

  it('creates all required enums', async () => {
    const content = await readMigration('0001_initial_schema.sql');
    const expectedEnums = [
      'plan',
      'tenant_status',
      'isolation_tier',
      'user_role',
      'user_status',
      'actor_type',
      'customer_type',
      'customer_status',
      'lifecycle_stage',
      'channel',
      'direction',
      'interaction_type',
      'contact_channel',
      'consent_status',
      'consent_action',
      'consent_method',
      'agent_session_status',
      'autonomy_level',
      'message_direction',
      'message_status',
      'payment_status',
      'payment_method',
      'compliance_result',
      'sso_connection_type',
      'sso_connection_status',
      'developer_tier',
      'developer_status',
      'sandbox_status',
      'marketplace_agent_status',
      'marketplace_install_status',
      'sentiment_label',
      'partner_tier',
      'partner_status',
      'partner_payout_status',
    ];

    for (const enumName of expectedEnums) {
      const pattern = new RegExp(`CREATE\\s+TYPE\\s+${enumName}\\s+AS\\s+ENUM`, 'i');
      expect(content, `Missing CREATE TYPE for ${enumName}`).toMatch(pattern);
    }
  });

  it('creates _migrations tracking table', async () => {
    const content = await readMigration('0001_initial_schema.sql');
    expect(content).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+_migrations/i);
  });

  it('_migrations table has checksum column', async () => {
    const content = await readMigration('0001_initial_schema.sql');
    expect(content).toContain('checksum');
  });

  it('enables uuid-ossp extension', async () => {
    const content = await readMigration('0001_initial_schema.sql');
    expect(content).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+"uuid-ossp"/i);
  });
});

// ============================================================================
// 10. Seed Data — Validation
// ============================================================================

describe('seed data — structure and safety', () => {
  it('seed.ts exports seedDatabase function', async () => {
    const mod = await import('../seed.js');
    expect(typeof mod.seedDatabase).toBe('function');
  });

  it('seed file does not contain real passwords', async () => {
    const content = await readFile(
      resolve(fileURLToPath(import.meta.url), '../../seed.ts'),
      'utf8',
    );
    // Must not contain common real password patterns
    expect(content).not.toMatch(/password123/i);
    expect(content).not.toMatch(/admin123/i);
    expect(content).not.toMatch(/changeme/i);
    // Should use placeholder hash
    expect(content).toContain('placeholder');
  });

  it('seed file uses ON CONFLICT DO NOTHING for idempotency', async () => {
    const content = await readFile(
      resolve(fileURLToPath(import.meta.url), '../../seed.ts'),
      'utf8',
    );
    const conflictCount = (content.match(/ON\s+CONFLICT/gi) ?? []).length;
    // At least the tenant + 4 users + decision rules + test data
    expect(conflictCount).toBeGreaterThanOrEqual(5);
  });

  it('seed file gates test data behind NODE_ENV check', async () => {
    const content = await readFile(
      resolve(fileURLToPath(import.meta.url), '../../seed.ts'),
      'utf8',
    );
    expect(content).toContain('isProduction');
    expect(content).toContain("NODE_ENV");
  });

  it('seed file uses deterministic UUIDs (not random)', async () => {
    const content = await readFile(
      resolve(fileURLToPath(import.meta.url), '../../seed.ts'),
      'utf8',
    );
    // Deterministic UUIDs start with 00000000
    expect(content).toContain('00000000-0000-4000');
  });

  it('seed file does not contain real PII/PHI', async () => {
    const content = await readFile(
      resolve(fileURLToPath(import.meta.url), '../../seed.ts'),
      'utf8',
    );
    // Test data uses .test / .local domains and enc: prefix
    expect(content).not.toMatch(/@gmail\.com/i);
    expect(content).not.toMatch(/@outlook\.com/i);
    expect(content).toContain('.local');
    expect(content).toContain('enc:');
  });
});

// ============================================================================
// 11. Migration Runner — API
// ============================================================================

describe('migration runner — API', () => {
  it('exports runMigrations function', async () => {
    const mod = await import('../migrate.js');
    expect(typeof mod.runMigrations).toBe('function');
  });

  it('exports getMigrationStatus function', async () => {
    const mod = await import('../migrate.js');
    expect(typeof mod.getMigrationStatus).toBe('function');
  });
});

// ============================================================================
// 12. Migration Order
// ============================================================================

describe('migration order — sequential', () => {
  it('migration files are numbered sequentially', async () => {
    const files = await getMigrationFiles();
    for (let i = 0; i < files.length; i++) {
      const prefix = files[i]!.split('_')[0]!;
      const expected = String(i + 1).padStart(4, '0');
      expect(prefix).toBe(expected);
    }
  });

  it('migration files are already in sorted order', async () => {
    const files = await getMigrationFiles();
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });
});

// ============================================================================
// 13. Safety Checks
// ============================================================================

describe('migration safety checks', () => {
  it('no DROP TABLE in non-initial migrations', async () => {
    const files = await getMigrationFiles();
    for (const file of files) {
      if (file === '0001_initial_schema.sql') continue;
      const content = await readMigration(file);
      expect(content, `DROP TABLE found in ${file}`).not.toMatch(/DROP\s+TABLE/i);
    }
  });

  it('no DROP SCHEMA in any migration', async () => {
    const files = await getMigrationFiles();
    for (const file of files) {
      const content = await readMigration(file);
      expect(content, `DROP SCHEMA found in ${file}`).not.toMatch(/DROP\s+SCHEMA/i);
    }
  });

  it('no TRUNCATE in any migration', async () => {
    const files = await getMigrationFiles();
    for (const file of files) {
      const content = await readMigration(file);
      // Allow TRUNCATE in trigger definitions (BEFORE TRUNCATE ON ...)
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.trim().startsWith('--')) continue;
        if (line.match(/BEFORE\s+TRUNCATE/i)) continue;
        if (line.match(/TRUNCATE\s+ON/i)) continue;
        expect(line, `Bare TRUNCATE in ${file}`).not.toMatch(/^\s*TRUNCATE\s+/i);
      }
    }
  });

  it('initial migration does not contain secrets or real credentials', async () => {
    const content = await readMigration('0001_initial_schema.sql');
    expect(content).not.toMatch(/password\s*=\s*'/i);
    expect(content).not.toMatch(/secret\s*=\s*'/i);
    expect(content).not.toMatch(/api_key\s*=\s*'/i);
  });
});

// ============================================================================
// 14. Backup Terraform Module
// ============================================================================

describe('backup terraform module', () => {
  const BACKUP_DIR = resolve(
    fileURLToPath(import.meta.url),
    '../../../../../infrastructure/terraform/modules/backup',
  );

  it('main.tf exists', async () => {
    const content = await readFile(join(BACKUP_DIR, 'main.tf'), 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('variables.tf exists', async () => {
    const content = await readFile(join(BACKUP_DIR, 'variables.tf'), 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('outputs.tf exists', async () => {
    const content = await readFile(join(BACKUP_DIR, 'outputs.tf'), 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('has cross-region replication configuration', async () => {
    const content = await readFile(join(BACKUP_DIR, 'main.tf'), 'utf8');
    expect(content).toContain('automated_backups_replication');
  });

  it('has backup retention period >= 35 days', async () => {
    const content = await readFile(join(BACKUP_DIR, 'variables.tf'), 'utf8');
    expect(content).toContain('backup_retention_days');
    expect(content).toMatch(/default\s*=\s*35/);
  });

  it('validates minimum retention period', async () => {
    const content = await readFile(join(BACKUP_DIR, 'variables.tf'), 'utf8');
    expect(content).toContain('>= 35');
  });

  it('uses KMS encryption for DR backups', async () => {
    const content = await readFile(join(BACKUP_DIR, 'main.tf'), 'utf8');
    expect(content).toContain('kms_key_id');
    expect(content).toContain('aws_kms_key');
  });

  it('has backup event notifications (SNS)', async () => {
    const content = await readFile(join(BACKUP_DIR, 'main.tf'), 'utf8');
    expect(content).toContain('aws_sns_topic');
    expect(content).toContain('backup_events');
  });

  it('has CloudWatch alarm for backup monitoring', async () => {
    const content = await readFile(join(BACKUP_DIR, 'main.tf'), 'utf8');
    expect(content).toContain('aws_cloudwatch_metric_alarm');
  });

  it('outputs DR KMS key ARN', async () => {
    const content = await readFile(join(BACKUP_DIR, 'outputs.tf'), 'utf8');
    expect(content).toContain('dr_kms_key_arn');
  });

  it('outputs backup replication ARN', async () => {
    const content = await readFile(join(BACKUP_DIR, 'outputs.tf'), 'utf8');
    expect(content).toContain('backup_replication_arn');
  });
});

// ============================================================================
// 15. Schema Consistency — cross-file validation
// ============================================================================

describe('schema consistency', () => {
  it('initial migration has tenant_id on all RLS tables', async () => {
    const content = await readMigration('0001_initial_schema.sql');
    for (const table of RLS_TABLES) {
      // Extract the CREATE TABLE block for this table and check for tenant_id
      const blockPattern = new RegExp(
        `CREATE\\s+TABLE\\s+${table}\\s*\\([\\s\\S]*?\\);`,
        'i',
      );
      const match = content.match(blockPattern);
      expect(match, `CREATE TABLE ${table} not found`).not.toBeNull();
      expect(match![0], `Table ${table} missing tenant_id`).toContain('tenant_id');
    }
  });

  it('audit_logs table has hash chain columns', async () => {
    const content = await readMigration('0001_initial_schema.sql');
    expect(content).toMatch(/previous_hash\s+TEXT\s+NOT\s+NULL/i);
    expect(content).toMatch(/hash\s+TEXT\s+NOT\s+NULL/i);
    expect(content).toMatch(/sequence_number\s+BIGINT\s+NOT\s+NULL/i);
  });

  it('audit_logs has unique constraint on tenant + sequence', async () => {
    const content = await readMigration('0001_initial_schema.sql');
    expect(content).toContain('audit_logs_tenant_seq_uniq');
  });

  it('merkle_roots has unique constraint on tenant + batch_start', async () => {
    const content = await readMigration('0001_initial_schema.sql');
    expect(content).toContain('merkle_roots_tenant_batch_start_uniq');
  });
});

// ============================================================================
// 16. Disaster Recovery Runbook
// ============================================================================

describe('disaster recovery runbook', () => {
  const RUNBOOK_PATH = resolve(
    fileURLToPath(import.meta.url),
    '../../../../../docs/runbooks/disaster-recovery.md',
  );

  it('runbook exists', async () => {
    const content = await readFile(RUNBOOK_PATH, 'utf8');
    expect(content.length).toBeGreaterThan(0);
  });

  it('defines RTO targets', async () => {
    const content = await readFile(RUNBOOK_PATH, 'utf8');
    expect(content).toContain('RTO');
    expect(content).toContain('60 seconds');
    expect(content).toContain('300 seconds');
  });

  it('defines RPO targets', async () => {
    const content = await readFile(RUNBOOK_PATH, 'utf8');
    expect(content).toContain('RPO');
  });

  it('includes multi-AZ failover procedure', async () => {
    const content = await readFile(RUNBOOK_PATH, 'utf8');
    expect(content).toContain('Multi-AZ');
    expect(content).toContain('failover');
  });

  it('includes point-in-time recovery procedure', async () => {
    const content = await readFile(RUNBOOK_PATH, 'utf8');
    expect(content).toContain('Point-in-Time');
    expect(content).toContain('restore-db-instance-to-point-in-time');
  });

  it('includes region DR procedure', async () => {
    const content = await readFile(RUNBOOK_PATH, 'utf8');
    expect(content).toContain('Full Region');
    expect(content).toContain('restore-db-instance-from-db-snapshot');
  });

  it('includes monthly backup verification procedure', async () => {
    const content = await readFile(RUNBOOK_PATH, 'utf8');
    expect(content).toContain('Monthly');
    expect(content).toContain('verification');
  });

  it('includes escalation chain', async () => {
    const content = await readFile(RUNBOOK_PATH, 'utf8');
    expect(content).toContain('Escalation');
    expect(content).toContain('L1');
    expect(content).toContain('L2');
  });

  it('references compliance standards', async () => {
    const content = await readFile(RUNBOOK_PATH, 'utf8');
    expect(content).toContain('HIPAA');
    expect(content).toContain('SOC2');
    expect(content).toContain('ISO 27001');
  });
});
