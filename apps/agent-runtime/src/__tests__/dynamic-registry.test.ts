/**
 * Tests for dynamic agent registration (SDK plugin support)
 *
 * COMPLIANCE: Rule 9 (agent safety) — validates registration, unregistration,
 * compliance-failing manifest rejection, and built-in protection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ok, isOk, isErr, createAgentRole } from '@ordr/core';
import { AgentRegistry } from '../agent-registry.js';
import type { PromptBuilder } from '../agent-registry.js';
import type { AgentTool } from '../types.js';

// ─── Helpers ───────────────────────────────────────────────────

function makePromptBuilder(): PromptBuilder {
  return vi.fn().mockReturnValue([]);
}

function makeTool(name: string): AgentTool {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: z.object({}),
    execute: vi.fn().mockResolvedValue(ok({ status: 'ok' })),
  };
}

function makeManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: 'custom_agent',
    version: '1.0.0',
    description: 'A custom SDK agent',
    requiredTools: ['custom_tool'],
    minConfidenceThreshold: 0.8,
    maxBudget: {
      maxTokens: 50_000,
      maxCostCents: 100,
      maxActions: 20,
    },
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('AgentRegistry — dynamic registration', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  // ── registerFromManifest ────────────────────────────

  describe('registerFromManifest', () => {
    it('should register a valid manifest', () => {
      const result = registry.registerFromManifest(
        makeManifest(),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      expect(isOk(result)).toBe(true);
    });

    it('should make the agent accessible via getConfig', () => {
      registry.registerFromManifest(
        makeManifest(),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      const config = registry.getConfig(createAgentRole('custom_agent'));
      expect(config).toBeDefined();
      expect(config?.description).toBe('A custom SDK agent');
    });

    it('should register the prompt builder', () => {
      const promptBuilder = makePromptBuilder();
      registry.registerFromManifest(
        makeManifest(),
        promptBuilder,
        [makeTool('custom_tool')],
      );
      const builder = registry.getPromptBuilderForRole(createAgentRole('custom_agent'));
      expect(builder).toBe(promptBuilder);
    });

    it('should reject duplicate registration', () => {
      registry.registerFromManifest(
        makeManifest(),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      const result = registry.registerFromManifest(
        makeManifest(),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      expect(isErr(result)).toBe(true);
    });

    it('should reject invalid name format', () => {
      const result = registry.registerFromManifest(
        makeManifest({ name: 'INVALID-NAME!' }),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      expect(isErr(result)).toBe(true);
    });

    it('should reject when required tools are missing', () => {
      const result = registry.registerFromManifest(
        makeManifest({ requiredTools: ['missing_tool'] }),
        makePromptBuilder(),
        [], // No tools provided
      );
      expect(isErr(result)).toBe(true);
    });

    it('should accept manifest with multiple tools', () => {
      const result = registry.registerFromManifest(
        makeManifest({ requiredTools: ['tool_a', 'tool_b'] }),
        makePromptBuilder(),
        [makeTool('tool_a'), makeTool('tool_b')],
      );
      expect(isOk(result)).toBe(true);
    });

    it('should set default autonomy to supervised', () => {
      registry.registerFromManifest(
        makeManifest(),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      const config = registry.getConfig(createAgentRole('custom_agent'));
      expect(config?.defaultAutonomyLevel).toBe('supervised');
    });

    it('should set max autonomy to supervised', () => {
      registry.registerFromManifest(
        makeManifest(),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      const config = registry.getConfig(createAgentRole('custom_agent'));
      expect(config?.maxAutonomyLevel).toBe('supervised');
    });

    it('should apply budget from manifest', () => {
      registry.registerFromManifest(
        makeManifest({
          maxBudget: { maxTokens: 75_000, maxCostCents: 200, maxActions: 30 },
        }),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      const config = registry.getConfig(createAgentRole('custom_agent'));
      expect(config?.maxTokensBudget).toBe(75_000);
      expect(config?.maxCostCentsBudget).toBe(200);
      expect(config?.maxActions).toBe(30);
    });
  });

  // ── unregister ──────────────────────────────────────

  describe('unregister', () => {
    it('should remove a dynamically registered agent', () => {
      registry.registerFromManifest(
        makeManifest(),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      const result = registry.unregister('custom_agent');
      expect(isOk(result)).toBe(true);
      expect(registry.getConfig(createAgentRole('custom_agent'))).toBeUndefined();
    });

    it('should reject unregistering a built-in agent', () => {
      const result = registry.unregister('collections');
      expect(isErr(result)).toBe(true);
    });

    it('should reject unregistering a non-existent agent', () => {
      const result = registry.unregister('nonexistent');
      expect(isErr(result)).toBe(true);
    });

    it('should reject unregistering with invalid name', () => {
      const result = registry.unregister('INVALID');
      expect(isErr(result)).toBe(true);
    });

    it('should not affect other registered agents', () => {
      registry.registerFromManifest(
        makeManifest({ name: 'agent_a' }),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      registry.registerFromManifest(
        makeManifest({ name: 'agent_b' }),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      registry.unregister('agent_a');
      expect(registry.getConfig(createAgentRole('agent_b'))).toBeDefined();
    });
  });

  // ── listRegistered ──────────────────────────────────

  describe('listRegistered', () => {
    it('should include built-in agents', () => {
      const all = registry.listRegistered();
      const roles = all.map(c => c.role as string);
      expect(roles).toContain('collections');
      expect(roles).toContain('support_triage');
      expect(roles).toContain('escalation');
    });

    it('should include dynamically registered agents', () => {
      registry.registerFromManifest(
        makeManifest(),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      const all = registry.listRegistered();
      const roles = all.map(c => c.role as string);
      expect(roles).toContain('custom_agent');
    });

    it('should reflect unregistration', () => {
      registry.registerFromManifest(
        makeManifest(),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      registry.unregister('custom_agent');
      const all = registry.listRegistered();
      const roles = all.map(c => c.role as string);
      expect(roles).not.toContain('custom_agent');
    });

    it('should return correct count', () => {
      const initialCount = registry.listRegistered().length;
      registry.registerFromManifest(
        makeManifest(),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      expect(registry.listRegistered()).toHaveLength(initialCount + 1);
    });
  });

  // ── isBuiltIn ───────────────────────────────────────

  describe('isBuiltIn', () => {
    it('should return true for built-in roles', () => {
      expect(registry.isBuiltIn('collections')).toBe(true);
      expect(registry.isBuiltIn('support_triage')).toBe(true);
      expect(registry.isBuiltIn('escalation')).toBe(true);
    });

    it('should return false for dynamic roles', () => {
      registry.registerFromManifest(
        makeManifest(),
        makePromptBuilder(),
        [makeTool('custom_tool')],
      );
      expect(registry.isBuiltIn('custom_agent')).toBe(false);
    });

    it('should return false for unknown roles', () => {
      expect(registry.isBuiltIn('unknown_role')).toBe(false);
    });
  });
});
