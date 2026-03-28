import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { ok } from '@ordr/core';
import { AgentRegistry } from '../agent-registry.js';
import type { AgentConfig, PromptBuilder } from '../agent-registry.js';
import type { AgentTool } from '../types.js';

// ─── Mock Tool Factory ──────────────────────────────────────────

function makeMockTool(name: string): AgentTool {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: z.object({}),
    execute: vi.fn().mockResolvedValue(ok({ status: 'ok' })),
  };
}

// ─── Helper: build full tool map ──────────────────────────────

function makeAllTools(): Map<string, AgentTool> {
  const tools = new Map<string, AgentTool>();
  tools.set('send_sms', makeMockTool('send_sms'));
  tools.set('lookup_customer', makeMockTool('lookup_customer'));
  tools.set('check_payment', makeMockTool('check_payment'));
  tools.set('schedule_followup', makeMockTool('schedule_followup'));
  tools.set('search_knowledge', makeMockTool('search_knowledge'));
  tools.set('categorize_ticket', makeMockTool('categorize_ticket'));
  tools.set('route_ticket', makeMockTool('route_ticket'));
  tools.set('escalate_to_human', makeMockTool('escalate_to_human'));
  tools.set('summarize_conversation', makeMockTool('summarize_conversation'));
  tools.set('create_ticket', makeMockTool('create_ticket'));
  return tools;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('AgentRegistry', () => {
  // ── Default Configs ─────────────────────────────

  describe('built-in configurations', () => {
    it('should load default configs for 4 agent types', () => {
      const registry = new AgentRegistry();
      const roles = registry.getAllRoles();
      expect(roles).toContain('collections');
      expect(roles).toContain('support_triage');
      expect(roles).toContain('escalation');
      expect(roles).toContain('healthcare');
    });

    it('should have collections config with correct tools', () => {
      const registry = new AgentRegistry();
      const config = registry.getConfig('collections');
      expect(config).toBeDefined();
      expect(config?.toolAllowlist).toContain('send_sms');
      expect(config?.toolAllowlist).toContain('lookup_customer');
      expect(config?.toolAllowlist).toContain('check_payment');
      expect(config?.toolAllowlist).toContain('schedule_followup');
    });

    it('should have support_triage config with correct tools', () => {
      const registry = new AgentRegistry();
      const config = registry.getConfig('support_triage');
      expect(config).toBeDefined();
      expect(config?.toolAllowlist).toContain('search_knowledge');
      expect(config?.toolAllowlist).toContain('categorize_ticket');
      expect(config?.toolAllowlist).toContain('route_ticket');
    });

    it('should have escalation config with correct tools', () => {
      const registry = new AgentRegistry();
      const config = registry.getConfig('escalation');
      expect(config).toBeDefined();
      expect(config?.toolAllowlist).toContain('escalate_to_human');
      expect(config?.toolAllowlist).toContain('summarize_conversation');
      expect(config?.toolAllowlist).toContain('create_ticket');
    });
  });

  // ── getConfig ─────────────────────────────────────

  describe('getConfig', () => {
    it('should return config for registered role', () => {
      const registry = new AgentRegistry();
      const config = registry.getConfig('collections');
      expect(config).toBeDefined();
      expect(config?.role).toBe('collections');
    });

    it('should return undefined for unregistered role', () => {
      const registry = new AgentRegistry();
      const config = registry.getConfig('nonexistent_role');
      expect(config).toBeUndefined();
    });
  });

  // ── getToolsForRole (Tool Allowlist) ──────────────

  describe('getToolsForRole', () => {
    it('should return only allowlisted tools for a role', () => {
      const registry = new AgentRegistry();
      const allTools = makeAllTools();
      const roleTools = registry.getToolsForRole('collections', allTools);

      expect(roleTools.size).toBe(4);
      expect(roleTools.has('send_sms')).toBe(true);
      expect(roleTools.has('lookup_customer')).toBe(true);
      expect(roleTools.has('check_payment')).toBe(true);
      expect(roleTools.has('schedule_followup')).toBe(true);
      // Should NOT include non-allowlisted tools
      expect(roleTools.has('search_knowledge')).toBe(false);
    });

    it('should return empty map for unknown role', () => {
      const registry = new AgentRegistry();
      const allTools = makeAllTools();
      const roleTools = registry.getToolsForRole('nonexistent_role', allTools);
      expect(roleTools.size).toBe(0);
    });

    it('should handle missing tools gracefully', () => {
      const registry = new AgentRegistry();
      const limitedTools = new Map<string, AgentTool>();
      limitedTools.set('send_sms', makeMockTool('send_sms'));
      // collections expects 4 tools but only 1 is available
      const roleTools = registry.getToolsForRole('collections', limitedTools);
      expect(roleTools.size).toBe(1);
      expect(roleTools.has('send_sms')).toBe(true);
    });
  });

  // ── Prompt Builders ───────────────────────────────

  describe('prompt builders', () => {
    it('should return undefined when no builder is registered', () => {
      const registry = new AgentRegistry();
      const builder = registry.getPromptBuilderForRole('collections');
      expect(builder).toBeUndefined();
    });

    it('should return registered builder', () => {
      const registry = new AgentRegistry();
      const mockBuilder: PromptBuilder = vi.fn().mockReturnValue([]);
      registry.registerPromptBuilder('collections', mockBuilder);

      const builder = registry.getPromptBuilderForRole('collections');
      expect(builder).toBe(mockBuilder);
    });
  });

  // ── Role Enabled/Disabled ─────────────────────────

  describe('isRoleEnabled', () => {
    it('should return true for enabled roles by default', () => {
      const registry = new AgentRegistry();
      expect(registry.isRoleEnabled('collections', 'tenant-1')).toBe(true);
    });

    it('should return false for unknown roles', () => {
      const registry = new AgentRegistry();
      expect(registry.isRoleEnabled('nonexistent_role', 'tenant-1')).toBe(false);
    });

    it('should respect tenant-level override to disable', () => {
      const registry = new AgentRegistry();
      registry.setTenantRoleOverride('tenant-1', 'collections', false);
      expect(registry.isRoleEnabled('collections', 'tenant-1')).toBe(false);
      // Other tenants unaffected
      expect(registry.isRoleEnabled('collections', 'tenant-2')).toBe(true);
    });

    it('should respect tenant-level override to enable', () => {
      const disabledConfig: AgentConfig = {
        role: 'collections',
        displayName: 'Collections',
        description: 'Test',
        defaultAutonomyLevel: 'supervised',
        maxAutonomyLevel: 'autonomous',
        toolAllowlist: [],
        systemPromptTemplate: 'Test',
        maxSteps: 10,
        maxTokensBudget: 100_000,
        maxCostCentsBudget: 500,
        maxActions: 20,
        enabled: false,
      };
      const registry = new AgentRegistry([disabledConfig]);
      expect(registry.isRoleEnabled('collections', 'tenant-1')).toBe(false);

      registry.setTenantRoleOverride('tenant-1', 'collections', true);
      expect(registry.isRoleEnabled('collections', 'tenant-1')).toBe(true);
    });

    it('should clear tenant override and revert to global', () => {
      const registry = new AgentRegistry();
      registry.setTenantRoleOverride('tenant-1', 'collections', false);
      expect(registry.isRoleEnabled('collections', 'tenant-1')).toBe(false);

      registry.clearTenantRoleOverride('tenant-1', 'collections');
      expect(registry.isRoleEnabled('collections', 'tenant-1')).toBe(true);
    });
  });

  // ── Custom Configs ────────────────────────────────

  describe('custom configurations', () => {
    it('should accept custom configs in constructor', () => {
      const customConfig: AgentConfig = {
        role: 'lead_qualifier',
        displayName: 'Lead Qualifier',
        description: 'Test lead qualifier',
        defaultAutonomyLevel: 'rule_based',
        maxAutonomyLevel: 'supervised',
        toolAllowlist: ['lookup_customer'],
        systemPromptTemplate: 'You are a lead qualifier.',
        maxSteps: 5,
        maxTokensBudget: 50_000,
        maxCostCentsBudget: 200,
        maxActions: 10,
        enabled: true,
      };

      const registry = new AgentRegistry([customConfig]);
      expect(registry.getConfig('lead_qualifier')).toBeDefined();
      expect(registry.getAllRoles()).toContain('lead_qualifier');
    });
  });
});
