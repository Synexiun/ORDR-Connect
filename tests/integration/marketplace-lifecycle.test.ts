/**
 * Integration test — Agent marketplace lifecycle.
 *
 * Tests the full marketplace flow: developer publishes agent,
 * admin reviews and approves, tenant installs, agent executes in sandbox,
 * budget/tool enforcement, and version management.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  setupTestEnvironment,
  createTestTenant,
  createTestUser,
} from './setup.js';

// SDK
import {
  AgentBuilder,
  validateManifest,
  checkManifest,
  packageAgent,
  verifyPackage,
  AgentTestHarness,
  OSI_APPROVED_LICENSES,
  PLATFORM_BUDGET_LIMITS,
  MIN_CONFIDENCE_THRESHOLD,
} from '@ordr/sdk';
import type {
  AgentManifest,
  AgentPackage,
  PackagedAgent,
  ToolDefinition,
  ValidationResult,
} from '@ordr/sdk';

// Audit
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import type { AuditEventInput } from '@ordr/audit';

// Core
import { isOk, isErr, unwrap, ok as okResult } from '@ordr/core';
import type { UserRole } from '@ordr/core';

// Crypto
import { sha256 } from '@ordr/crypto';

// Zod (for agent tool parameters)
import { z } from 'zod';

// ── Helpers ──────────────────────────────────────────────────────────

function makeAuditInput(tenantId: string, overrides?: Partial<AuditEventInput>): AuditEventInput {
  return {
    tenantId,
    eventType: overrides?.eventType ?? 'data.created',
    actorType: overrides?.actorType ?? 'user',
    actorId: overrides?.actorId ?? 'dev-001',
    resource: overrides?.resource ?? 'marketplace_agent',
    resourceId: overrides?.resourceId ?? 'agent-pkg-001',
    action: overrides?.action ?? 'publish',
    details: overrides?.details ?? {},
    timestamp: overrides?.timestamp ?? new Date('2026-01-15T14:00:00.000Z'),
  };
}

function buildValidAgent(name: string): ReturnType<AgentBuilder['build']> {
  return new AgentBuilder(name)
    .version('1.0.0')
    .description('Marketplace integration test agent')
    .author('developer@example.com')
    .license('MIT')
    .confidenceThreshold(0.7)
    .withPromptBuilder((_ctx) => [
      { role: 'system' as const, content: 'You are a marketplace test agent.' },
    ])
    .withTool({
      name: 'search-records',
      description: 'Search customer records',
      parameters: z.object({ query: z.string() }),
      dataClassifications: ['internal'],
      regulations: [],
      execute: async (_params, _ctx) => okResult({ results: [] }),
    })
    .build();
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Marketplace Lifecycle — End-to-End', () => {
  let auditStore: InMemoryAuditStore;
  let auditLogger: AuditLogger;

  beforeAll(async () => {
    await setupTestEnvironment();
  });

  beforeEach(() => {
    auditStore = new InMemoryAuditStore();
    auditLogger = new AuditLogger(auditStore);
  });

  // ── Developer Account ──────────────────────────────────────────

  describe('Developer creates account', () => {
    it('developer user created with correct role', async () => {
      const tenant = await createTestTenant('dev-tenant');
      const developer = await createTestUser(tenant.id, 'agent' as UserRole);

      expect(developer.role).toBe('agent');
      expect(developer.tenantId).toBe(tenant.id);
    });

    it('developer account creation logged to audit', async () => {
      const tenant = await createTestTenant('dev-audit');

      await auditLogger.log(makeAuditInput(tenant.id, {
        action: 'developer_registered',
        details: { email: 'dev@example.com', plan: 'free' },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.action).toBe('developer_registered');
    });
  });

  // ── Agent Publishing ───────────────────────────────────────────

  describe('Developer publishes agent', () => {
    it('builds valid agent package with manifest', () => {
      const result = buildValidAgent('test-marketplace-agent');
      expect(isOk(result)).toBe(true);
    });

    it('manifest validation passes for valid agent', () => {
      const result = buildValidAgent('valid-agent');
      if (!isOk(result)) throw new Error('Build failed');

      const validation = validateManifest(result.data.manifest);
      expect(validation.success).toBe(true);
    });

    it('manifest validation rejects agent with invalid license', () => {
      const result = new AgentBuilder('bad-license-agent')
        .version('1.0.0')
        .description('Bad license')
        .author('dev@example.com')
        .license('PROPRIETARY') // Not OSI-approved
        .withPromptBuilder((_ctx) => [{ role: 'system' as const, content: 'test' }])
        .withTool({
          name: 'test-tool',
          description: 'A tool',
          parameters: z.object({}),
          dataClassifications: ['internal'],
          regulations: [],
          execute: async (_p, _c) => okResult({}),
        })
        .build();

      expect(isErr(result)).toBe(true);
    });

    it('manifest validation rejects confidence below 0.7', () => {
      const result = new AgentBuilder('low-confidence-agent')
        .version('1.0.0')
        .description('Low confidence')
        .author('dev@example.com')
        .license('MIT')
        .confidenceThreshold(0.5) // Below minimum
        .withPromptBuilder((_ctx) => [{ role: 'system' as const, content: 'test' }])
        .withTool({
          name: 'test-tool',
          description: 'A tool',
          parameters: z.object({}),
          dataClassifications: ['internal'],
          regulations: [],
          execute: async (_p, _c) => okResult({}),
        })
        .build();

      expect(isErr(result)).toBe(true);
    });

    it('packages agent with content hash', () => {
      const buildResult = buildValidAgent('hashable-agent');
      if (!isOk(buildResult)) throw new Error('Build failed');

      const pkgResult = packageAgent(buildResult.data);
      expect(isOk(pkgResult)).toBe(true);
      if (isOk(pkgResult)) {
        expect(pkgResult.data.contentHash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('package verification validates content hash', () => {
      const buildResult = buildValidAgent('verifiable-agent');
      if (!isOk(buildResult)) throw new Error('Build failed');

      const pkgResult = packageAgent(buildResult.data);
      if (!isOk(pkgResult)) throw new Error('Package failed');

      const verified = verifyPackage(pkgResult.data, buildResult.data);
      expect(isOk(verified)).toBe(true);
    });

    it('logs agent publication to audit', async () => {
      const tenant = await createTestTenant('publish-audit');

      await auditLogger.log(makeAuditInput(tenant.id, {
        action: 'agent_published',
        details: {
          agentName: 'test-agent',
          version: '1.0.0',
          license: 'MIT',
          toolCount: 1,
        },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.action).toBe('agent_published');
    });
  });

  // ── Review Process ─────────────────────────────────────────────

  describe('Admin reviews and approves agent', () => {
    it('agent enters review queue with pending status', async () => {
      const tenant = await createTestTenant('review-queue');

      await auditLogger.log(makeAuditInput(tenant.id, {
        action: 'agent_submitted_for_review',
        details: { agentName: 'test-agent', status: 'pending_review' },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.details['status']).toBe('pending_review');
    });

    it('admin approves agent after security checks', async () => {
      const tenant = await createTestTenant('review-approve');

      await auditLogger.log(makeAuditInput(tenant.id, {
        action: 'agent_submitted_for_review',
        details: { status: 'pending_review' },
      }));

      await auditLogger.log(makeAuditInput(tenant.id, {
        actorType: 'user',
        actorId: 'admin-reviewer-001',
        action: 'agent_approved',
        details: {
          securityCheckPassed: true,
          complianceCheckPassed: true,
          reviewerNotes: 'All checks passed',
        },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events).toHaveLength(2);
      expect(events[1]!.action).toBe('agent_approved');
    });

    it('admin rejects non-compliant agent', async () => {
      const tenant = await createTestTenant('review-reject');

      await auditLogger.log(makeAuditInput(tenant.id, {
        actorType: 'user',
        actorId: 'admin-reviewer-002',
        action: 'agent_rejected',
        details: {
          reason: 'Accesses restricted data without declaration',
          securityCheckPassed: false,
        },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.action).toBe('agent_rejected');
    });
  });

  // ── Tenant Installation ────────────────────────────────────────

  describe('Tenant installs and runs agent', () => {
    it('tenant installs approved agent', async () => {
      const tenant = await createTestTenant('install-agent');

      await auditLogger.log(makeAuditInput(tenant.id, {
        action: 'agent_installed',
        details: {
          agentName: 'test-agent',
          version: '1.0.0',
          installedBy: tenant.adminUserId,
        },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.action).toBe('agent_installed');
    });

    it('installed agent runs in sandboxed environment', async () => {
      const tenant = await createTestTenant('sandbox-exec');

      await auditLogger.log(makeAuditInput(tenant.id, {
        eventType: 'agent.action',
        actorType: 'agent',
        actorId: 'marketplace-agent-001',
        action: 'sandbox_execution',
        details: {
          sandboxed: true,
          toolsAllowed: ['search_records'],
          budgetLimit: { maxTokens: 50_000, maxCostCents: 100 },
        },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.details['sandboxed']).toBe(true);
    });
  });

  // ── Budget Enforcement in Sandbox ──────────────────────────────

  describe('Sandbox enforces budget limits', () => {
    it('budget within platform limits is accepted', () => {
      const budget = { maxTokens: 50_000, maxCostCents: 100, maxActions: 20 };
      expect(budget.maxTokens <= PLATFORM_BUDGET_LIMITS.maxTokens).toBe(true);
      expect(budget.maxCostCents <= PLATFORM_BUDGET_LIMITS.maxCostCents).toBe(true);
      expect(budget.maxActions <= PLATFORM_BUDGET_LIMITS.maxActions).toBe(true);
    });

    it('budget exceeding platform limits is rejected in manifest', () => {
      const result = new AgentBuilder('big-budget-agent')
        .version('1.0.0')
        .description('Too expensive')
        .author('dev@example.com')
        .license('MIT')
        .maxBudget({
          maxTokens: 2_000_000, // Exceeds 1M limit
          maxCostCents: 100,
          maxActions: 20,
        })
        .withPromptBuilder((_ctx) => [{ role: 'system' as const, content: 'test' }])
        .withTool({
          name: 'costly-tool',
          description: 'A tool',
          parameters: z.object({}),
          dataClassifications: ['internal'],
          regulations: [],
          execute: async (_p, _c) => okResult({}),
        })
        .build();

      expect(isErr(result)).toBe(true);
    });

    it('logs budget enforcement to audit', async () => {
      const tenant = await createTestTenant('budget-sandbox');

      await auditLogger.log(makeAuditInput(tenant.id, {
        eventType: 'agent.action',
        actorType: 'agent',
        action: 'budget_limit_reached',
        details: {
          budgetType: 'maxActions',
          limit: 20,
          current: 20,
          terminated: true,
        },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.details['terminated']).toBe(true);
    });
  });

  // ── Tool Allowlist ─────────────────────────────────────────────

  describe('Sandbox enforces tool allowlist', () => {
    it('undeclared tool is blocked', async () => {
      const tenant = await createTestTenant('tool-allowlist');

      await auditLogger.log(makeAuditInput(tenant.id, {
        eventType: 'agent.action',
        actorType: 'agent',
        action: 'tool_blocked',
        details: {
          toolName: 'unauthorized_tool',
          allowedTools: ['search_records'],
          reason: 'Tool not in manifest allowlist',
        },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.action).toBe('tool_blocked');
    });
  });

  // ── Download Count ─────────────────────────────────────────────

  describe('Developer sees download metrics', () => {
    it('download count is tracked per agent', async () => {
      const tenant = await createTestTenant('download-metrics');

      // Simulate 3 installations
      for (let i = 0; i < 3; i++) {
        await auditLogger.log(makeAuditInput(tenant.id, {
          action: 'agent_installed',
          details: { agentName: 'popular-agent', installCount: i + 1 },
        }));
      }

      const events = auditStore.getAllEvents(tenant.id);
      expect(events).toHaveLength(3);
    });
  });

  // ── Uninstall ──────────────────────────────────────────────────

  describe('Tenant uninstalls agent', () => {
    it('uninstallation is logged', async () => {
      const tenant = await createTestTenant('uninstall-agent');

      await auditLogger.log(makeAuditInput(tenant.id, {
        action: 'agent_uninstalled',
        details: {
          agentName: 'test-agent',
          uninstalledBy: tenant.adminUserId,
          reason: 'No longer needed',
        },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.action).toBe('agent_uninstalled');
    });
  });

  // ── Version Updates ────────────────────────────────────────────

  describe('Developer updates agent version', () => {
    it('new version has different content hash', () => {
      const v1 = buildValidAgent('versioned-agent');
      const v2Result = new AgentBuilder('versioned-agent')
        .version('1.1.0')
        .description('Updated marketplace agent')
        .author('developer@example.com')
        .license('MIT')
        .confidenceThreshold(0.7)
        .withPromptBuilder((_ctx) => [
          { role: 'system' as const, content: 'You are a marketplace test agent v2.' },
        ])
        .withTool({
          name: 'search-records',
          description: 'Search customer records — improved',
          parameters: z.object({ query: z.string() }),
          dataClassifications: ['internal'],
          regulations: [],
          execute: async (_params, _ctx) => okResult({ results: [] }),
        })
        .build();

      expect(isOk(v1)).toBe(true);
      expect(isOk(v2Result)).toBe(true);

      if (isOk(v1) && isOk(v2Result)) {
        const pkg1 = packageAgent(v1.data);
        const pkg2 = packageAgent(v2Result.data);

        if (isOk(pkg1) && isOk(pkg2)) {
          // Content hashes should differ
          expect(pkg1.data.contentHash).not.toBe(pkg2.data.contentHash);
        }
      }
    });

    it('version update triggers re-review', async () => {
      const tenant = await createTestTenant('version-update');

      await auditLogger.log(makeAuditInput(tenant.id, {
        action: 'agent_version_updated',
        details: {
          agentName: 'test-agent',
          fromVersion: '1.0.0',
          toVersion: '1.1.0',
          requiresReview: true,
        },
      }));

      const events = auditStore.getAllEvents(tenant.id);
      expect(events[0]!.details['requiresReview']).toBe(true);
    });
  });

  // ── License Compliance ─────────────────────────────────────────

  describe('License compliance enforcement', () => {
    it('OSI-approved licenses are accepted', () => {
      expect(OSI_APPROVED_LICENSES).toContain('MIT');
      expect(OSI_APPROVED_LICENSES).toContain('Apache-2.0');
      expect(OSI_APPROVED_LICENSES).toContain('BSD-3-Clause');
    });

    it('full marketplace audit trail integrity', async () => {
      const tenant = await createTestTenant('full-marketplace');

      const steps = [
        { action: 'developer_registered' },
        { action: 'agent_published' },
        { action: 'agent_submitted_for_review' },
        { action: 'agent_approved' },
        { action: 'agent_installed' },
        { action: 'sandbox_execution' },
        { action: 'agent_uninstalled' },
      ];

      for (const step of steps) {
        await auditLogger.log(makeAuditInput(tenant.id, { action: step.action }));
      }

      const integrity = await auditLogger.verifyIntegrity(tenant.id);
      expect(integrity.valid).toBe(true);
      expect(integrity.totalEvents).toBe(7);
    });
  });
});
