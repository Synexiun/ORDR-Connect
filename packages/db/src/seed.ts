// ---------------------------------------------------------------------------
// @ordr/db — Database Seeder
//
// Idempotent seed data for development and initial production bootstrap.
// Uses INSERT ... ON CONFLICT DO NOTHING for safe re-runs.
//
// SECURITY:
//   - NEVER stores real credentials — uses placeholder hashes only
//   - Test data is gated behind NODE_ENV !== 'production'
//   - All UUIDs are deterministic (reproducible seeds)
//   - No PHI/PII in seed data
//
// SOC2 CC6.1 — Seeded roles follow principle of least privilege.
// HIPAA §164.308(a)(4) — Access authorization baseline.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import postgres from 'postgres';

// ---------------------------------------------------------------------------
// Deterministic UUIDs for seed data (reproducible, not random)
// ---------------------------------------------------------------------------

const SEED_TENANT_ID = '00000000-0000-4000-a000-000000000001';
const SEED_ADMIN_USER_ID = '00000000-0000-4000-a000-000000000010';
const SEED_MANAGER_USER_ID = '00000000-0000-4000-a000-000000000011';
const SEED_AGENT_USER_ID = '00000000-0000-4000-a000-000000000012';
const SEED_VIEWER_USER_ID = '00000000-0000-4000-a000-000000000013';

// Test data UUIDs (development only)
const TEST_CUSTOMER_1 = '00000000-0000-4000-b000-000000000001';
const TEST_CUSTOMER_2 = '00000000-0000-4000-b000-000000000002';
const TEST_CONTACT_1 = '00000000-0000-4000-c000-000000000001';
const TEST_CONTACT_2 = '00000000-0000-4000-c000-000000000002';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Placeholder Argon2id hash — represents 'seed-password-not-for-production'
 * This is NOT a real password hash. Production users must set their own
 * password through the auth flow.
 */
const PLACEHOLDER_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c2VlZC1zYWx0LW5vdC1mb3ItcHJvZA$placeholder-hash-seed-only';

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Core seed function
// ---------------------------------------------------------------------------

export async function seedDatabase(connectionUrl: string): Promise<void> {
  const sql = postgres(connectionUrl, { max: 1 });
  const isProduction = process.env['NODE_ENV'] === 'production';

  try {
    // ── Default tenant template ──────────────────────────────────
    await sql`
      INSERT INTO tenants (id, name, slug, plan, status, isolation_tier, settings)
      VALUES (
        ${SEED_TENANT_ID},
        'Default Tenant',
        'default',
        'professional',
        'active',
        'shared',
        ${JSON.stringify({
          features: {
            agents: true,
            marketplace: true,
            whiteLabel: false,
            sso: false,
          },
          regulations: {
            hipaa: true,
            fdcpa: true,
            tcpa: true,
            gdpr: true,
            ccpa: true,
          },
          limits: {
            maxUsers: 50,
            maxCustomers: 10000,
            maxAgentSessions: 1000,
          },
        })}
      )
      ON CONFLICT (slug) DO NOTHING
    `;

    // ── Admin user ───────────────────────────────────────────────
    await sql`
      INSERT INTO users (id, tenant_id, email, name, password_hash, role, status, mfa_enabled)
      VALUES (
        ${SEED_ADMIN_USER_ID},
        ${SEED_TENANT_ID},
        'admin@ordr-connect.local',
        'System Administrator',
        ${PLACEHOLDER_PASSWORD_HASH},
        'tenant_admin',
        'active',
        false
      )
      ON CONFLICT ON CONSTRAINT users_tenant_email_uniq DO NOTHING
    `;

    // ── Manager user ─────────────────────────────────────────────
    await sql`
      INSERT INTO users (id, tenant_id, email, name, password_hash, role, status, mfa_enabled)
      VALUES (
        ${SEED_MANAGER_USER_ID},
        ${SEED_TENANT_ID},
        'manager@ordr-connect.local',
        'Operations Manager',
        ${PLACEHOLDER_PASSWORD_HASH},
        'manager',
        'active',
        false
      )
      ON CONFLICT ON CONSTRAINT users_tenant_email_uniq DO NOTHING
    `;

    // ── Agent user ───────────────────────────────────────────────
    await sql`
      INSERT INTO users (id, tenant_id, email, name, password_hash, role, status, mfa_enabled)
      VALUES (
        ${SEED_AGENT_USER_ID},
        ${SEED_TENANT_ID},
        'agent@ordr-connect.local',
        'Collections Agent',
        ${PLACEHOLDER_PASSWORD_HASH},
        'agent',
        'active',
        false
      )
      ON CONFLICT ON CONSTRAINT users_tenant_email_uniq DO NOTHING
    `;

    // ── Viewer user ──────────────────────────────────────────────
    await sql`
      INSERT INTO users (id, tenant_id, email, name, password_hash, role, status, mfa_enabled)
      VALUES (
        ${SEED_VIEWER_USER_ID},
        ${SEED_TENANT_ID},
        'viewer@ordr-connect.local',
        'Dashboard Viewer',
        ${PLACEHOLDER_PASSWORD_HASH},
        'viewer',
        'active',
        false
      )
      ON CONFLICT ON CONSTRAINT users_tenant_email_uniq DO NOTHING
    `;

    // ── Default decision rules (compliance) ──────────────────────
    await sql`
      INSERT INTO decision_rules (id, tenant_id, name, description, priority, conditions, action, regulation, enabled, terminal)
      VALUES
        (
          '00000000-0000-4000-d000-000000000001',
          ${SEED_TENANT_ID},
          'TCPA Quiet Hours',
          'Block outbound calls and SMS outside permitted hours (8am-9pm local)',
          100,
          ${JSON.stringify([{ field: 'local_time', operator: 'not_between', value: ['08:00', '21:00'] }])},
          ${JSON.stringify({ type: 'block', channel: 'all', parameters: { reason: 'TCPA quiet hours' } })},
          'tcpa',
          true,
          true
        ),
        (
          '00000000-0000-4000-d000-000000000002',
          ${SEED_TENANT_ID},
          'FDCPA Cease Communication',
          'Block all communication to customers who have requested cease contact',
          99,
          ${JSON.stringify([{ field: 'customer.cease_contact', operator: 'equals', value: true }])},
          ${JSON.stringify({ type: 'block', channel: 'all', parameters: { reason: 'FDCPA cease communication' } })},
          'fdcpa',
          true,
          true
        ),
        (
          '00000000-0000-4000-d000-000000000003',
          ${SEED_TENANT_ID},
          'HIPAA Minimum Necessary',
          'Restrict agent access to minimum necessary PHI for task completion',
          95,
          ${JSON.stringify([{ field: 'data_classification', operator: 'equals', value: 'restricted' }])},
          ${JSON.stringify({ type: 'require_justification', channel: 'internal', parameters: { log_access: true } })},
          'hipaa',
          true,
          false
        ),
        (
          '00000000-0000-4000-d000-000000000004',
          ${SEED_TENANT_ID},
          'Low Confidence Escalation',
          'Escalate to human when agent confidence is below threshold',
          80,
          ${JSON.stringify([{ field: 'agent.confidence', operator: 'less_than', value: 0.7 }])},
          ${JSON.stringify({ type: 'escalate', channel: 'internal', parameters: { target: 'human_review_queue' } })},
          null,
          true,
          false
        )
      ON CONFLICT DO NOTHING
    `;

    // ── Development-only test data ───────────────────────────────
    if (!isProduction) {
      // Test customers (ENCRYPTED field values are placeholders — not real PII)
      await sql`
        INSERT INTO customers (id, tenant_id, external_id, type, status, name, email, phone, health_score, lifecycle_stage)
        VALUES
          (
            ${TEST_CUSTOMER_1},
            ${SEED_TENANT_ID},
            'EXT-001',
            'individual',
            'active',
            'enc:test-customer-alice',
            'enc:alice@example.test',
            'enc:+15551234567',
            85,
            'customer'
          ),
          (
            ${TEST_CUSTOMER_2},
            ${SEED_TENANT_ID},
            'EXT-002',
            'company',
            'active',
            'enc:test-company-acme',
            'enc:billing@acme.test',
            'enc:+15559876543',
            42,
            'churning'
          )
        ON CONFLICT DO NOTHING
      `;

      // Test contacts (ENCRYPTED values)
      await sql`
        INSERT INTO contacts (id, tenant_id, customer_id, channel, value, value_hash, label, is_primary, consent_status, verified)
        VALUES
          (
            ${TEST_CONTACT_1},
            ${SEED_TENANT_ID},
            ${TEST_CUSTOMER_1},
            'email',
            'enc:alice@example.test',
            ${sha256('alice@example.test')},
            'primary',
            true,
            'opted_in',
            true
          ),
          (
            ${TEST_CONTACT_2},
            ${SEED_TENANT_ID},
            ${TEST_CUSTOMER_2},
            'sms',
            'enc:+15559876543',
            ${sha256('+15559876543')},
            'primary',
            true,
            'opted_in',
            true
          )
        ON CONFLICT DO NOTHING
      `;

      console.warn(
        JSON.stringify({ level: 'info', component: 'db-seed', event: 'dev_data_seeded' }),
      );
    }

    console.warn(JSON.stringify({ level: 'info', component: 'db-seed', event: 'seed_complete' }));
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

const isDirectRun =
  process.argv[1] !== undefined &&
  process.argv[1] !== '' &&
  (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'));

if (isDirectRun) {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    console.error(
      JSON.stringify({
        level: 'error',
        component: 'db-seed',
        event: 'missing_env',
        var: 'DATABASE_URL',
      }),
    );
    process.exit(1);
  }

  await seedDatabase(url);
}
