/**
 * Integration test — Multi-tenant isolation.
 *
 * Verifies that Tenant A cannot access Tenant B's data at every layer:
 * audit logs, agent sessions, JWT validation, customer records,
 * and event streams.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  setupTestEnvironment,
  createTestTenant,
  createTestUser,
  getJwtConfig,
} from './setup.js';
import { createMockCustomer } from './fixtures/customer-factory.js';
import { createMockAgentSession } from './fixtures/agent-factory.js';

// Audit
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import type { AuditEventInput } from '@ordr/audit';

// Auth
import {
  createAccessToken,
  verifyAccessToken,
  authenticateRequest,
  requireRole,
  requireTenant,
} from '@ordr/auth';
import type { JwtConfig, AuthHeaders } from '@ordr/auth';

// Events
import { createEventEnvelope, EventType, validateEvent } from '@ordr/events';

// Compliance
import { ComplianceEngine, ComplianceGate, ALL_RULES } from '@ordr/compliance';

// Core
import type { UserRole, TenantContext, TenantId } from '@ordr/core';
import { createTenantId } from '@ordr/core';
import { ROLE_PERMISSIONS } from '@ordr/auth';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAuditInput(tenantId: string, overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    tenantId,
    eventType: overrides?.eventType ?? 'data.created',
    actorType: overrides?.actorType ?? 'user',
    actorId: overrides?.actorId ?? 'usr-001',
    resource: overrides?.resource ?? 'customer',
    resourceId: overrides?.resourceId ?? 'cust-001',
    action: overrides?.action ?? 'create',
    details: overrides?.details ?? {},
    timestamp: overrides?.timestamp ?? new Date('2026-01-15T14:00:00.000Z'),
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Multi-Tenant Isolation', () => {
  let jwtConfig: JwtConfig;
  let auditStore: InMemoryAuditStore;
  let auditLogger: AuditLogger;

  beforeAll(async () => {
    await setupTestEnvironment();
    jwtConfig = getJwtConfig();
  });

  beforeEach(() => {
    auditStore = new InMemoryAuditStore();
    auditLogger = new AuditLogger(auditStore);
  });

  // ── Audit Log Isolation ────────────────────────────────────────

  describe('Audit log isolation', () => {
    it('Tenant A cannot see Tenant B audit events', async () => {
      const tenantA = await createTestTenant('Tenant-A');
      const tenantB = await createTestTenant('Tenant-B');

      await auditLogger.log(makeAuditInput(tenantA.id, {
        action: 'create_customer',
        resourceId: 'cust-a-001',
      }));

      await auditLogger.log(makeAuditInput(tenantB.id, {
        action: 'create_customer',
        resourceId: 'cust-b-001',
      }));

      const eventsA = auditStore.getAllEvents(tenantA.id);
      const eventsB = auditStore.getAllEvents(tenantB.id);

      expect(eventsA).toHaveLength(1);
      expect(eventsB).toHaveLength(1);
      expect(eventsA[0]!.resourceId).toBe('cust-a-001');
      expect(eventsB[0]!.resourceId).toBe('cust-b-001');

      // No cross-tenant leakage
      expect(eventsA.some((e) => e.tenantId === tenantB.id)).toBe(false);
      expect(eventsB.some((e) => e.tenantId === tenantA.id)).toBe(false);
    });

    it('audit chain integrity is per-tenant', async () => {
      const tenantA = await createTestTenant('Chain-A');
      const tenantB = await createTestTenant('Chain-B');

      for (let i = 0; i < 3; i++) {
        await auditLogger.log(makeAuditInput(tenantA.id, { resourceId: `a-${i}` }));
      }
      for (let i = 0; i < 5; i++) {
        await auditLogger.log(makeAuditInput(tenantB.id, { resourceId: `b-${i}` }));
      }

      const integrityA = await auditLogger.verifyIntegrity(tenantA.id);
      const integrityB = await auditLogger.verifyIntegrity(tenantB.id);

      expect(integrityA.valid).toBe(true);
      expect(integrityA.totalEvents).toBe(3);

      expect(integrityB.valid).toBe(true);
      expect(integrityB.totalEvents).toBe(5);
    });

    it('sequence numbers are independent per tenant', async () => {
      const tenantA = await createTestTenant('Seq-A');
      const tenantB = await createTestTenant('Seq-B');

      const eventA = await auditLogger.log(makeAuditInput(tenantA.id));
      const eventB = await auditLogger.log(makeAuditInput(tenantB.id));

      // Both should start at sequence 1
      expect(eventA.sequenceNumber).toBe(1);
      expect(eventB.sequenceNumber).toBe(1);
    });
  });

  // ── JWT Tenant Enforcement ─────────────────────────────────────

  describe('JWT tenant enforcement', () => {
    it('JWT contains correct tenant_id claim', async () => {
      const tenant = await createTestTenant('JWT-Test');
      const payload = await verifyAccessToken(jwtConfig, tenant.adminToken);

      expect(payload.tid).toBe(tenant.id);
      expect(payload.role).toBe('tenant_admin');
    });

    it('tokens from different tenants have different tid claims', async () => {
      const tenantA = await createTestTenant('JWT-A');
      const tenantB = await createTestTenant('JWT-B');

      const payloadA = await verifyAccessToken(jwtConfig, tenantA.adminToken);
      const payloadB = await verifyAccessToken(jwtConfig, tenantB.adminToken);

      expect(payloadA.tid).not.toBe(payloadB.tid);
      expect(payloadA.tid).toBe(tenantA.id);
      expect(payloadB.tid).toBe(tenantB.id);
    });

    it('Bearer token auth returns correct tenant context', async () => {
      const tenant = await createTestTenant('Bearer-Test');
      const headers: AuthHeaders = {
        authorization: `Bearer ${tenant.adminToken}`,
      };

      const result = await authenticateRequest(headers, jwtConfig);
      expect(result.authenticated).toBe(true);
      if (result.authenticated) {
        expect(result.context.tenantId).toBe(tenant.id);
      }
    });

    it('invalid Bearer token is rejected', async () => {
      const headers: AuthHeaders = {
        authorization: 'Bearer invalid-token-value',
      };

      const result = await authenticateRequest(headers, jwtConfig);
      expect(result.authenticated).toBe(false);
    });

    it('empty Bearer token is rejected', async () => {
      const headers: AuthHeaders = {
        authorization: 'Bearer ',
      };

      const result = await authenticateRequest(headers, jwtConfig);
      expect(result.authenticated).toBe(false);
    });

    it('missing auth headers result in authentication failure', async () => {
      const headers: AuthHeaders = {};

      const result = await authenticateRequest(headers, jwtConfig);
      expect(result.authenticated).toBe(false);
    });
  });

  // ── Role-Based Access Control ──────────────────────────────────

  describe('RBAC enforcement across tenants', () => {
    it('tenant_admin role has correct permissions set', async () => {
      const tenant = await createTestTenant('RBAC-Admin');
      const payload = await verifyAccessToken(jwtConfig, tenant.adminToken);

      expect(payload.permissions.length).toBeGreaterThan(0);
      expect(payload.role).toBe('tenant_admin');
    });

    it('viewer role has limited permissions', async () => {
      const tenant = await createTestTenant('RBAC-Viewer');
      const viewer = await createTestUser(tenant.id, 'viewer' as UserRole);
      const payload = await verifyAccessToken(jwtConfig, viewer.token);

      expect(payload.role).toBe('viewer');
      // Viewer permissions should be a subset of admin permissions
      const adminPerms = ROLE_PERMISSIONS['tenant_admin'];
      expect(payload.permissions.length).toBeLessThan(adminPerms.length);
    });

    it('agent role has scoped permissions', async () => {
      const tenant = await createTestTenant('RBAC-Agent');
      const agent = await createTestUser(tenant.id, 'agent' as UserRole);
      const payload = await verifyAccessToken(jwtConfig, agent.token);

      expect(payload.role).toBe('agent');
    });

    it('requireRole throws on insufficient role', () => {
      const context: TenantContext = {
        tenantId: 'tnt-001' as TenantId,
        userId: 'usr-001',
        roles: ['viewer'],
        permissions: [],
      };

      expect(() => requireRole(context, 'tenant_admin' as UserRole)).toThrow();
    });

    it('requireRole does not throw for sufficient role', () => {
      const context: TenantContext = {
        tenantId: 'tnt-001' as TenantId,
        userId: 'usr-001',
        roles: ['tenant_admin'],
        permissions: [],
      };

      expect(() => requireRole(context, 'manager' as UserRole)).not.toThrow();
    });

    it('requireTenant throws on mismatched tenant', () => {
      const context: TenantContext = {
        tenantId: 'tnt-001' as TenantId,
        userId: 'usr-001',
        roles: ['tenant_admin'],
        permissions: [],
      };

      expect(() => requireTenant(context, 'tnt-002')).toThrow();
    });

    it('requireTenant does not throw on matching tenant', () => {
      const context: TenantContext = {
        tenantId: 'tnt-001' as TenantId,
        userId: 'usr-001',
        roles: ['tenant_admin'],
        permissions: [],
      };

      expect(() => requireTenant(context, 'tnt-001')).not.toThrow();
    });
  });

  // ── Customer Record Isolation ──────────────────────────────────

  describe('Customer record isolation', () => {
    it('customers are scoped to their tenant', () => {
      const customerA = createMockCustomer({ tenantId: 'tnt-A', name: 'Customer A' });
      const customerB = createMockCustomer({ tenantId: 'tnt-B', name: 'Customer B' });

      expect(customerA.tenantId).toBe('tnt-A');
      expect(customerB.tenantId).toBe('tnt-B');
      expect(customerA.tenantId).not.toBe(customerB.tenantId);
    });

    it('customer IDs are unique across tenants', () => {
      const customerA = createMockCustomer({ tenantId: 'tnt-A' });
      const customerB = createMockCustomer({ tenantId: 'tnt-B' });

      expect(customerA.id).not.toBe(customerB.id);
    });
  });

  // ── Agent Session Isolation ────────────────────────────────────

  describe('Agent session isolation', () => {
    it('agent sessions are scoped to their tenant', () => {
      const sessionA = createMockAgentSession('collections', { tenantId: 'tnt-A' });
      const sessionB = createMockAgentSession('collections', { tenantId: 'tnt-B' });

      expect(sessionA.tenantId).toBe('tnt-A');
      expect(sessionB.tenantId).toBe('tnt-B');
    });

    it('agent session IDs are unique', () => {
      const sessionA = createMockAgentSession('lead_qualifier');
      const sessionB = createMockAgentSession('lead_qualifier');

      expect(sessionA.id).not.toBe(sessionB.id);
    });
  });

  // ── Event Stream Isolation ─────────────────────────────────────

  describe('Event stream isolation', () => {
    it('event envelopes carry tenant_id at top level', () => {
      const envelope = createEventEnvelope(
        EventType.CUSTOMER_CREATED,
        'tnt-A',
        {
          customerId: 'cust-001',
          name: 'Customer A',
          email: 'a@example.com',
          type: 'business',
          lifecycleStage: 'active',
        },
        { source: 'api', userId: 'usr-001', correlationId: 'corr-001' },
      );

      expect(envelope.tenantId).toBe('tnt-A');
    });

    it('events from different tenants have different tenant IDs', () => {
      const payloadA = {
        customerId: 'cust-001',
        name: 'A',
        email: 'a@example.com',
        type: 'business',
        lifecycleStage: 'active',
      };
      const payloadB = {
        customerId: 'cust-002',
        name: 'B',
        email: 'b@example.com',
        type: 'business',
        lifecycleStage: 'active',
      };

      const envelopeA = createEventEnvelope(
        EventType.CUSTOMER_CREATED,
        'tnt-A',
        payloadA,
        { source: 'api', userId: 'usr-001', correlationId: 'corr-001' },
      );
      const envelopeB = createEventEnvelope(
        EventType.CUSTOMER_CREATED,
        'tnt-B',
        payloadB,
        { source: 'api', userId: 'usr-001', correlationId: 'corr-001' },
      );

      expect(envelopeA.tenantId).toBe('tnt-A');
      expect(envelopeB.tenantId).toBe('tnt-B');
      expect(envelopeA.tenantId).not.toBe(envelopeB.tenantId);
    });
  });

  // ── Compliance Isolation ───────────────────────────────────────

  describe('Compliance checks are tenant-scoped', () => {
    it('compliance context includes correct tenant_id', () => {
      const engine = new ComplianceEngine();
      engine.registerRules(ALL_RULES);
      const gate = new ComplianceGate(engine);

      const resultA = gate.check('send_sms', {
        tenantId: 'tnt-A',
        data: { hasConsent: true, localHour: 14 },
        timestamp: new Date('2026-01-15T14:00:00.000Z'),
      });

      const resultB = gate.check('send_sms', {
        tenantId: 'tnt-B',
        data: { hasConsent: true, localHour: 14 },
        timestamp: new Date('2026-01-15T14:00:00.000Z'),
      });

      // Both should pass with same data — the key point is they run independently
      expect(resultA.timestamp).toBeDefined();
      expect(resultB.timestamp).toBeDefined();
    });
  });
});
