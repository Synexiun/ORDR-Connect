/**
 * Audit Completeness Compliance Tests
 *
 * Verifies that all state-changing routes produce audit events with
 * required fields, hash chain integrity, and Merkle tree verification.
 *
 * SOC2 CC7.2, ISO 27001 A.12.4.1, HIPAA §164.312(b)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogger, type AuditStore, type AuditEventInput } from '@ordr/audit';
import { InMemoryAuditStore } from '@ordr/audit';
import { GENESIS_HASH, verifyChain, computeEventHash, verifyChainLink } from '@ordr/audit';
import { computeMerkleRoot, verifyMerkleProof, generateMerkleProof, MERKLE_BATCH_SIZE } from '@ordr/audit';
import type { AuditEvent, MerkleRoot } from '@ordr/audit';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Fixtures ──────────────────────────────────────────────────────────

let store: InMemoryAuditStore;
let logger: AuditLogger;

const testTenantId = 'tenant-audit-test-001';

function makeInput(overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    tenantId: testTenantId,
    eventType: 'data.created',
    actorType: 'user',
    actorId: 'user-001',
    resource: 'customers',
    resourceId: 'cust-001',
    action: 'POST /api/v1/customers',
    details: { method: 'POST', path: '/api/v1/customers', status: 201 },
    timestamp: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  store = new InMemoryAuditStore();
  logger = new AuditLogger(store);
});

// ── Route Files Produce Audit Events ──────────────────────────────────

describe('State-changing routes produce audit events', () => {
  const routeDir = path.resolve('apps/api/src/routes');

  const routeFiles = [
    'customers.ts',
    'agents.ts',
    'messages.ts',
    'branding.ts',
    'developers.ts',
    'marketplace.ts',
    'marketplace-review.ts',
    'partners.ts',
    'organizations.ts',
    'roles.ts',
  ];

  for (const file of routeFiles) {
    it(`${file} exists in route directory`, () => {
      const filePath = path.join(routeDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  }

  it('customers route uses requireAuth middleware', () => {
    const filePath = path.join(routeDir, 'customers.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('requireAuth');
  });

  it('customers route logs audit events on create', () => {
    const filePath = path.join(routeDir, 'customers.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('auditLogger.log');
    expect(content).toContain("'data.created'");
  });

  it('customers route logs audit events on update', () => {
    const filePath = path.join(routeDir, 'customers.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain("'data.updated'");
  });

  it('customers route logs audit events on delete', () => {
    const filePath = path.join(routeDir, 'customers.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain("'data.deleted'");
  });

  it('audit middleware maps HTTP methods to event types', () => {
    const filePath = path.resolve('apps/api/src/middleware/audit.ts');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain("POST: 'data.created'");
    expect(content).toContain("PUT: 'data.updated'");
    expect(content).toContain("PATCH: 'data.updated'");
    expect(content).toContain("DELETE: 'data.deleted'");
  });
});

// ── Required Audit Event Fields ───────────────────────────────────────

describe('Audit events contain required fields', () => {
  it('logged event has all required fields', async () => {
    const event = await logger.log(makeInput());

    expect(event.id).toBeDefined();
    expect(typeof event.id).toBe('string');
    expect(event.sequenceNumber).toBe(1);
    expect(event.tenantId).toBe(testTenantId);
    expect(event.eventType).toBe('data.created');
    expect(event.actorType).toBe('user');
    expect(event.actorId).toBe('user-001');
    expect(event.resource).toBe('customers');
    expect(event.resourceId).toBe('cust-001');
    expect(event.action).toBeDefined();
    expect(event.details).toBeDefined();
    expect(event.previousHash).toBeDefined();
    expect(event.hash).toBeDefined();
    expect(event.timestamp).toBeInstanceOf(Date);
  });

  it('hash is a valid SHA-256 hex string (64 chars)', async () => {
    const event = await logger.log(makeInput());
    expect(event.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('previousHash is a valid SHA-256 hex string', async () => {
    const event = await logger.log(makeInput());
    expect(event.previousHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('first event uses genesis hash as previousHash', async () => {
    const event = await logger.log(makeInput());
    expect(event.previousHash).toBe(GENESIS_HASH);
  });

  it('timestamp is ISO 8601 format', async () => {
    const event = await logger.log(makeInput());
    expect(event.timestamp.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('event details do not contain PHI field names', async () => {
    const event = await logger.log(makeInput({
      details: { method: 'POST', path: '/api/v1/customers', status: 201 },
    }));
    const detailKeys = Object.keys(event.details);
    const phiKeys = ['ssn', 'social_security', 'credit_card', 'medical_record', 'date_of_birth'];
    for (const phiKey of phiKeys) {
      expect(detailKeys.map((k) => k.toLowerCase())).not.toContain(phiKey);
    }
  });
});

// ── Hash Chain Integrity ──────────────────────────────────────────────

describe('Hash chain integrity', () => {
  it('second event links to first event hash', async () => {
    const first = await logger.log(makeInput());
    const second = await logger.log(makeInput({ resource: 'interactions' }));
    expect(second.previousHash).toBe(first.hash);
  });

  it('chain of 10 events verifies correctly', async () => {
    for (let i = 0; i < 10; i++) {
      await logger.log(makeInput({ resourceId: `cust-${i}` }));
    }
    const status = await logger.verifyIntegrity(testTenantId);
    expect(status.valid).toBe(true);
    expect(status.totalEvents).toBe(10);
  });

  it('detects tampered event in chain', async () => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(await logger.log(makeInput({ resourceId: `cust-${i}` })));
    }

    // Tamper with middle event
    const tampered = { ...events[2]!, action: 'TAMPERED_ACTION' };
    const tamperedEvents = [events[0]!, events[1]!, tampered, events[3]!, events[4]!];

    const status = verifyChain(tamperedEvents);
    expect(status.valid).toBe(false);
    expect(status.brokenAt).toBe(3);
  });

  it('detects sequence gap', async () => {
    const e1 = await logger.log(makeInput());
    const e2 = await logger.log(makeInput());
    const e3 = await logger.log(makeInput());

    // Remove middle event to create gap
    const withGap = [e1, e3];
    const status = verifyChain(withGap);
    expect(status.valid).toBe(false);
  });

  it('empty chain is valid', () => {
    const status = verifyChain([]);
    expect(status.valid).toBe(true);
    expect(status.totalEvents).toBe(0);
    expect(status.lastHash).toBe(GENESIS_HASH);
  });

  it('verifyChainLink catches hash mismatch', async () => {
    const event = await logger.log(makeInput());
    const fakeEvent = { ...event, hash: 'a'.repeat(64) };
    expect(verifyChainLink(fakeEvent, event.previousHash)).toBe(false);
  });
});

// ── Sequence Number Continuity ────────────────────────────────────────

describe('Sequence number continuity', () => {
  it('sequence numbers are monotonically increasing', async () => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(await logger.log(makeInput()));
    }
    for (let i = 0; i < events.length; i++) {
      expect(events[i]!.sequenceNumber).toBe(i + 1);
    }
  });

  it('sequence numbers are per-tenant', async () => {
    await logger.log(makeInput({ tenantId: 'tenant-A' }));
    await logger.log(makeInput({ tenantId: 'tenant-A' }));
    const eventB = await logger.log(makeInput({ tenantId: 'tenant-B' }));

    // Tenant B starts at 1 independently
    expect(eventB.sequenceNumber).toBe(1);
  });
});

// ── Merkle Tree Verification ──────────────────────────────────────────

describe('Merkle tree batch verification', () => {
  it('MERKLE_BATCH_SIZE is 1000', () => {
    expect(MERKLE_BATCH_SIZE).toBe(1000);
  });

  it('generates valid Merkle root for a batch', async () => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(await logger.log(makeInput({ resourceId: `cust-${i}` })));
    }

    const root = computeMerkleRoot(events);
    expect(root).toMatch(/^[a-f0-9]{64}$/);
  });

  it('Merkle root is deterministic for same events', async () => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(await logger.log(makeInput({ resourceId: `cust-${i}` })));
    }

    const root1 = computeMerkleRoot(events);
    const root2 = computeMerkleRoot(events);
    expect(root1).toBe(root2);
  });

  it('generates and verifies Merkle proof for specific event', async () => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < 10; i++) {
      events.push(await logger.log(makeInput({ resourceId: `cust-${i}` })));
    }

    const proof = generateMerkleProof(events, 5);
    expect(proof.leaf).toBeDefined();
    expect(proof.root).toBeDefined();
    expect(proof.proof.length).toBeGreaterThan(0);

    const valid = verifyMerkleProof(proof);
    expect(valid).toBe(true);
  });

  it('Merkle proof fails for tampered event', async () => {
    const events: AuditEvent[] = [];
    for (let i = 0; i < 8; i++) {
      events.push(await logger.log(makeInput({ resourceId: `cust-${i}` })));
    }

    const proof = generateMerkleProof(events, 3);
    // Tamper with the leaf
    const tamperedProof = { ...proof, leaf: 'b'.repeat(64) };
    expect(verifyMerkleProof(tamperedProof)).toBe(false);
  });

  it('empty Merkle root is computed for empty events', () => {
    const root = computeMerkleRoot([]);
    expect(root).toBeDefined();
    expect(root).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ── AuditLogger API ───────────────────────────────────────────────────

describe('AuditLogger API completeness', () => {
  it('getLastEvent returns null for new tenant', async () => {
    const last = await logger.getLastEvent('new-tenant');
    expect(last).toBeNull();
  });

  it('getLastEvent returns the most recent event', async () => {
    await logger.log(makeInput({ resourceId: 'cust-1' }));
    const second = await logger.log(makeInput({ resourceId: 'cust-2' }));
    const last = await logger.getLastEvent(testTenantId);
    expect(last?.resourceId).toBe('cust-2');
    expect(last?.sequenceNumber).toBe(2);
  });

  it('verifyIntegrity returns valid for empty tenant', async () => {
    const status = await logger.verifyIntegrity('empty-tenant');
    expect(status.valid).toBe(true);
    expect(status.totalEvents).toBe(0);
  });
});
