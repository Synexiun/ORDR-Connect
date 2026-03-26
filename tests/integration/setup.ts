/**
 * Integration test environment bootstrap.
 *
 * Provides tenant/user factories, mock infrastructure connections,
 * and audit logger scoped to each test tenant.
 *
 * SECURITY: No real PHI is ever created — all data is synthetic.
 */

import { randomUUID } from 'node:crypto';
import { generateKeyPair } from '@ordr/crypto';
import {
  loadKeyPair,
  createAccessToken,
  createRefreshToken,
  InMemoryRateLimiter,
} from '@ordr/auth';
import type { JwtConfig, AccessTokenPayload } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { ComplianceEngine, ComplianceGate, ALL_RULES } from '@ordr/compliance';
import type { UserRole, Permission } from '@ordr/core';
import { ROLE_PERMISSIONS } from '@ordr/auth';

// ── Shared state for the test run ────────────────────────────────────

let jwtConfig: JwtConfig;
let auditStore: InMemoryAuditStore;
let auditLogger: AuditLogger;
let complianceEngine: ComplianceEngine;
let complianceGate: ComplianceGate;

// ── Setup / Teardown ─────────────────────────────────────────────────

export async function setupTestEnvironment(): Promise<void> {
  // Generate ephemeral RSA key pair for JWT signing
  const { privateKey, publicKey } = generateKeyPair();
  jwtConfig = await loadKeyPair(privateKey, publicKey, {
    accessTokenTtl: 900,
    refreshTokenTtl: 3600,
    issuer: 'ordr-connect-test',
    audience: 'ordr-connect-test',
  });

  // Shared audit store (cleared per-test via createTestTenant)
  auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);

  // Compliance engine pre-loaded with all rules
  complianceEngine = new ComplianceEngine();
  complianceEngine.registerRules(ALL_RULES);
  complianceGate = new ComplianceGate(complianceEngine);
}

export function teardownTestEnvironment(): void {
  auditStore.clear();
}

// ── Tenant Factory ───────────────────────────────────────────────────

export interface TestTenant {
  readonly id: string;
  readonly name: string;
  readonly adminToken: string;
  readonly adminUserId: string;
}

export async function createTestTenant(name: string): Promise<TestTenant> {
  const tenantId = `tnt_${randomUUID().slice(0, 8)}`;
  const adminUserId = `usr_${randomUUID().slice(0, 8)}`;

  const adminToken = await createAccessToken(jwtConfig, {
    sub: adminUserId,
    tid: tenantId,
    role: 'tenant_admin' as UserRole,
    permissions: ROLE_PERMISSIONS['tenant_admin'],
  });

  return { id: tenantId, name, adminToken, adminUserId };
}

// ── User Factory ─────────────────────────────────────────────────────

export interface TestUser {
  readonly id: string;
  readonly tenantId: string;
  readonly role: UserRole;
  readonly token: string;
}

export async function createTestUser(
  tenantId: string,
  role: UserRole,
): Promise<TestUser> {
  const userId = `usr_${randomUUID().slice(0, 8)}`;
  const permissions = ROLE_PERMISSIONS[role] ?? [];

  const token = await createAccessToken(jwtConfig, {
    sub: userId,
    tid: tenantId,
    role,
    permissions,
  });

  return { id: userId, tenantId, role, token };
}

// ── Accessors ────────────────────────────────────────────────────────

export function getJwtConfig(): JwtConfig {
  return jwtConfig;
}

export function getAuditStore(): InMemoryAuditStore {
  return auditStore;
}

export function getAuditLogger(): AuditLogger {
  return auditLogger;
}

export function getComplianceEngine(): ComplianceEngine {
  return complianceEngine;
}

export function getComplianceGate(): ComplianceGate {
  return complianceGate;
}
